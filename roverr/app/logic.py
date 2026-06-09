import os
import json
import shutil
import time
import threading
import logging
import qbittorrentapi
import re
import requests
import hashlib
import unicodedata
from datetime import datetime
from database import MoveHistory, Movie

# ===== LOGGING CONFIGURATION =====

# Mapping de niveles user-friendly a Python logging
LOG_LEVELS = {
    "Basic": logging.WARNING,
    "Standard": logging.INFO,
    "Verbose": logging.DEBUG
}

def get_log_level():
    """Get log level from Home Assistant options"""
    try:
        options_file = "/data/options.json"
        if os.path.exists(options_file):
            with open(options_file, 'r') as f:
                options = json.load(f)
                level_name = options.get('log_level', 'Standard')
                return LOG_LEVELS.get(level_name, logging.INFO)
    except Exception:
        pass
    return logging.INFO  # Default fallback

# Configurar logging con nivel dinámico
logging.basicConfig(
    level=get_log_level(),
    format='%(levelname)s:%(name)s:%(message)s'
)
logger = logging.getLogger("Roverr")

# Callback for notifying main app when movies change
ON_MOVIES_UPDATE_CALLBACK = None

def register_movies_update_callback(callback):
    global ON_MOVIES_UPDATE_CALLBACK
    ON_MOVIES_UPDATE_CALLBACK = callback
    logger.info("Registered movies update callback")

def trigger_movies_update_callback():
    global ON_MOVIES_UPDATE_CALLBACK
    if ON_MOVIES_UPDATE_CALLBACK:
        try:
            import asyncio
            if asyncio.iscoroutinefunction(ON_MOVIES_UPDATE_CALLBACK):
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(ON_MOVIES_UPDATE_CALLBACK())
                except RuntimeError:
                    # Run it in a new thread if no event loop is running in this thread
                    asyncio.run(ON_MOVIES_UPDATE_CALLBACK())
            else:
                ON_MOVIES_UPDATE_CALLBACK()
        except Exception as e:
            logger.error(f"Error executing movies update callback: {e}")


# Constants
MANUAL_SEARCH_TAG = "manual-search-autocopy"
SETTINGS_FILE = "/data/settings.json"
DEFAULT_SETTINGS = {
    "qb_host": "localhost",
    "qb_port": 8080,
    "qb_user": "admin",
    "qb_pass": "adminpass",
    "local_source_path": "",
    "local_dest_path": "",
    "tmdb_api_key": "",
    "copy_speed_limit": 10,
    "auto_copy_manual_search": False,
    "indexers": [],
    "rss_feeds": [],
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    "telegram_notify_on_new_movie": True,
    "telegram_notify_on_download_complete": True,
    "telegram_notify_on_move": True,
    "language": "es-ES",  # Default to Spanish for backwards compatibility
    "backdrop_blur": 35,
    "backdrop_opacity": 18,
    "min_year": ""
}

# Global State
COPY_PROGRESS = {} # {hash: {percent: float, speed: float, status: str}}
STOP_FLAGS = set() # Set of hashes to stop
RSS_LAST_FETCH = {} # {feed_url: timestamp} - Track last fetch time for each RSS feed
RESERVED_SPACE = {} # {dest_path: reserved_bytes} - Track space reserved by active copies
SPACE_LOCK = threading.Lock() # Thread-safe access to RESERVED_SPACE

# ✅ PHASE 2: TMDB Search Cache
_TMDB_SEARCH_CACHE = {}  # {cache_key: (timestamp, result)}
TMDB_CACHE_TTL = 3600  # 1 hour cache TTL

def get_cached_tmdb_result(title, year):
    """Get cached TMDB search result if available and not expired."""
    cache_key = f"{title.lower().strip()}_{year}"
    if cache_key in _TMDB_SEARCH_CACHE:
        timestamp, result = _TMDB_SEARCH_CACHE[cache_key]
        if time.time() - timestamp < TMDB_CACHE_TTL:
            logger.debug(f"🗄️ TMDB cache hit for '{title}' ({year})")
            return result
    return None

def cache_tmdb_result(title, year, result):
    """Cache a TMDB search result."""
    cache_key = f"{title.lower().strip()}_{year}"
    _TMDB_SEARCH_CACHE[cache_key] = (time.time(), result)
    logger.debug(f"🗄️ TMDB result cached for '{title}' ({year})")

def send_telegram_notification(message):
    """
    Sends a notification to the configured Telegram chat.
    """
    try:
        settings = load_settings()
        token = settings.get('telegram_bot_token')
        chat_id = settings.get('telegram_chat_id')
        
        if not token or not chat_id:
            return False
            
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "HTML"
        }
        
        # Run in a separate thread to avoid blocking
        def _send():
            try:
                requests.post(url, json=payload, timeout=10)
            except Exception as e:
                logger.error(f"Error sending Telegram notification: {e}")
                
        threading.Thread(target=_send).start()
        return True
    except Exception as e:
        logger.error(f"Error initiating Telegram notification: {e}")
        return False

def test_telegram_connection(token, chat_id):
    """
    Tests Telegram connection by sending a test message.
    """
    try:
        if not token or not chat_id:
            return False, "Missing Token or Chat ID"
            
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": "🔔 <b>Roverr Test Message</b>\n\nIf you are reading this, your Telegram configuration is correct!",
            "parse_mode": "HTML"
        }
        
        res = requests.post(url, json=payload, timeout=10)
        data = res.json()
        
        if res.status_code == 200 and data.get('ok'):
            return True, "Test message sent successfully!"
        else:
            return False, f"Telegram API Error: {data.get('description', 'Unknown error')}"
            
    except Exception as e:
        return False, f"Connection Error: {str(e)}"


def clean_torrent_name(name):
    """
    Extracts the movie title and year from a torrent name.
    Example: "The.Matrix.1999.1080p..." -> "The Matrix", "1999"
    """
    # Regex to find year (19xx or 20xx), allowing dots, spaces, or parentheses
    match = re.search(r'(.*?)[.\s\(](\d{4})[.\s\)]', name)
    if match:
        title = match.group(1).replace('.', ' ').strip()
        year = match.group(2)
        return title, year
    
    # Fallback: Split by common delimiters for tags
    # Split by '[' or '('
    base = re.split(r'[\[\(]', name)[0]
    # Also split by 'WEB', '1080', '720', '4k', '2160' if preceded by space or dot
    base = re.split(r'[.\s](WEB|1080|720|4k|2160)', base, flags=re.IGNORECASE)[0]
    
    title = base.replace('.', ' ').strip()
    return title, None

def sanitize_filename(name):
    """
    Sanitize filename to only include safe characters.
    - Removes leading/trailing spaces
    - Strips disallowed characters: <>:"|?*
    - Path separators (/ and \\)
    - Control characters
    """
    # Remove leading/trailing whitespace
    name = name.strip()
    # Remove disallowed characters
    name = re.sub(r'[<>:"|?*\\/]', '', name)
    # Replace control characters with underscore
    name = ''.join(c if unicodedata.category(c)[0] != 'C' else '_' for c in name)
    # Replace multiple underscores with a single one
    name = re.sub(r'_{2,}', '_', name)
    # Trim leading/trailing underscores
    name = name.strip('_')
    
    # Limit length (Windows has 255 char limit per path component)
    if len(name) > 200:
        name = name[:200].strip()
        
    return name

def sanitize_path_component(name):
    """
    Sanitizes a path component to prevent path traversal attacks.
    
    Only removes security-critical characters:
    - Path traversal sequences (..)
    - Path separators (/ and \\)
    - Null bytes (\\0)
    
    Preserves legitimate special characters like colons (:), hyphens (-), etc.
    that are commonly part of movie titles.
    
    Args:
        name: String to sanitize (e.g., movie title or year)
    
    Returns:
        Sanitized string safe for use as a filesystem path component
    
    Examples:
        "Vengadores: El despertar" -> "Vengadores: El despertar" (unchanged)
        "../../etc/passwd" -> "_.._..._etc_passwd" (path traversal blocked)
        "Movie/Bad/Path" -> "Movie_Bad_Path" (separators removed)
    """
    if not name:
        return ""
    
    # 1. Remove path traversal sequences (replace each .. with _)
    # This converts ../../etc to _.._..._etc
    while '..' in name:
        name = name.replace('..', '_', 1)  # Replace one at a time to avoid issues
    
    # 2. Remove path separators (prevent directory traversal)
    name = name.replace('/', '_').replace('\\', '_')
    
    # 3. Remove null bytes (extremely dangerous)
    name = name.replace('\0', '')
    
    # 4. Limit length (Windows has 255 char limit per path component)
    # Leave margin for " (YYYY)" and file extension
    if len(name) > 200:
        name = name[:200].strip()
    
    return name.strip()

def get_disk_free_space(path):
    """
    Returns available disk space in bytes for the filesystem containing path.
    Works cross-platform (Windows, Linux, macOS).
    
    Args:
        path: Path to check (file or directory)
    
    Returns:
        int: Available space in bytes
    """
    import shutil
    stat = shutil.disk_usage(path)
    return stat.free

def get_dir_size(path):
    """
    Calculate total size of a directory recursively.
    For files, returns file size directly.
    
    Args:
        path: Path to file or directory
    
    Returns:
        int: Total size in bytes
    """
    if os.path.isfile(path):
        return os.path.getsize(path)
    
    total_size = 0
    for dirpath, dirnames, filenames in os.walk(path):
        for filename in filenames:
            filepath = os.path.join(dirpath, filename)
            try:
                if os.path.exists(filepath):
                    total_size += os.path.getsize(filepath)
            except (OSError, PermissionError) as e:
                logger.warning(f"Could not get size of {filepath}: {e}")
                continue
    return total_size

def check_and_reserve_disk_space(source_path, dest_path, safety_buffer_percent=5, min_buffer_mb=500):
    """
    Verifies sufficient disk space and reserves it atomically (thread-safe).
    MUST be paired with release_disk_space_reservation() after copy completes.
    
    Args:
        source_path: Path to source file/directory
        dest_path: Destination directory path
        safety_buffer_percent: Percentage buffer (default 5%)
        min_buffer_mb: Minimum buffer in MB (default 500MB)
    
    Returns:
        tuple: (success: bool, message: str, details: dict)
               details contains: {'required_bytes', 'available_bytes', 'reserved_bytes', 'source_size'}
    
    Side Effects:
        On success: Adds reservation to RESERVED_SPACE global dict
        On failure: No reservation made
    
    Thread Safety:
        Uses SPACE_LOCK to ensure atomic check-and-reserve operation
    """
    global RESERVED_SPACE, SPACE_LOCK
    
    try:
        # 1. Calculate source size
        source_size = get_dir_size(source_path)
        if source_size == 0:
            return False, "Source is empty (0 bytes)", {}
        
        # 2. Calculate required space with buffer
        buffer_bytes = max(
            int(source_size * (safety_buffer_percent / 100)),
            min_buffer_mb * 1024 * 1024
        )
        required_bytes = source_size + buffer_bytes
        
        # 3. Thread-safe check and reserve
        with SPACE_LOCK:
            # Get actual free space on disk
            disk_free = get_disk_free_space(dest_path)
            
            # Calculate total reserved by active copies for this destination
            # Normalize path for consistent comparison
            dest_normalized = os.path.normpath(dest_path)
            total_reserved = RESERVED_SPACE.get(dest_normalized, 0)
            
            # Calculate truly available space
            available_bytes = disk_free - total_reserved
            
            # Check if sufficient
            if required_bytes > available_bytes:
                # Format sizes for error message
                def format_size(bytes_val):
                    gb = bytes_val / (1024**3)
                    if gb >= 1:
                        return f"{gb:.2f}GB"
                    else:
                        mb = bytes_val / (1024**2)
                        return f"{mb:.0f}MB"
                
                message = (
                    f"Insufficient disk space: Need {format_size(required_bytes)} "
                    f"({format_size(source_size)} + {format_size(buffer_bytes)} buffer), "
                    f"only {format_size(available_bytes)} available"
                )
                
                if total_reserved > 0:
                    message += f", {format_size(total_reserved)} reserved by active copies"
                
                return False, message, {
                    'required_bytes': required_bytes,
                    'available_bytes': available_bytes,
                    'reserved_bytes': total_reserved,
                    'source_size': source_size
                }
            
            # Reserve space
            RESERVED_SPACE[dest_normalized] = total_reserved + required_bytes
            
            logger.info(
                f"Space reserved: {required_bytes / (1024**3):.2f}GB for {os.path.basename(source_path)}, "
                f"Total reserved: {RESERVED_SPACE[dest_normalized] / (1024**3):.2f}GB, "
                f"Disk free: {disk_free / (1024**3):.2f}GB"
            )
            
            return True, "Space check passed", {
                'required_bytes': required_bytes,
                'available_bytes': available_bytes,
                'reserved_bytes': total_reserved,
                'source_size': source_size
            }
            
    except Exception as e:
        logger.error(f"Error checking disk space: {e}")
        return False, f"Error checking disk space: {str(e)}", {}

def release_disk_space_reservation(dest_path, reserved_bytes):
    """
    Releases disk space reservation. MUST be called after check_and_reserve_disk_space().
    Safe to call multiple times (idempotent).
    
    Args:
        dest_path: Destination directory path (same as used in check_and_reserve)
        reserved_bytes: Amount of bytes to release (from check_and_reserve return value)
    """
    global RESERVED_SPACE, SPACE_LOCK
    
    if reserved_bytes <= 0:
        return
    
    try:
        with SPACE_LOCK:
            dest_normalized = os.path.normpath(dest_path)
            current_reserved = RESERVED_SPACE.get(dest_normalized, 0)
            
            new_reserved = max(0, current_reserved - reserved_bytes)
            
            if new_reserved == 0:
                # Remove entry if no longer reserved
                RESERVED_SPACE.pop(dest_normalized, None)
            else:
                RESERVED_SPACE[dest_normalized] = new_reserved
            
            logger.info(
                f"Space released: {reserved_bytes / (1024**3):.2f}GB, "
                f"Remaining reserved: {new_reserved / (1024**3):.2f}GB"
            )
    except Exception as e:
        logger.error(f"Error releasing disk space reservation: {e}")

from database import MoveHistory, Movie

def download_image(url, filename, force=False):
    """
    Downloads an image from url and saves it to app/static/posters/filename.
    Returns the relative path for the frontend (e.g., 'posters/filename').
    If force=True, re-downloads even if file exists.
    """
    if not url:
        return None
    
    try:
        # Ensure directory exists
        save_dir = os.path.join(os.path.dirname(__file__), 'static', 'posters')
        os.makedirs(save_dir, exist_ok=True)
        
        save_path = os.path.join(save_dir, filename)
        
        # If file exists and not forcing, skip download (cache)
        if os.path.exists(save_path) and not force:
            return f"posters/{filename}"
        
        # Log the download attempt
        old_size = os.path.getsize(save_path) if os.path.exists(save_path) else 0
        logger.info(f"🖼️ [DOWNLOAD] Downloading: {url}")
        logger.info(f"🖼️ [DOWNLOAD] Saving to: {save_path} (force={force}, old_size={old_size})")
        
        res = requests.get(url, stream=True, timeout=10)
        if res.status_code == 200:
            with open(save_path, 'wb') as f:
                shutil.copyfileobj(res.raw, f)
            new_size = os.path.getsize(save_path)
            logger.info(f"🖼️ [DOWNLOAD] Success! New size: {new_size} bytes")
            return f"posters/{filename}"
        else:
            logger.error(f"🖼️ [DOWNLOAD] Failed! HTTP status: {res.status_code}")
    except Exception as e:
        logger.error(f"Error downloading image {url}: {e}")
    
    return None

def download_image_background(url, filename, movie_id, is_poster=True):
    """
    Downloads image in background and updates database when done.
    """
    try:
        local_path = download_image(url, filename, force=True)
        if local_path:
            # Update database in a thread-safe way (create new connection if needed)
            # Since Peewee handles connection pooling, we can just use the model
            from database import Movie
            try:
                movie = Movie.get_by_id(movie_id)
                if is_poster:
                    movie.poster_path = local_path
                else:
                    movie.backdrop_path = local_path
                movie.save()
                logger.info(f"Background download complete for {filename}")
            except Exception as e:
                logger.error(f"Error updating DB after background download: {e}")
    except Exception as e:
        logger.error(f"Error in background download: {e}")

def is_series(name):
    """
    Checks if a torrent name looks like a TV series.
    Matches: S01E01, S01, Season 1, 1x01, etc.
    """
    # Common patterns: S01E01, S01, 1x01, Season 1
    patterns = [
        r'(?i)s\d{1,2}e\d{1,2}', # S01E01
        r'(?i)s\d{1,2}',         # S01 (often followed by space or dot)
        r'(?i)season\s*\d+',     # Season 1
        r'\d{1,2}x\d{1,2}',      # 1x01
        r'(?i)cap\.\d+',         # Cap.1
        r'(?i)episodio\s*\d+'    # Episodio 1
    ]
    
    for p in patterns:
        if re.search(p, name):
            return True
    return False

def scrape_imdb_rating(imdb_id):
    """
    Scrapes IMDb rating directly from the movie page.
    Fallback since OMDb requires a paid key and free APIs are unreliable.
    """
    try:
        url = f"https://www.imdb.com/title/{imdb_id}/"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        res = requests.get(url, headers=headers, timeout=5)
        if res.status_code == 200:
            # Regex to find rating in JSON-LD
            # Pattern: "AggregateRating","ratingCount":12345,"bestRating":10,"worstRating":1,"ratingValue":8.7
            match = re.search(r'AggregateRating","ratingCount":(\d+),"bestRating":10,"worstRating":1,"ratingValue":(\d+(\.\d+)?)', res.text)
            if match:
                return match.group(2), match.group(1)
    except Exception as e:
        logger.error(f"Error scraping IMDb for {imdb_id}: {e}")
    return None, None

def fetch_complete_movie_metadata(title, year, api_key, images_only=False, tmdb_id=None):
    """
    Fetches complete metadata for a movie from TMDB, including:
    - Basic details (title, year, runtime, overview, genres)
    - Cast and crew
    - IMDb ID and rating
    - Poster and backdrop images
    """
    logger.info("=" * 80)
    logger.info(f"🎬 [TMDB] METADATA FETCH STARTED - '{title}' ({year})")
    logger.info("=" * 80)
    try:
        movie_id = None
        matched_result = None
        
        # If TMDB ID is provided (e.g., from RSS), use it directly
        if tmdb_id:
            logger.info(f"🎯 [TMDB] Using exact TMDB ID: {tmdb_id} (from RSS)")
            movie_id = int(tmdb_id)
            # Fetch basic details to get the matched result
            try:
                details_url = f"https://api.themoviedb.org/3/movie/{movie_id}"
                params = {"api_key": api_key, "language": get_language()}
                res = requests.get(details_url, params=params, timeout=5)
                if res.status_code == 200:
                    matched_result = res.json()
                    logger.info(f"✅ [TMDB] Exact match using ID: '{matched_result.get('title')}' ({matched_result.get('release_date', '')[:4] if matched_result.get('release_date') else 'Unknown'})")
                else:
                    logger.warning(f"⚠️ [TMDB] Failed to fetch movie with ID {tmdb_id}, falling back to search")
                    movie_id = None
            except Exception as e:
                logger.warning(f"⚠️ [TMDB] Error fetching movie with ID {tmdb_id}: {e}, falling back to search")
                movie_id = None
        
        # If no TMDB ID or direct fetch failed, search for movie
        if not movie_id:
            # ✅ PHASE 2: Check cache first
            cached = get_cached_tmdb_result(title, year)
            if cached:
                movie_id = cached.get('id')
                matched_result = cached
                logger.info(f"✅ [TMDB] Using cached result: '{cached.get('title')}' ({cached.get('release_date', '')[:4] if cached.get('release_date') else 'Unknown'})")
            else:
                # 1. Search for movie with fallback variants
                search_url = "https://api.themoviedb.org/3/search/movie"
                original_lang = get_language()
                
                # Generate search variants (ordered from most to least specific)
                variants = [
                    {"query": title, "year": year, "language": original_lang},  # Original with year
                    {"query": title, "language": original_lang},  # Without year
                ]
                
                # Variant 3: Remove trailing numbers (e.g., "Köln 75" → "Köln")
                import re
                title_no_numbers = re.sub(r'\s+\d+$', '', title).strip()
                if title_no_numbers != title:
                    variants.append({"query": title_no_numbers, "year": year, "language": original_lang})
                
                # Variant 4: Try in English
                if original_lang != 'en-US':
                    variants.append({"query": title, "year": year, "language": "en-US"})
                
                # Variant 5: Normalize special characters (ö→o, á→a, etc.)
                import unicodedata
                normalized = unicodedata.normalize('NFKD', title).encode('ascii', 'ignore').decode('utf-8')
                if normalized != title and normalized:
                    variants.append({"query": normalized, "year": year, "language": original_lang})
                
                # ✅ PHASE 2: Single loop with integrated fallback (was two separate loops)
                fallback_result = None  # Store first result as fallback
                
                for i, variant in enumerate(variants):
                    params = {"api_key": api_key, **variant}
                    logger.debug(f"🔧 [TMDB] Variant {i+1}/{len(variants)}: query='{variant['query']}', year={variant.get('year', 'None')}, lang={variant['language']}")
                    
                    res = requests.get(search_url, params=params, timeout=10)  # Increased timeout
                    search_data = res.json()
                    
                    if search_data.get('results'):
                        for result in search_data['results']:
                            result_year = result.get('release_date', '')[:4] if result.get('release_date') else None
                            result_title = result.get('title', 'Unknown')
                            
                            # Store first result as fallback (in case no year match)
                            if not fallback_result:
                                fallback_result = result
                            
                            # If year was provided, validate it matches (tolerance ±1 year)
                            if year:
                                if result_year:
                                    try:
                                        year_diff = abs(int(result_year) - int(year))
                                        if year_diff <= 1:
                                            movie_id = result['id']
                                            matched_result = result
                                            logger.info(f"✅ [TMDB] Matched '{result_title}' ({result_year}) - Year validated (diff: {year_diff})")
                                            break
                                    except (ValueError, TypeError):
                                        continue
                            else:
                                # No year provided, take first result
                                movie_id = result['id']
                                matched_result = result
                                logger.warning(f"⚠️ [TMDB] No year provided, using first result: '{result_title}' ({result_year or 'Unknown'})")
                                break
                        
                        # If we found a match, stop trying variants
                        if movie_id:
                            if i > 0:
                                logger.info(f"✅ [TMDB] Found movie using variant #{i+1}: '{variant['query']}'")
                            break
                
                # Use fallback if no exact year match found
                if not movie_id and fallback_result:
                    movie_id = fallback_result['id']
                    matched_result = fallback_result
                    result_year = fallback_result.get('release_date', '')[:4] if fallback_result.get('release_date') else 'Unknown'
                    result_title = fallback_result.get('title', 'Unknown')
                    logger.warning(f"⚠️ [TMDB] No exact year match for '{title}' ({year}). Using best guess: '{result_title}' ({result_year})")
                
                # ✅ PHASE 2: Cache the result
                if matched_result:
                    cache_tmdb_result(title, year, matched_result)

        
        if not movie_id:
            logger.warning(f"⚠️  [TMDB] No results found for '{title}' ({year})")
            return None
        
        # 2. Get full details (localized for metadata)
        details_url = f"https://api.themoviedb.org/3/movie/{movie_id}"
        details_res = requests.get(details_url, params={"api_key": api_key, "language": get_language()}, timeout=5)
        details = details_res.json()
        
        # ✅ FIX: Fetch without language to get original poster (not localized)
        # Sometimes TMDB returns different poster for localized vs original
        original_res = requests.get(details_url, params={"api_key": api_key}, timeout=5)
        if original_res.status_code == 200:
            original_details = original_res.json()
            if original_details.get('poster_path'):
                details['poster_path'] = original_details['poster_path']
            if original_details.get('backdrop_path'):
                details['backdrop_path'] = original_details['backdrop_path']
        
        # If we only need images, return early
        if images_only:
            return {
                'title': details.get('title'),
                'year': details.get('release_date', '')[:4],
                'poster_path': details.get('poster_path'),
                'backdrop_path': details.get('backdrop_path'),
            }

        # 3. Get credits (cast & crew)
        credits_url = f"https://api.themoviedb.org/3/movie/{movie_id}/credits"
        credits_res = requests.get(credits_url, params={"api_key": api_key}, timeout=5)
        credits = credits_res.json()
        
        # 4. Get external IDs (IMDb)
        external_ids_url = f"https://api.themoviedb.org/3/movie/{movie_id}/external_ids"
        external_ids_res = requests.get(external_ids_url, params={"api_key": api_key}, timeout=5)
        external_ids = external_ids_res.json()
        
        # Process cast (top 10)
        cast = []
        for person in credits.get('cast', [])[:10]:
            cast.append({
                "name": person.get('name'),
                "character": person.get('character'),
                "profile_path": f"https://image.tmdb.org/t/p/w185{person.get('profile_path')}" if person.get('profile_path') else None
            })
        
        # Process crew (key roles)
        crew = []
        key_jobs = ['Director', 'Writer', 'Screenplay', 'Producer']
        seen_names = set()
        for person in credits.get('crew', []):
            if person.get('job') in key_jobs and person.get('name') not in seen_names:
                crew.append({
                    "name": person.get('name'),
                    "job": person.get('job'),
                    "profile_path": f"https://image.tmdb.org/t/p/w185{person.get('profile_path')}" if person.get('profile_path') else None
                })
                seen_names.add(person.get('name'))
                if len(crew) >= 10:
                    break
        
        # Get IMDb rating if available
        imdb_id = external_ids.get('imdb_id')
        imdb_rating, imdb_votes = None, None
        if imdb_id:
            imdb_rating, imdb_votes = scrape_imdb_rating(imdb_id)
        
        # Get production country (use first country if multiple)
        production_countries = details.get('production_countries', [])
        country_code = None
        if production_countries and len(production_countries) > 0:
            country_code = production_countries[0].get('iso_3166_1')  # e.g., 'US', 'ES', 'FR'
        
        return {
            'title': details.get('title'),
            'year': details.get('release_date', '')[:4],
            'overview': details.get('overview'),
            'runtime': details.get('runtime'),
            'genres': json.dumps([g['name'] for g in details.get('genres', [])]),
            'poster_path': details.get('poster_path'),
            'backdrop_path': details.get('backdrop_path'),
            'vote_average': details.get('vote_average'),
            'vote_count': details.get('vote_count'),
            'cast': json.dumps(cast),
            'crew': json.dumps(crew),
            'imdb_id': imdb_id,
            'imdb_rating': imdb_rating,
            'imdb_votes': imdb_votes,
            'tmdb_id': movie_id,  # Add TMDB ID for multi-language search
            'country_code': country_code  # Add country code for flag display
        }
        
    except Exception as e:
        logger.error(f"❌ [TMDB] API error for '{title}' ({year}): {e}")
        return None

def get_movie_videos(tmdb_id, api_key):
    """
    Fetches movie trailers from TMDB API.
    Returns the YouTube key for the official trailer if available.
    
    Args:
        tmdb_id: TMDB movie ID
        api_key: TMDB API key
    
    Returns:
        dict with 'success', 'youtube_key', and 'name' if trailer found
        dict with 'success': False if no trailer available
    """
    try:
        # Get videos for this movie
        videos_url = f"https://api.themoviedb.org/3/movie/{tmdb_id}/videos"
        params = {"api_key": api_key, "language": get_language()}
        res = requests.get(videos_url, params=params, timeout=5)
        
        if res.status_code != 200:
            logger.error(f"TMDB videos API error: {res.status_code}")
            return {"success": False, "message": "API error"}
        
        data = res.json()
        videos = data.get('results', [])
        
        if not videos:
            # Try English fallback if no videos in configured language
            params['language'] = 'en-US'
            res = requests.get(videos_url, params=params, timeout=5)
            if res.status_code == 200:
                data = res.json()
                videos = data.get('results', [])
        
        # Filter for YouTube trailers
        trailers = [
            v for v in videos 
            if v.get('site') == 'YouTube' and v.get('type') == 'Trailer'
        ]
        
        if not trailers:
            return {"success": False, "message": "No trailer available"}
        
        # Prioritize official trailers
        official_trailers = [t for t in trailers if t.get('official', False)]
        trailer = official_trailers[0] if official_trailers else trailers[0]
        
        return {
            "success": True,
            "youtube_key": trailer.get('key'),
            "name": trailer.get('name', 'Trailer'),
            "official": trailer.get('official', False)
        }
        
    except Exception as e:
        logger.error(f"Error fetching movie videos: {e}")
        return {"success": False, "message": str(e)}


def sync_movies(torrents, api_key):
    """
    Syncs movies between qBittorrent torrents and the database.
    Creates new movie entries for torrents not in DB.
    Updates status for existing movies.
    Detects completed downloads for auto-copy.
    """
    logger.info("=" * 80)
    logger.info("💾 [DB] DATABASE SYNC STARTED")
    logger.info("=" * 80)
    
    logger.info(f"💾 [DB] Processing {len(torrents)} torrent(s)")
    if not api_key:
        return

    # 1. Update existing movies based on current torrents
    torrent_map = {t['hash']: t for t in torrents}
    
    # Update active torrents
    for t in torrents:
        movie = Movie.get_or_none(Movie.torrent_hash == t['hash'])
        
        if movie:
            # Skip if ignored
            if movie.ignored:
                continue

            # CAPTURE OLD STATUS BEFORE ANY MODIFICATIONS (Critical for download completion detection)
            old_status = movie.status

            # Update dynamic fields
            movie.progress = t['progress']
            movie.state = t['state']
            movie.size = t['size']
            
            # Backfill torrent_name if missing
            if not movie.torrent_name:
                movie.torrent_name = t['name']
            
            # Check if copying
            if t['hash'] in COPY_PROGRESS:
                movie.status = 'copying'
            else:
                # 1. Check current state (Prioritize active downloading)
                state = t['state']
                is_downloading = state in ['metaDL', 'allocating', 'queuedDL', 'downloading', 'forceDL', 'stalledDL', 'pausedDL']
                
                if is_downloading:
                    if state in ['metaDL', 'allocating', 'queuedDL']:
                        movie.status = 'new'
                    else:
                        movie.status = 'downloading'
                else:
                    # 2. If not downloading, check history (Has it been moved before?)
                    history = MoveHistory.select().where(MoveHistory.torrent_name == t['name']).order_by(MoveHistory.timestamp.desc()).first()
                    if history:
                         if history.status == 'success' or history.status == 'manual':
                             # Verify existence
                             settings = load_settings()
                             local_dest = settings.get('local_dest_path')
                             
                             # Reconstruct path logic
                             if local_dest and 'content_path' in t:
                                 normalized_path = t['content_path'].replace('\\', '/')
                                 item_name = os.path.basename(normalized_path.rstrip('/'))
                                 match = re.search(r"(.+?)\s\((\d{4})\)", item_name)
                                 
                                 if match:
                                     title = match.group(1).strip()
                                     year = match.group(2).strip()
                                     sanitized_title = sanitize_path_component(title)
                                     sanitized_year = sanitize_path_component(year)
                                     folder_name = f"{sanitized_title} ({sanitized_year})"
                                     dest_path = os.path.join(local_dest, folder_name)
                                     
                                     if os.path.exists(dest_path):
                                         movie.status = 'moved' if history.status == 'success' else 'moved_manually'
                                     else:
                                         receptor_enabled = settings.get('receptor_enabled', False)
                                         if not receptor_enabled or os.path.exists(local_dest):
                                             movie.status = 'missing'
                                         else:
                                             movie.status = 'moved' if history.status == 'success' else 'moved_manually'
                                 else:
                                     movie.status = 'moved' if history.status == 'success' else 'moved_manually'
                             else:
                                 movie.status = 'moved' if history.status == 'success' else 'moved_manually'
                                 
                         elif history.status in ['error', 'receptor_offline']: movie.status = 'error'
                         elif history.status == 'skipped': movie.status = 'skipped'
                    else:
                        # 3. No history and not downloading -> Pending or Error
                        if state in ['uploading', 'pausedUP', 'queuedUP', 'stalledUP', 'completed', 'checkingUP', 'checkingDL']:
                            movie.status = 'pending'
                        elif state in ['error', 'missingFiles']:
                            movie.status = 'error'
                        else:
                            movie.status = 'pending' # Default fallback
            
            # Save changes
            movie.save()
            
            # AUTO-COPY: Trigger copy if download just completed
            # Detect TWO scenarios:
            # 1. Normal: 'downloading' → 'pending/uploading/completed' (slow downloads)
            # 2. Fast: 'new' → 'pending/uploading/completed' (very fast downloads that skip 'downloading' state)
            download_completed = (
                (old_status == 'downloading' and movie.status in ['pending', 'uploading', 'completed', 'queuedUP', 'stalledUP']) or
                (old_status == 'new' and movie.status in ['pending', 'uploading', 'completed', 'queuedUP', 'stalledUP'])
            )
            
            # Selective debug logging ONLY for RSS movies (tagged with 'Roverr') to avoid log flooding
            if 'Roverr' in t.get('tags', ''):
                logger.info(f"RSS DEBUG [{movie.title}]: old={old_status}, new={movie.status}, completed={download_completed}")
            
            if download_completed:
                logger.info(f"Movie '{movie.title}' download completed, checking auto-copy...")
                
                # Notify Telegram: Download Complete
                settings = load_settings()
                if settings.get('telegram_notify_on_download_complete', True):
                    send_telegram_notification(f"✅ <b>Download Complete</b>\n\n🎬 {movie.title} ({movie.year})\n💾 Ready to move.")

                #  Check if this movie came from RSS with auto_copy enabled
                settings = load_settings()
                rss_feeds = settings.get('rss_feeds', [])
                auto_copy_manual = settings.get('auto_copy_manual_search', False)
                
                # Match by label/tag
                torrent_tags = t.get('tags', '')
                torrent_category = t.get('category', '')
                
                # DEBUG: Verify tags are now available
                logger.info(f"DEBUG: Torrent tags for '{movie.title}': '{torrent_tags}'")
                logger.info(f"DEBUG: Torrent category for '{movie.title}': '{torrent_category}'")
                logger.info(f"DEBUG: Number of RSS feeds configured: {len(rss_feeds)}")
                logger.info(f"DEBUG: Auto-copy manual search enabled: {auto_copy_manual}")
                
                # First, check RSS feeds
                rss_matched = False
                for feed in rss_feeds:
                    feed_label = feed.get('label', '')
                    feed_auto_copy = feed.get('auto_copy', False)
                    logger.info(f"DEBUG: Checking RSS feed '{feed.get('name')}' - label: '{feed_label}', auto_copy: {feed_auto_copy}")
                    
                    if feed_label and feed_label in torrent_tags:
                        logger.info(f"DEBUG: Label '{feed_label}' found in torrent tags!")
                        if feed.get('auto_copy', False):
                            logger.info(f"Auto-copying '{movie.title}' from RSS feed '{feed.get('name')}'")
                            try:
                                manual_move(t['hash'])
                                rss_matched = True
                            except Exception as e:
                                logger.error(f"Auto-copy failed for '{movie.title}': {e}")
                        else:
                            logger.info(f"DEBUG: auto_copy is disabled for this feed")
                        break
                    else:
                        logger.info(f"DEBUG: Label '{feed_label}' NOT found in tags '{torrent_tags}'")
                
                # If not matched by RSS, check manual search tag
                if not rss_matched:
                    if auto_copy_manual and MANUAL_SEARCH_TAG in torrent_tags:
                        logger.info(f"Auto-copying '{movie.title}' from manual search")
                        try:
                            manual_move(t['hash'])
                        except Exception as e:
                            logger.error(f"Auto-copy failed for '{movie.title}': {e}")
                    else:
                        logger.info(f"DEBUG: No auto-copy match found (RSS or manual search)")
                
                logger.info(f"DEBUG: Auto-copy check completed for '{movie.title}'")
                
            # AUTO-RETRY RECEPTOR: Check if a movie was stuck because the receptor was offline
            if old_status == 'receptor_offline' and movie.status in ['pending', 'uploading', 'completed', 'queuedUP', 'stalledUP']:
                # The torrent is still in the correct state, we should check if the receptor is back online
                logger.info(f"Movie '{movie.title}' is stuck waiting for Receptor. Checking Receptor status...")
                settings = load_settings()
                receptor_enabled = settings.get('receptor_enabled', False)
                if receptor_enabled:
                    host = settings.get('receptor_host')
                    port = settings.get('receptor_port', 8095)
                    if host:
                        try:
                            resp = requests.get(f"http://{host}:{port}/", timeout=3)
                            if resp.status_code == 200:
                                logger.info(f"Receptor appears to be back online. Retrying copy for '{movie.title}'")
                                # Send silent notification or let the next move log it
                                try:
                                    # Trigger copy process
                                    manual_move(t['hash'])
                                except Exception as e:
                                    logger.error(f"Failed to retry Receptor copy for '{movie.title}': {e}")
                            else:
                                 logger.debug(f"Receptor check returned HTTP {resp.status_code}. Still offline.")
                        except requests.exceptions.RequestException:
                             logger.debug("Receptor check failed. Still offline.")

        else:
            # Check if it's a series
            if is_series(t['name']):
                logger.info(f"Skipping series: {t['name']}")
                continue

            # New Movie Found!
            logger.info(f"New movie detected: {t['name']}")
            try:
                # Fetch complete TMDB metadata
                title, year = clean_torrent_name(t['name'])
                metadata = fetch_complete_movie_metadata(title, year, api_key)
                
                poster_local = None
                backdrop_local = None
                
                if metadata:
                    # Download Images
                    if metadata.get('poster_path'):
                        poster_url = f"https://image.tmdb.org/t/p/w500{metadata.get('poster_path')}"
                        poster_local = download_image(poster_url, f"{t['hash']}_poster.jpg")
                        
                    if metadata.get('backdrop_path'):
                        backdrop_url = f"https://image.tmdb.org/t/p/w1280{metadata.get('backdrop_path')}"
                        backdrop_local = download_image(backdrop_url, f"{t['hash']}_backdrop.jpg")
                    
                    # Create DB Entry with complete metadata
                    if not Movie.select().where(Movie.torrent_hash == t['hash']).exists():
                        # Determine initial status based on torrent state (instead of hardcoded 'pending')
                        state = t['state']
                        if state in ['metaDL', 'allocating', 'queuedDL']:
                            initial_status = 'new'
                        elif state in ['downloading', 'forceDL', 'stalledDL', 'pausedDL']:
                            initial_status = 'downloading'
                        elif state in ['uploading', 'pausedUP', 'queuedUP', 'stalledUP', 'completed', 'checkingUP', 'checkingDL']:
                            initial_status = 'pending'
                        elif state in ['error', 'missingFiles']:
                            initial_status = 'error'
                        else:
                            initial_status = 'pending'  # Fallback
                        
                        Movie.create(
                            torrent_hash=t['hash'],
                            title=metadata.get('title', title),
                            year=metadata.get('year', year),
                            poster_path=poster_local,
                            backdrop_path=backdrop_local,
                            overview=metadata.get('overview'),
                            runtime=metadata.get('runtime'),
                            genres=metadata.get('genres'), # Already JSON string from fetch_complete_movie_metadata
                            state=t['state'],
                            progress=t['progress'],
                            size=t['size'],
                            status=initial_status,  # Use intelligent status based on torrent state
                            cast=metadata.get('cast'), # Already JSON string
                            crew=metadata.get('crew'), # Already JSON string
                            vote_average=metadata.get('vote_average'),
                            vote_count=metadata.get('vote_count'),
                            imdb_id=metadata.get('imdb_id'),
                            imdb_rating=metadata.get('imdb_rating'),
                            imdb_votes=metadata.get('imdb_votes'),
                            tmdb_id=metadata.get('tmdb_id'),  # Save TMDB ID for multi-language search
                            country_code=metadata.get('country_code'),  # Save country code for flag display
                            metadata_updated_at=datetime.now(),
                            torrent_name=t['name']
                        )
                        
                        # Notify Telegram: New Movie Found
                        settings = load_settings()
                        if settings.get('telegram_notify_on_new_movie', True):
                            send_telegram_notification(f"🆕 <b>New Movie Found</b>\n\n🎬 {metadata.get('title', title)} ({metadata.get('year', year)})\n📥 Added to Dashboard.")

            except Exception as e:
                logger.error(f"Error adding movie {t['name']}: {e}")

    # 2. Cleanup Ignored Movies - DISABLED
    # DO NOT delete ignored movies when torrent disappears from torrent client
    # Reason: Ignored movies must persist permanently until user manually un-ignores them
    # Problem: If we delete them, RSS will re-add them as "new" on next fetch
    # Solution: Let ignored movies stay in DB forever, user can manage from Settings > Advanced
    
    # ORIGINAL CODE (now disabled):
    # should_cleanup = True
    # if not torrents:
    #     try:
    #         settings = load_settings()
    #         qb = get_qb_client(settings)
    #         qb.auth_log_in()
    #     except Exception:
    #         should_cleanup = False
    #         logger.warning("Skipping ignored cleanup due to torrent client connection failure")
    #
    # if should_cleanup:
    #     active_hashes = set(t['hash'] for t in torrents)
    #     ignored_movies = Movie.select().where(Movie.ignored == True)
    #     
    #     for m in ignored_movies:
    #         if m.status == 'rss_new':
    #             continue
    #
    #         if m.torrent_hash not in active_hashes:
    #             logger.info(f"Removing ignored status for deleted torrent: {m.title}")
    #             m.delete_instance()

    
    # 3. Mark movies as orphaned if they are not in active torrents list
    active_hashes = set(t['hash'] for t in torrents)
    for movie in Movie.select().where(Movie.ignored == False):
        if movie.torrent_hash not in active_hashes:
            # Skip RSS movies - they don't have torrents in torrent client
            if movie.state == 'rss':
                continue

            # Movie is in DB but not in active torrents = orphaned
            if movie.status != 'orphaned':
                logger.info(f"Marking movie as orphaned: {movie.title} ({movie.torrent_hash})")
                movie.status = 'orphaned'
                movie.progress = 0.0
                movie.state = 'orphaned'
                movie.save()

    trigger_movies_update_callback()


def get_movie_data(torrents, api_key):
    """
    Returns list of movies from the Database AND list of ignored series.
    Triggers a sync first.
    """
    # Trigger sync
    sync_movies(torrents, api_key)
    
    # Return all movies from DB (excluding ignored)
    movies = []
    base_dir = os.path.join(os.path.dirname(__file__), 'static')
    
    for m in Movie.select().where((Movie.ignored == False) & ((Movie.watchlist == False) | (Movie.watchlist.is_null()))).order_by(Movie.added_at.desc()):
        # Check if poster file exists, if not try to re-download
        if m.poster_path:
            poster_full_path = os.path.join(base_dir, m.poster_path)
            if not os.path.exists(poster_full_path):
                logger.warning(f"Poster missing for {m.title}, attempting re-download")
                # Try to get TMDB data and re-download
                try:
                    search_url = "https://api.themoviedb.org/3/search/movie"
                    params = {"api_key": api_key, "query": m.title, "language": get_language(), "year": m.year}
                    res = requests.get(search_url, params=params, timeout=5)
                    data = res.json()
                    
                    if data.get('results'):
                        result = data['results'][0]
                        if result.get('poster_path'):
                            poster_url = f"https://image.tmdb.org/t/p/w500{result.get('poster_path')}"
                            new_poster = download_image(poster_url, f"{m.torrent_hash}_poster.jpg", force=True)
                            if new_poster:
                                m.poster_path = new_poster
                                m.save()
                except Exception as e:
                    logger.error(f"Error re-downloading poster for {m.title}: {e}")
        
        # Use placeholder if no poster exists
        poster_display = m.poster_path if m.poster_path else 'posters/placeholder_unidentified.png'
        
        movies.append({
            "title": m.title,
            "year": m.year,
            "poster_url": poster_display,
            "backdrop_url": m.backdrop_path,
            "overview": m.overview,
            "torrent_hash": m.torrent_hash,
            "status": m.status,
            "status_reason": m.status_reason if hasattr(m, 'status_reason') else None,
            "progress": m.progress,
            "state": m.state,
            "size": m.size,
            "poster_updated": int(m.metadata_updated_at.timestamp()) if m.metadata_updated_at else 0
        })
        
    # Identify ignored series from active torrents
    ignored_series = []
    for t in torrents:
        # If not in DB and is_series -> Ignored
        if is_series(t['name']) and not Movie.select().where(Movie.torrent_hash == t['hash']).exists():
            ignored_series.append(t['name'])
            
    return {"movies": movies, "ignored_series": ignored_series}

def identify_movie(torrent_hash, tmdb_id, api_key):
    """
    Manually identifies a movie by TMDB ID.
    Updates the existing DB record with new metadata, images, cast, crew, and ratings.
    """
    movie = Movie.get_or_none(Movie.torrent_hash == torrent_hash)
    if not movie:
        return False, "Movie not found in dashboard"
        
    try:
        # Fetch complete details from TMDB (localized for metadata)
        url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
        params = {"api_key": api_key, "language": get_language()}
        res = requests.get(url, params=params, timeout=5)
        
        if res.status_code != 200:
            return False, "TMDB ID not found"
            
        details = res.json()
        
        # ✅ FIX: Also fetch without language to get original poster (not localized)
        # Sometimes TMDB returns different poster for localized vs original
        original_params = {"api_key": api_key}  # No language = original poster
        original_res = requests.get(url, params=original_params, timeout=5)
        if original_res.status_code == 200:
            original_details = original_res.json()
            # Use original poster/backdrop since localized versions may differ
            if original_details.get('poster_path'):
                details['poster_path'] = original_details['poster_path']
            if original_details.get('backdrop_path'):
                details['backdrop_path'] = original_details['backdrop_path']
            logger.info(f"🖼️ [IDENTIFY] Using original poster: {details.get('poster_path')}")
        
        # Get credits (cast & crew)
        credits_url = f"https://api.themoviedb.org/3/movie/{tmdb_id}/credits"
        credits_res = requests.get(credits_url, params={"api_key": api_key}, timeout=5)
        credits = credits_res.json()
        
        # Get external IDs (IMDb)
        external_ids_url = f"https://api.themoviedb.org/3/movie/{tmdb_id}/external_ids"
        external_ids_res = requests.get(external_ids_url, params={"api_key": api_key}, timeout=5)
        external_ids = external_ids_res.json()
        
        # Process cast (top 10)
        cast = []
        for person in credits.get('cast', [])[:10]:
            cast.append({
                "name": person.get('name'),
                "character": person.get('character'),
                "profile_path": f"https://image.tmdb.org/t/p/w185{person.get('profile_path')}" if person.get('profile_path') else None
            })
        
        # Process crew (key roles)
        crew = []
        key_jobs = ['Director', 'Writer', 'Screenplay', 'Producer']
        seen_names = set()
        for person in credits.get('crew', []):
            if person.get('job') in key_jobs and person.get('name') not in seen_names:
                crew.append({
                    "name": person.get('name'),
                    "job": person.get('job'),
                    "profile_path": f"https://image.tmdb.org/t/p/w185{person.get('profile_path')}" if person.get('profile_path') else None
                })
                seen_names.add(person.get('name'))
                if len(crew) >= 10:
                    break
        
        # Get IMDb rating if available
        imdb_id = external_ids.get('imdb_id')
        imdb_rating, imdb_votes = None, None
        if imdb_id:
            imdb_rating, imdb_votes = scrape_imdb_rating(imdb_id)
        
        # Get production country (use first country if multiple)
        production_countries = details.get('production_countries', [])
        country_code = None
        if production_countries and len(production_countries) > 0:
            country_code = production_countries[0].get('iso_3166_1')
        
        # Update Metadata
        movie.title = details.get('title')
        movie.year = details.get('release_date', '')[:4]
        movie.overview = details.get('overview')
        movie.runtime = details.get('runtime')
        movie.genres = json.dumps([g['name'] for g in details.get('genres', [])])
        movie.vote_average = details.get('vote_average')
        movie.vote_count = details.get('vote_count')
        movie.cast = json.dumps(cast)
        movie.crew = json.dumps(crew)
        movie.imdb_id = imdb_id
        movie.imdb_rating = imdb_rating
        movie.imdb_votes = imdb_votes
        movie.country_code = country_code
        movie.metadata_updated_at = datetime.now()
        movie.tmdb_id = tmdb_id  # ✅ FIX: Save TMDB ID
        
        # Update Images - force re-download with new TMDB data
        logger.info(f"🖼️ [IDENTIFY] Downloading new images for '{movie.title}' from TMDB ID {tmdb_id}")
        if details.get('poster_path'):
            poster_url = f"https://image.tmdb.org/t/p/w500{details.get('poster_path')}"
            logger.info(f"🖼️ [IDENTIFY] Poster URL: {poster_url}")
            movie.poster_path = download_image(poster_url, f"{torrent_hash}_poster.jpg", force=True)
            logger.info(f"🖼️ [IDENTIFY] Poster saved to: {movie.poster_path}")
            
        if details.get('backdrop_path'):
            backdrop_url = f"https://image.tmdb.org/t/p/w1280{details.get('backdrop_path')}"
            movie.backdrop_path = download_image(backdrop_url, f"{torrent_hash}_backdrop.jpg", force=True)
            
        movie.save()
        trigger_movies_update_callback()
        return True, "Movie identified successfully"
        
    except Exception as e:
        logger.error(f"Error identifying movie {torrent_hash}: {e}")
        return False, str(e)

def delete_movie(torrent_hash, ignore_movie=True):
    """
    Removes a movie from the dashboard.
    If ignore_movie is True, marks it as ignored.
    If ignore_movie is False, deletes it from the database.
    """
    logger.info(f"delete_movie called for hash: {torrent_hash}, ignore_movie={ignore_movie}")
    movie = Movie.get_or_none(Movie.torrent_hash == torrent_hash)
    if not movie:
        logger.warning(f"Movie not found for hash: {torrent_hash}")
        return False
    
    movie_title = f"{movie.title} ({movie.year})" if movie.year else movie.title
    logger.info(f"Removing movie from dashboard: {movie_title}")
    
    # Delete images  
    try:
        base_dir = os.path.join(os.path.dirname(__file__), 'static')
        if movie.poster_path:
            p = os.path.join(base_dir, movie.poster_path)
            if os.path.exists(p): os.remove(p)
            
        if movie.backdrop_path:
            p = os.path.join(base_dir, movie.backdrop_path)
            if os.path.exists(p): os.remove(p)
    except Exception as e:
        logger.error(f"Error deleting images for {torrent_hash}: {e}")
    
    # Remove from history
    logger.info(f"Removing history for movie: {movie_title} ({torrent_hash})")
    try:
        from database import MoveHistory
        if movie.torrent_name:
            deleted_count = MoveHistory.delete().where(MoveHistory.torrent_name == movie.torrent_name).execute()
            logger.info(f"Deleted {deleted_count} history records for {movie_title}")
    except Exception as e:
        logger.error(f"Error removing history for {torrent_hash}: {e}")
    
    if ignore_movie:
        # Mark as ignored (do NOT delete) to prevent sync_movies from re-adding it
        movie.ignored = True
        movie.ignored_at = datetime.now()
        movie.save()
        logger.info(f"Successfully removed movie from dashboard (ignored): {movie_title}")
        trigger_movies_update_callback()
    else:
        # Hard delete from database
        movie.delete_instance()
        logger.info(f"Successfully deleted movie from database: {movie_title}")
        trigger_movies_update_callback()
        
    return True

def add_to_watchlist(torrent_hash, days):
    """
    Adds a movie to the watchlist with expiration.
    Args:
        torrent_hash: Movie hash
        days: Number of days to keep in watchlist
    Returns:
        True if successful, False otherwise
    """
    from datetime import timedelta
    
    movie = Movie.get_or_none(Movie.torrent_hash == torrent_hash)
    if not movie:
        logger.warning(f"Movie not found for hash: {torrent_hash}")
        return False
    
    movie.watchlist = True
    movie.watchlist_expiry = datetime.now() + timedelta(days=int(days))
    movie.ignored = False  # Can't be both in watchlist and ignored
    movie.save()
    
    logger.info(f"Added '{movie.title}' ({movie.year}) to watchlist for {days} days")
    return True


def get_watchlist_movies():
    """
    Returns all movies in watchlist with expiry info.
    Returns:
        List of dicts with movie info and expiry data
    """
    movies = Movie.select().where(Movie.watchlist == True).order_by(Movie.watchlist_expiry)
    
    result = []
    for m in movies:
        days_remaining = None
        if m.watchlist_expiry:
            delta = m.watchlist_expiry - datetime.now()
            days_remaining = max(0, delta.days)
        
        result.append({
            "torrent_hash": m.torrent_hash,
            "title": m.title,
            "year": m.year,
            "expires_at": m.watchlist_expiry.isoformat() if m.watchlist_expiry else None,
            "days_remaining": days_remaining
        })
    
    return result


def remove_from_watchlist(torrent_hash):
    """
    Removes a movie from watchlist.
    Args:
        torrent_hash: Movie hash
    Returns:
        True if successful, False otherwise
    """
    movie = Movie.get_or_none(Movie.torrent_hash == torrent_hash)
    if not movie:
        logger.warning(f"Movie not found for hash: {torrent_hash}")
        return False
    
    movie.watchlist = False
    movie.watchlist_expiry = None
    movie.save()
    
    logger.info(f"Removed '{movie.title}' ({movie.year}) from watchlist")
    return True


def check_torrent_size_available(title, year, preferred_size, max_size):
    """
    Searches indexers to see if a torrent with acceptable size exists.
    Args:
        title: Movie title
        year: Movie year
        preferred_size: Preferred file size in GB
        max_size: Maximum file size in GB
    Returns:
        True if acceptable size found, False otherwise
    """
    settings = load_settings()
    indexers = settings.get('indexers', [])
    
    if not indexers:
        return False
    
    for indexer in indexers:
        try:
            # Search each indexer
            search_results = search_indexer(indexer, title, year)
            
            for result in search_results:
                size_bytes = result.get('size', 0)
                size_gb = size_bytes / (1024**3) if size_bytes > 0 else 0
                
                # Check if size is acceptable
                if preferred_size > 0:
                    # Within 2GB of preferred size
                    if abs(size_gb - preferred_size) <= 2:
                        logger.info(f"Found acceptable size {size_gb:.2f}GB for '{title}' (preferred: {preferred_size}GB)")
                        return True
                
                if max_size > 0:
                    # Under max size
                    if 0 < size_gb <= max_size:
                        logger.info(f"Found acceptable size {size_gb:.2f}GB for '{title}' (max: {max_size}GB)")
                        return True
                        
        except Exception as e:
            logger.error(f"Error checking size for {title} in {indexer.get('name')}: {e}")
            continue
    
    return False

def get_movie_details(torrent_hash, api_key):
    """
    Fetches detailed movie info including runtime and paths.
    Uses cached data from database when available, only queries TMDB if cache is empty.
    """
    settings = load_settings()
    qb = get_qb_client(settings)
    
    try:
        qb.auth_log_in()
        torrents = qb.torrents_info(torrent_hashes=torrent_hash)
        
        # Fallback: If filter fails, try iterating all (robustness)
        if not torrents:
            all_torrents = qb.torrents_info()
            for t in all_torrents:
                if t.hash.lower() == torrent_hash.lower():
                    torrents = [t]
                    break
        
        if not torrents:
            # Try to get from DB first to show metadata even if torrent is gone
            logger.info(f"No torrent found in torrent client for hash: {torrent_hash}")
            movie = Movie.get_or_none(Movie.torrent_hash == torrent_hash)
            
            if movie:
                # DEBUG: Verify hash matches
                if movie.torrent_hash != torrent_hash:
                    logger.error(f"HASH MISMATCH! Requested: {torrent_hash}, Got: {movie.torrent_hash}, Title: {movie.title}")
                else:
                    logger.info(f"Retrieved movie from DB: '{movie.title}' ({movie.year}) - Hash: {movie.torrent_hash[:8]}... State: {movie.state}")
                
                # For RSS movies (state='rss'), preserve their original status
                # They don't have torrents in torrent client, so they're not really orphaned
                if movie.state == 'rss':
                    logger.info(f"Returning RSS movie details for: '{movie.title}' ({movie.year})")
                    return {
                        "title": movie.title,
                        "year": movie.year,
                        "overview": movie.overview or "Imported from RSS",
                        "poster_url": movie.poster_path,
                        "backdrop_url": movie.backdrop_path,
                        "cast": json.loads(movie.cast) if movie.cast else [],
                        "crew": json.loads(movie.crew) if movie.crew else [],
                        "status": movie.status,  # Preserve original status (e.g., 'new')
                        "torrent_hash": torrent_hash,
                        "size": movie.size,
                        "progress": movie.progress,
                        "state": movie.state,
                        "source_path": "RSS Feed",
                        "dest_path": "N/A",
                        "runtime": movie.runtime or 0,
                        "vote_average": movie.vote_average,
                        "vote_count": movie.vote_count,
                        "imdb_id": movie.imdb_id,
                        "imdb_rating": movie.imdb_rating,
                        "imdb_votes": movie.imdb_votes,
                        "genres": json.loads(movie.genres) if movie.genres else [],
                        "tmdb_id": movie.tmdb_id if hasattr(movie, 'tmdb_id') else None,
                        "country_code": movie.country_code if hasattr(movie, 'country_code') else None
                    }
                
                # For regular torrents, return with orphaned status
                return {
                    "title": movie.title,
                    "year": movie.year,
                    "overview": "This movie is no longer in the torrent client. It is orphaned.",
                    "poster_url": movie.poster_path,
                    "backdrop_url": movie.backdrop_path,
                    "cast": json.loads(movie.cast) if movie.cast else [],
                    "crew": json.loads(movie.crew) if movie.crew else [],
                    "status": "orphaned",
                    "torrent_hash": torrent_hash,
                    "size": 0,
                    "progress": 0,
                    "source_path": "Unknown",
                    "dest_path": "Unknown",
                    "runtime": 0,
                    "vote_average": movie.vote_average,
                    "vote_count": movie.vote_count,
                    "imdb_id": movie.imdb_id,
                    "imdb_rating": movie.imdb_rating,
                    "imdb_votes": movie.imdb_votes
                }
            
            # Return a ghost object to allow deletion if not in DB either
            return {
                "title": "Orphaned Movie",
                "year": "N/A",
                "overview": "This movie is no longer in the torrent client but appears to be stuck. You can remove it from the dashboard.",
                "poster_url": None,
                "backdrop_url": None,
                "cast": [],
                "crew": [],
                "status": "orphaned",
                "torrent_hash": torrent_hash,
                "size": 0,
                "progress": 0,
                "source_path": "Unknown",
                "dest_path": "Unknown",
                "runtime": 0,
                "vote_average": 0,
                "vote_count": 0,
                "imdb_id": None,
                "imdb_rating": "N/A",
                "imdb_votes": "N/A"
            }
        
        # Safety check: Ensure we have a valid torrent before proceeding
        if not torrents or len(torrents) == 0:
            logger.error(f"Unexpected state: No torrent found but reached torrent processing for {torrent_hash}")
            # Try to return from DB if available
            movie = Movie.get_or_none(Movie.torrent_hash == torrent_hash)
            if movie:
                return {
                    "title": movie.title,
                    "year": movie.year,
                    "overview": "This movie is no longer in the torrent client.",
                    "poster_url": movie.poster_path,
                    "backdrop_url": movie.backdrop_path,
                    "cast": json.loads(movie.cast) if movie.cast else [],
                    "crew": json.loads(movie.crew) if movie.crew else [],
                    "status": "orphaned",
                    "torrent_hash": torrent_hash,
                    "size": 0,
                    "progress": 0,
                    "source_path": "Unknown",
                    "dest_path": "Unknown",
                    "runtime": movie.runtime or 0,
                    "vote_average": movie.vote_average,
                    "vote_count": movie.vote_count,
                    "imdb_id": movie.imdb_id,
                    "imdb_rating": movie.imdb_rating,
                    "imdb_votes": movie.imdb_votes
                }
            return {"error": "Movie not found in torrent client"}
            
        t = torrents[0]
        name = t.name
        
        # Try to get cached data from database first
        movie = Movie.get_or_none(Movie.torrent_hash == torrent_hash)
        
        if movie:
            pass # Movie found

        
        movie_details = {}
        
        # Check if we have cached metadata
        if movie and movie.cast:
            # Use cached data (instant!)
            logger.info(f"Using cached metadata for {movie.title}")
            
            # IMPORTANT: If movie was previously ignored, un-ignore it since user is manually downloading it
            if movie.ignored:
                logger.info(f"Un-ignoring '{movie.title}' - user manually downloaded it")
                movie.ignored = False
                movie.save()
            
            # Parse JSON fields
            cast = json.loads(movie.cast) if movie.cast else []
            crew = json.loads(movie.crew) if movie.crew else []
            
            # Validate image paths - ensure they exist, re-download if missing
            poster_url = None
            backdrop_url = None
            
            if movie.poster_path:
                # Check if file actually exists
                poster_full_path = os.path.join(os.path.dirname(__file__), 'static', movie.poster_path)
                if os.path.exists(poster_full_path):
                    poster_url = movie.poster_path
                else:
                    # Image missing, try to re-download from TMDB if we have metadata
                    logger.warning(f"Poster missing for {movie.title}, attempting re-download")
                    try:
                        # Use images_only=True to be much faster
                        metadata = fetch_complete_movie_metadata(movie.title, movie.year, api_key, images_only=True)
                        if metadata and metadata.get('poster_path'):
                            # Use remote URL immediately
                            poster_url = f"https://image.tmdb.org/t/p/w500{metadata.get('poster_path')}"
                            # Trigger background download
                            threading.Thread(
                                target=download_image_background,
                                args=(poster_url, f"{torrent_hash}_poster.jpg", movie.id, True)
                            ).start()
                    except Exception as e:
                        logger.error(f"Error triggering background poster download: {e}")
                    
            if movie.backdrop_path:
                # Check if file actually exists
                backdrop_full_path = os.path.join(os.path.dirname(__file__), 'static', movie.backdrop_path)
                if os.path.exists(backdrop_full_path):
                    backdrop_url = movie.backdrop_path
                else:
                    # Image missing, try to re-download from TMDB if we have metadata
                    logger.warning(f"Backdrop missing for {movie.title}, attempting re-download")
                    try:
                        # Use images_only=True to be much faster
                        metadata = fetch_complete_movie_metadata(movie.title, movie.year, api_key, images_only=True)
                        if metadata and metadata.get('backdrop_path'):
                            # Use remote URL immediately
                            backdrop_url = f"https://image.tmdb.org/t/p/w1280{metadata.get('backdrop_path')}"
                            # Trigger background download
                            threading.Thread(
                                target=download_image_background,
                                args=(backdrop_url, f"{torrent_hash}_backdrop.jpg", movie.id, False)
                            ).start()
                    except Exception as e:
                        logger.error(f"Error triggering background backdrop download: {e}")
            
            movie_details = {
                "title": movie.title,
                "year": movie.year,
                "runtime": movie.runtime,
                "overview": movie.overview,
                "poster_url": poster_url,
                "backdrop_url": backdrop_url,
                "genres": json.loads(movie.genres) if movie.genres else [],
                "vote_average": movie.vote_average,
                "vote_count": movie.vote_count,
                "cast": cast,
                "crew": crew,
                "imdb_id": movie.imdb_id,
                "imdb_rating": movie.imdb_rating,
                "imdb_votes": movie.imdb_votes,
                "tmdb_id": movie.tmdb_id if hasattr(movie, 'tmdb_id') else None,
                "country_code": movie.country_code if hasattr(movie, 'country_code') else None,
                "poster_updated": int(movie.metadata_updated_at.timestamp()) if movie.metadata_updated_at else 0,
                "status_reason": movie.status_reason if hasattr(movie, 'status_reason') else None
            }
        else:
            # No cache, fetch from TMDB
            # FIX: For RSS movies or DB entries, use stored title instead of torrent name
            if movie:
                # Use DB title if available (e.g., RSS movies)
                logger.info(f"No cache for '{movie.title}', fetching from TMDB")
                title = movie.title
                year = movie.year
            else:
                # Extract from torrent name for non-DB torrents
                logger.info(f"No cache found for {name}, extracting title from torrent name")
                title, year = clean_torrent_name(name)
            
            metadata = fetch_complete_movie_metadata(title, year, api_key)
            
            if metadata:
                # Download images
                poster_local = None
                backdrop_local = None
                
                if metadata.get('poster_path'):
                    poster_url = f"https://image.tmdb.org/t/p/w500{metadata.get('poster_path')}"
                    poster_local = download_image(poster_url, f"{torrent_hash}_poster.jpg")
                    
                if metadata.get('backdrop_path'):
                    backdrop_url = f"https://image.tmdb.org/t/p/w1280{metadata.get('backdrop_path')}"
                    backdrop_local = download_image(backdrop_url, f"{torrent_hash}_backdrop.jpg")
                
                # Parse cast/crew from JSON strings
                cast = json.loads(metadata.get('cast', '[]'))
                crew = json.loads(metadata.get('crew', '[]'))
                genres = json.loads(metadata.get('genres', '[]')) if isinstance(metadata.get('genres'), str) else []
                
                movie_details = {
                    "title": metadata.get('title', title),
                    "year": metadata.get('year', year),
                    "runtime": metadata.get('runtime'),
                    "overview": metadata.get('overview'),
                    "poster_url": poster_local,
                    "backdrop_url": backdrop_local,
                    "genres": genres,
                    "vote_average": metadata.get('vote_average'),
                    "vote_count": metadata.get('vote_count'),
                    "cast": cast,
                    "crew": crew,
                    "imdb_id": metadata.get('imdb_id'),
                    "imdb_rating": metadata.get('imdb_rating'),
                    "imdb_votes": metadata.get('imdb_votes'),
                    "tmdb_id": metadata.get('tmdb_id'),
                    "country_code": metadata.get('country_code'),
                    "poster_updated": int(datetime.now().timestamp())
                }
                
                # Update database with cached metadata
                if movie:
                    movie.title = metadata.get('title', title)
                    movie.year = metadata.get('year', year)
                    movie.overview = metadata.get('overview')
                    movie.runtime = metadata.get('runtime')
                    movie.genres = metadata.get('genres')
                    movie.poster_path = poster_local
                    movie.backdrop_path = backdrop_local
                    movie.cast = metadata.get('cast')
                    movie.crew = metadata.get('crew')
                    movie.vote_average = metadata.get('vote_average')
                    movie.vote_count = metadata.get('vote_count')
                    movie.imdb_id = metadata.get('imdb_id')
                    movie.imdb_rating = metadata.get('imdb_rating')
                    movie.imdb_votes = metadata.get('imdb_votes')
                    movie.metadata_updated_at = datetime.now()
                    movie.save()
            else:
                # TMDB fetch failed - Movie not found
                logger.warning(f"⚠️  [TMDB] No results found for '{title}' ({year})")
                
                # Use placeholder image for unidentified movies
                placeholder_poster = 'posters/placeholder_unidentified.png'
                
                movie_details = {
                    "title": title,
                    "year": year,
                    "overview": "⚠️ This movie could not be identified in TMDB. You can manually identify it using the 'Identify Manually' button.",
                    "poster_url": placeholder_poster,
                    "backdrop_url": None,
                    "cast": [],
                    "crew": [],
                    "runtime": 0,
                    "vote_average": 0,
                    "vote_count": 0,
                    "genres": [],
                    "imdb_id": None,
                    "imdb_rating": None,
                    "imdb_votes": None,
                    "tmdb_id": None,
                    "country_code": None
                }
                
                # Update database to save placeholder
                if movie:
                    movie.poster_path = placeholder_poster
                    movie.overview = movie_details["overview"]
                    movie.save()

        # Calculate Paths & Status (dynamic data from torrent client)
        content_path = t.content_path
        normalized_path = content_path.replace('\\', '/')
        item_name = os.path.basename(normalized_path.rstrip('/'))
        
        local_source = settings.get('local_source_path', '')
        local_dest = settings.get('local_dest_path', '')
        
        title = movie_details.get('title', clean_torrent_name(name)[0])
        year = movie_details.get('year', clean_torrent_name(name)[1])
        
        # DEBUG: Log original values
        logger.info(f"DEBUG PATH CHECK - Original title: '{title}', year: '{year}'")
        
        # Apply sanitization to title and year to match the actual folder/file names created by manual_move
        # This ensures consistent naming when checking file existence
        sanitized_title = sanitize_path_component(str(title))
        sanitized_year = sanitize_path_component(str(year))
        
        # DEBUG: Log sanitized values
        logger.info(f"DEBUG PATH CHECK - Sanitized title: '{sanitized_title}', year: '{sanitized_year}'")
        
        folder_name = f"{sanitized_title} ({sanitized_year})"
        dest_path = os.path.join(local_dest, folder_name)
        
        # DEBUG: Log constructed path
        logger.info(f"DEBUG PATH CHECK - Constructed dest_path: '{dest_path}'")
        
        # For RSS movies, preserve their DB status and skip torrent-based calculation
        if movie and movie.state == 'rss':
            status = movie.status  # Use status from database (e.g., 'new')
        else:
            # For regular torrents, calculate status from torrent client state and history
            # Check DB for history
            history = MoveHistory.select().where(MoveHistory.torrent_name == t.name).order_by(MoveHistory.timestamp.desc()).first()
            status = 'pending'
            
            # 1. Check current state (Prioritize active downloading)
            state = t.state
            is_downloading = state in ['metaDL', 'allocating', 'queuedDL', 'downloading', 'forceDL', 'stalledDL', 'pausedDL']
            
            if is_downloading:
                if state in ['metaDL', 'allocating', 'queuedDL']:
                    status = 'new'
                else:
                    status = 'downloading'
            else:
                # 2. If not downloading, check history
                if history:
                    logger.info(f"DEBUG PATH CHECK - History found: status='{history.status}', dest_path='{history.dest_path}'")
                    if history.status == 'success' or history.status == 'manual':
                        status = 'moved' if history.status == 'success' else 'moved_manually'
                        
                        # Use the actual path from history if available
                        if history.dest_path:
                            dest_path = history.dest_path
                            logger.info(f"DEBUG PATH CHECK - Using path from history: '{dest_path}'")
                        
                        # Verify existence
                        logger.info(f"DEBUG PATH CHECK - Checking if path exists: '{dest_path}'")
                        if os.path.exists(dest_path):
                            logger.info(f"DEBUG PATH CHECK - ✓ Path EXISTS: '{dest_path}'")
                            pass # Status remains moved
                        else:
                            receptor_enabled = settings.get('receptor_enabled', False)
                            if not receptor_enabled or (local_dest and os.path.exists(local_dest)):
                                logger.warning(f"DEBUG PATH CHECK - ✗ Path NOT FOUND: '{dest_path}' - Setting status to 'missing'")
                                status = 'missing'
                            else:
                                logger.info(f"DEBUG PATH CHECK - ✗ Path NOT FOUND: '{dest_path}', but local base dest '{local_dest}' does not exist (unmounted) and Receptor is enabled. Keeping moved/moved_manually status.")
                    elif history.status == 'skipped': status = 'skipped'
                    elif history.status in ['error', 'receptor_offline']: status = 'error'
                else:
                    # 3. No history and not downloading -> Pending or Error
                    if state in ['uploading', 'pausedUP', 'queuedUP', 'stalledUP', 'completed', 'checkingUP', 'checkingDL']:
                        status = 'pending'
                    elif state in ['error', 'missingFiles']:
                        status = 'error'
            
            
        # Check if copying
        if torrent_hash in COPY_PROGRESS:
            status = 'copying'
        
        # Determine source_path display:
        # Only show "N/A" if movie hasn't started downloading yet (status=new)
        # For downloading, show path since file already exists (even if incomplete)
        # For RSS movies, show "RSS Feed" instead
        if status == 'new':
            display_source_path = "N/A"
        elif movie and movie.state == 'rss':
            display_source_path = "RSS Feed"
        else:
            display_source_path = content_path

        movie_details.update({
            "torrent_name": t.name,
            "torrent_hash": t.hash,
            "size": t.size,
            "state": t.state,
            "status": status,
            "source_path": display_source_path,
            "dest_path": dest_path,
            "download_stats": {
                "progress": t.progress * 100,
                "speed": round(t.dlspeed / 1024 / 1024, 2),
                "eta": t.eta
            }
        })
        
        # Add copy progress if copying
        if torrent_hash in COPY_PROGRESS:
            movie_details['copy_progress'] = COPY_PROGRESS[torrent_hash]
        
        return movie_details

    except Exception as e:
        logger.error(f"Error getting movie details: {e}")
        return {"error": str(e)}

def get_copy_progress():
    return COPY_PROGRESS

def stop_copy(torrent_hash):
    """
    Signals a copy operation to stop.
    """
    if torrent_hash in COPY_PROGRESS and COPY_PROGRESS[torrent_hash]['status'] == 'copying':
        STOP_FLAGS.add(torrent_hash)
        logger.info(f"Signal to stop copy for {torrent_hash} received.")
        return True
    return False

def copy_with_progress(src, dst, torrent_hash, speed_limit_mbps=0):
    global COPY_PROGRESS, STOP_FLAGS
    
    file_size = os.path.getsize(src)
    copied = 0
    chunk_size = 1024 * 1024 # 1MB chunks
    start_time = time.time()
    last_update = start_time
    
    COPY_PROGRESS[torrent_hash] = {
        'percent': 0,
        'speed': 0,
        'status': 'copying'
    }
    
    try:
        with open(src, 'rb') as fsrc, open(dst, 'wb') as fdst:
            while True:
                # Check for stop signal
                if torrent_hash in STOP_FLAGS:
                    logger.info(f"Copy stopped by user for {torrent_hash}")
                    raise InterruptedError("Copy stopped by user")

                chunk = fsrc.read(chunk_size)
                if not chunk:
                    break
                
                fdst.write(chunk)
                copied += len(chunk)
                
                # Calculate Progress
                percent = (copied / file_size) * 100
                
                # Calculate Speed & Limit
                current_time = time.time()
                elapsed = current_time - start_time
                if elapsed > 0:
                    speed = (copied / 1024 / 1024) / elapsed # MB/s
                else:
                    speed = 0
                
                # Update State (every 0.5s)
                if current_time - last_update > 0.5:
                    COPY_PROGRESS[torrent_hash] = {
                        'percent': round(percent, 1),
                        'speed': round(speed, 2),
                        'status': 'copying'
                    }
                    last_update = current_time
                
                # Speed Limiting (Distributed)
                if speed_limit_mbps > 0:
                    # Calculate active copies to distribute speed
                    # Use list() to avoid runtime error if dict changes during iteration
                    active_copies = sum(1 for k, v in list(COPY_PROGRESS.items()) if v.get('status') == 'copying')
                    active_copies = max(1, active_copies) # Avoid division by zero
                    
                    effective_limit = speed_limit_mbps / active_copies
                    
                    expected_time = (copied / 1024 / 1024) / effective_limit
                    if expected_time > elapsed:
                        sleep_time = expected_time - elapsed
                        time.sleep(sleep_time)
                        
        # Final Update
        COPY_PROGRESS[torrent_hash] = {
            'percent': 100,
            'speed': 0,
            'status': 'done'
        }
        # Clean up
        time.sleep(2)
        if torrent_hash in COPY_PROGRESS:
            del COPY_PROGRESS[torrent_hash]
            
    except InterruptedError:
        # Cleanup partial file
        logger.info(f"Cleaning up partial file: {dst}")
        try:
            os.remove(dst)
            # Try to remove folder if empty
            parent_dir = os.path.dirname(dst)
            if not os.listdir(parent_dir):
                os.rmdir(parent_dir)
        except Exception as cleanup_err:
            logger.error(f"Error cleaning up: {cleanup_err}")
            
        if torrent_hash in COPY_PROGRESS:
            del COPY_PROGRESS[torrent_hash]
        if torrent_hash in STOP_FLAGS:
            STOP_FLAGS.remove(torrent_hash)
            
    except Exception as e:
        logger.error(f"Error copying file: {e}")
        COPY_PROGRESS[torrent_hash] = {
            'percent': 0,
            'speed': 0,
            'status': 'error'
        }
        # Don't delete file on error, maybe user wants to resume? 
        # Actually for now let's leave it.
        raise e

def load_settings():
    if not os.path.exists(SETTINGS_FILE):
        save_settings(DEFAULT_SETTINGS)
        return DEFAULT_SETTINGS
    try:
        with open(SETTINGS_FILE, 'r') as f:
            settings = json.load(f)
            # Merge with defaults to ensure all keys exist
            for key, val in DEFAULT_SETTINGS.items():
                if key not in settings:
                    settings[key] = val
            return settings
    except:
        return DEFAULT_SETTINGS

def get_language():
    """
    Get configured language for TMDB API and other services.
    Returns the language code (e.g., 'es-ES', 'en-US') from settings.
    Defaults to 'es-ES' for backwards compatibility.
    """
    settings = load_settings()
    return settings.get('language', 'es-ES')

def save_settings(settings):
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(settings, f, indent=4)

# Cache for Prowlarr stats to avoid repeated API calls
_PROWLARR_STATS_CACHE = {}  # {indexer_url: (timestamp, stats_dict)}
PROWLARR_CACHE_TTL = 86400  # 24 hours cache TTL

def get_prowlarr_stats(indexer_config):
    """
    Consulta Prowlarr para obtener trackers configurados y sus idiomas.
    Args:
        indexer_config: Dict con 'url' y 'api_key' del indexer
    Returns:
        Dict con estadísticas: {
            'success': bool,
            'tracker_count': int,
            'languages': list,
            'trackers': list,
            'message': str (en caso de error)
        }
    """
    try:
        url = indexer_config.get('url', '').rstrip('/')
        api_key = indexer_config.get('api_key', '')
        
        if not url or not api_key:
            return {
                'success': False,
                'message': 'Missing URL or API key'
            }
            
        # Check cache early
        cache_key = url
        if cache_key in _PROWLARR_STATS_CACHE:
            timestamp, cached_stats = _PROWLARR_STATS_CACHE[cache_key]
            if time.time() - timestamp < PROWLARR_CACHE_TTL:
                logger.debug(f"🗄️ Prowlarr stats cache hit for {url}")
                return cached_stats
        
        # Detectar si la URL es de Prowlarr (formato: http://host:port/N/api)
        # Remover la parte "/api" y el número de indexer si existe
        base_url = url
        if '/api' in url:
            parts = url.split('/api')[0]
            # Remover número de indexer si existe (ej: /1/api -> quitar /1)
            base_url = re.sub(r'/\d+$', '', parts)
        
        # API de Prowlarr para listar indexers
        indexers_url = f"{base_url}/api/v1/indexer"
        headers = {"X-Api-Key": api_key}
        
        logger.info(f"Querying Prowlarr stats at: {indexers_url}")
        response = requests.get(indexers_url, headers=headers, timeout=10)
        
        if response.status_code != 200:
            logger.error(f"Prowlarr returned status {response.status_code}")
            return {
                'success': False,
                'message': f'Prowlarr returned status {response.status_code}'
            }
        
        indexers = response.json()
        
        # Extraer idiomas únicos y contar trackers activos
        languages = set()
        tracker_count = 0
        tracker_details = []
        
        for idx in indexers:
            # Solo contar trackers habilitados
            is_enabled = idx.get('enable', True)
            if is_enabled:
                tracker_count += 1
                
                # Extraer idioma
                lang = idx.get('language')
                if lang:
                    languages.add(lang)
                
                # Guardar detalles del tracker
                tracker_details.append({
                    'name': idx.get('name', 'Unknown'),
                    'language': lang if lang else 'unknown',
                    'enabled': is_enabled
                })
        
        logger.info(f"Found {tracker_count} active trackers with languages: {languages}")
        
        result = {
            'success': True,
            'tracker_count': tracker_count,
            'languages': sorted(list(languages)),
            'trackers': tracker_details
        }
        
        # Save to cache
        _PROWLARR_STATS_CACHE[cache_key] = (time.time(), result)
        
        return result
        
    except requests.exceptions.Timeout:
        logger.error("Timeout connecting to Prowlarr")
        return {
            'success': False,
            'message': 'Timeout connecting to Prowlarr'
        }
    except requests.exceptions.RequestException as e:
        logger.error(f"Request error connecting to Prowlarr: {e}")
        return {
            'success': False,
            'message': f'Connection error: {str(e)}'
        }
    except Exception as e:
        logger.error(f"Error getting Prowlarr stats: {e}")
        return {
            'success': False,
            'message': str(e)
        }


# Cache for multi-language titles to avoid repeated API calls
_TITLE_CACHE = {}

def get_movie_titles_in_languages(tmdb_id, languages, api_key):
    """
    Obtiene títulos de una película en múltiples idiomas desde TMDB.
    Args:
        tmdb_id: ID de TMDB de la película
        languages: Set/list de códigos de idioma (ej: ['es-ES', 'en-US'])
        api_key: TMDB API key
    Returns:
        Dict con títulos por idioma: {'es-ES': 'El Concursante', 'en-US': 'The Contestant'}
    """
    import unicodedata
    
    def is_latin_script(text):
        """Check if text is primarily Latin script (for Spanish/English/French etc.)"""
        if not text:
            return False
        latin_chars = 0
        total_chars = 0
        for char in text:
            if char.isalpha():
                total_chars += 1
                # Check if character is Latin
                try:
                    name = unicodedata.name(char, '')
                    if 'LATIN' in name:
                        latin_chars += 1
                except:
                    pass
        return total_chars > 0 and latin_chars / total_chars > 0.5
    
    # Usar caché para evitar consultas repetidas
    cache_key = f"{tmdb_id}_{'-'.join(sorted(languages))}"
    if cache_key in _TITLE_CACHE:
        logger.info(f"Using cached titles for TMDB ID {tmdb_id}")
        return _TITLE_CACHE[cache_key]
    
    titles = {}
    english_title = None
    
    try:
        # ✅ ALWAYS fetch original title first (usually English)
        try:
            url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
            params = {"api_key": api_key}  # No language = original title
            response = requests.get(url, params=params, timeout=5)
            
            if response.status_code == 200:
                data = response.json()
                original_title = data.get('original_title')
                if original_title:
                    titles['original'] = original_title
                    logger.info(f"Fetched original title: '{original_title}'")
                # Also get English title for fallback
                english_title = data.get('title')  # Without language param, often returns English
        except Exception as e:
            logger.warning(f"Could not fetch original title: {e}")
        
        # Fetch English title explicitly for fallback
        if not english_title or not is_latin_script(english_title):
            try:
                url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
                params = {"api_key": api_key, "language": "en-US"}
                response = requests.get(url, params=params, timeout=5)
                if response.status_code == 200:
                    english_title = response.json().get('title')
            except:
                pass
        
        # Then fetch requested language translations
        for lang in languages:
            try:
                url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
                params = {"api_key": api_key, "language": lang}
                response = requests.get(url, params=params, timeout=5)
                
                if response.status_code == 200:
                    data = response.json()
                    title = data.get('title')
                    
                    # ✅ FIX: Check if title is usable for Latin-based language searches
                    # If TMDB returns non-Latin chars (Korean, Chinese, etc.) for es-ES/en-US,
                    # use English fallback instead
                    if title:
                        if is_latin_script(title):
                            titles[lang] = title
                            logger.info(f"Fetched title for {lang}: '{title}'")
                        else:
                            # Non-Latin title for Latin language - use English fallback
                            if english_title and is_latin_script(english_title):
                                titles[lang] = english_title
                                logger.warning(f"⚠️ TMDB returned non-Latin '{title}' for {lang}, using English fallback: '{english_title}'")
                            else:
                                logger.warning(f"⚠️ No usable title for {lang} (got non-Latin: '{title}')")
                else:
                    logger.warning(f"Failed to fetch title for {lang}, status: {response.status_code}")
                    
            except Exception as e:
                logger.error(f"Error fetching title for language {lang}: {e}")
                continue
        
        # Guardar en caché
        if titles:
            _TITLE_CACHE[cache_key] = titles
            
        return titles
        
    except Exception as e:
        logger.error(f"Error in get_movie_titles_in_languages: {e}")
        return {}


def find_file_in_path(base_path, filename):
    """
    Recursively search for a file in base_path.
    Returns the full path if found, else None.
    """
    if not base_path or not os.path.exists(base_path):
        return None

    # 1. Try direct path first (fastest)
    direct_path = os.path.join(base_path, filename)
    if os.path.exists(direct_path):
        return direct_path
        
    # 2. Recursive search
    for root, dirs, files in os.walk(base_path):
        if filename in files:
            return os.path.join(root, filename)
            
    return None

def get_qb_client(settings):
    return qbittorrentapi.Client(
        host=settings.get('qb_host'),
        port=settings.get('qb_port'),
        username=settings.get('qb_user'),
        password=settings.get('qb_pass')
    )

def process_torrents(config_ignored=None):
    # We ignore the passed config now, use settings.json
    settings = load_settings()
    logger.info("Starting torrent check (Scheduler)...")
    
    try:
        qb = get_qb_client(settings)
        qb.auth_log_in()
    except Exception as e:
        logger.error(f"Failed to connect to torrent client: {e}")
        return

    # Get ALL torrents
    torrents = qb.torrents_info()
    logger.info(f"Found {len(torrents)} total torrents in client")
    
    # Convert to format expected by sync_movies
    torrent_list = []
    for t in torrents:
        torrent_list.append({
            'hash': t.hash,
            'name': t.name,
            'progress': t.progress,
            'state': t.state,
            'size': t.size,
            'tags': t.tags if hasattr(t, 'tags') else '',
            'category': t.category if hasattr(t, 'category') else '',
            'content_path': t.content_path if hasattr(t, 'content_path') else ''
        })
    
    logger.info(f"Converted {len(torrent_list)} torrents for sync_movies")
    
    # Call sync_movies - this handles status updates + auto-copy detection
    try:
        api_key = settings.get('tmdb_api_key')
        sync_movies(torrent_list, api_key)
        logger.info("Sync_movies completed successfully")
    except Exception as e:
        logger.error(f"Error calling sync_movies: {e}", exc_info=True)

def get_active_torrents(config_ignored=None):
    settings = load_settings()
    try:
        qb = get_qb_client(settings)
        qb.auth_log_in()
        
        # Get all torrents
        torrents = qb.torrents_info()
        
        # Get global progress data
        progress_data = get_copy_progress()
        
        results = []
        for t in torrents:
            # First priority: Is it currently copying?
            if t.hash in progress_data and progress_data[t.hash].get('status') == 'copying':
                status = 'copying'
                history = None # Skip history checks if it's currently actively copying
            else:
                # Check DB status
                history = MoveHistory.select().where(MoveHistory.torrent_name == t.name).order_by(MoveHistory.timestamp.desc()).first()
                status = 'pending'
                
            if history:
                if history.status == 'success' or history.status == 'manual':
                    # Verify existence
                    local_dest = settings.get('local_dest_path')
                    status = 'moved' if history.status == 'success' else 'moved_manually'
                    
                    if local_dest and 'content_path' in t:
                         normalized_path = t['content_path'].replace('\\', '/')
                         item_name = os.path.basename(normalized_path.rstrip('/'))
                         match = re.search(r"(.+?)\s\((\d{4})\)", item_name)
                         
                         if match:
                             title = match.group(1).strip()
                             year = match.group(2).strip()
                             sanitized_title = sanitize_path_component(title)
                             sanitized_year = sanitize_path_component(year)
                             folder_name = f"{sanitized_title} ({sanitized_year})"
                             dest_path = os.path.join(local_dest, folder_name)
                             
                             if not os.path.exists(dest_path):
                                 receptor_enabled = settings.get('receptor_enabled', False)
                                 if not receptor_enabled or os.path.exists(local_dest):
                                     status = 'missing'
                         # If match fails, we assume moved (fallback)
                elif history.status == 'skipped':
                    status = 'skipped'
                elif history.status == 'error':
                    status = 'error'
            else:
                # No history, derive from state
                state = t.state
                if state in ['metaDL', 'allocating', 'queuedDL']:
                    status = 'new'
                elif state in ['downloading', 'forceDL', 'stalledDL', 'pausedDL']:
                    status = 'downloading'
                elif state in ['uploading', 'pausedUP', 'queuedUP', 'stalledUP', 'completed', 'checkingUP', 'checkingDL']:
                    status = 'pending'
                elif state in ['error', 'missingFiles']:
                    status = 'error'
                else:
                    status = 'pending' # Default fallback
            
            results.append({
                'hash': t.hash,
                'name': t.name,
                'progress': t.progress,
                'state': t.state,
                'size': t.size,
                'status': status,
                'message': history.message if history else "",
                'added_on': t.added_on,
                'completion_on': t.completion_on,
                'ratio': t.ratio,
                'content_path': t.content_path,
                'tags': t.tags if hasattr(t, 'tags') else '',  # ADDED for auto-copy
                'category': t.category if hasattr(t, 'category') else ''  # ADDED for future use
            })
            
        return results
    except Exception as e:
        logger.error(f"Error getting torrents: {e}")
        return []

def manual_move(torrent_hash, config_ignored=None):
    """
    Manually triggers a move operation for a specific torrent
    """
    logger.info("=" * 80)
    logger.info(f"📦 [MOVE] MANUAL MOVE STARTED - Hash: {torrent_hash[:8]}...")
    logger.info("=" * 80)
    
    settings = load_settings()
    try:
        qb = get_qb_client(settings)
        qb.auth_log_in()
        
        torrents = qb.torrents_info(torrent_hashes=torrent_hash)
        if not torrents:
            return {"success": False, "message": "Torrent not found"}
            
        torrent = torrents[0]
        
        # Run in background thread to avoid blocking API (Cloudflare 524 Fix)
        def _move_thread():
            try:
                process_single_torrent(qb, torrent, settings)
            except Exception as e:
                logger.error(f"Error in background move thread: {e}")

        threading.Thread(target=_move_thread).start()
        
        return {"success": True, "message": f"Started processing {torrent.name} in background"}
    except Exception as e:
        return {"success": False, "message": str(e)}

def mark_as_moved(torrent_hash, config_ignored=None):
    settings = load_settings()
    try:
        qb = get_qb_client(settings)
        qb.auth_log_in()
        
        torrents = qb.torrents_info(torrent_hashes=torrent_hash)
        if not torrents:
             return {"success": False, "message": "Torrent not found"}
        
        torrent = torrents[0]
        MoveHistory.create(torrent_name=torrent.name, status='manual', message="Manually marked as moved", source_path="", dest_path="")
        return {"success": True, "message": "Marked as moved"}
    except Exception as e:
        return {"success": False, "message": str(e)}

def process_single_torrent(qb, torrent, settings):
    logger.info(f"Processing: {torrent.name}")
    
    # 2. Check Content Path
    content_path = torrent.content_path
    normalized_path = content_path.replace('\\', '/')
    item_name = os.path.basename(normalized_path.rstrip('/'))
    
    # Determine Source Path
    local_source = settings.get('local_source_path')
    
    if not local_source:
        logger.error("No local_source_path configured in settings.")
        return

    source_path = find_file_in_path(local_source, item_name)
    
    if not source_path:
        receptor_enabled = settings.get('receptor_enabled', False)
        if receptor_enabled:
            source_path = content_path
            logger.info(f"Local file not found in {local_source}, but Receptor is enabled. Falling back to content_path: {content_path}")
        else:
            logger.warning(f"Could not find {item_name} in {local_source}")
            MoveHistory.create(torrent_name=torrent.name, status='error', message=f"File not found in {local_source}", source_path="", dest_path="")
            return

    # 3. Parse Name (Movie vs Series) - Allow space before year to be optional
    match = re.search(r"(.+?)\s*\((\d{4})\)", item_name)
    if not match:
        logger.info(f"Skipping {torrent.name}: Does not match 'Title (Year)' pattern.")
        MoveHistory.create(torrent_name=torrent.name, status='skipped', message="Invalid name format", source_path=source_path, dest_path="")
        return

    # 4. Sanitize title and year to prevent path traversal attacks
    title_raw = match.group(1).strip()
    year_raw = match.group(2).strip()
    
    title = sanitize_path_component(title_raw)
    year = sanitize_path_component(year_raw)
    
    folder_name = f"{title} ({year})"
    
    # Destination Path
    local_dest = settings.get('local_dest_path')
    if not local_dest:
        logger.error("No local_dest_path configured in settings.")
        return

    dest_dir = os.path.join(local_dest, folder_name)
    
    # 5. Security Check: Verify destination is within expected directory
    # This prevents path traversal even if sanitization is bypassed
    try:
        dest_real = os.path.realpath(dest_dir)
        local_real = os.path.realpath(local_dest)
        
        # Ensure dest_real starts with local_real + os.sep) and dest_real != local_real:
        if not dest_real.startswith(local_real + os.sep) and dest_real != local_real:
            logger.error(f"SECURITY: Path traversal attempt detected! Torrent: {torrent.name}")
            logger.error(f"  Expected base: {local_real}")
            logger.error(f"  Attempted path: {dest_real}")
            MoveHistory.create(
                torrent_name=torrent.name,
                status='error',
                message="Path traversal attempt blocked by security check",
                source_path=source_path,
                dest_path=""
            )
            return
    except Exception as e:
        logger.error(f"Error in path security check: {e}")
        return
    
    logger.info(f"Destination directory: {dest_dir}")
    
    try:
        limit = settings.get('copy_speed_limit', 10)
        logger.info("=" * 80)
        logger.info(f"📁 [COPY] COPY STARTED")
        logger.info(f"📁 [COPY] Source: {os.path.basename(source_path)}")
        logger.info(f"📁 [COPY] Destination: {os.path.basename(dest_dir)}")
        logger.info("=" * 80)
        
        logger.debug(f"🔧 [COPY] Full source path: {source_path}")
        logger.debug(f"🔧 [COPY] Full destination path: {dest_dir}")
        logger.debug(f"🔧 [COPY] Speed limit: {limit} MB/s")
        
        logger.info(f"Using copy speed limit: {limit} MB/s")
        
        # === RECEPTOR LOGIC (Offloaded Copy) ===
        receptor_enabled = settings.get('receptor_enabled', False)
        if receptor_enabled:
            host = settings.get('receptor_host')
            port = settings.get('receptor_port', 8095)
            
            if not host:
                logger.error("Receptor is enabled but no host is configured.")
                MoveHistory.create(torrent_name=torrent.name, status='error', message="Receptor host missing", source_path=source_path, dest_path=dest_dir)
                return
                
            logger.info(f"Receptor is ENABLED. Offloading copy to {host}:{port}")
            try:
                # Apply path mapping if configured
                mapping_str = settings.get('receptor_path_mapping', '')
                receptor_source = source_path
                receptor_dest = dest_dir
                
                if mapping_str:
                    for line in mapping_str.split('\n'):
                        line = line.strip()
                        if '=' in line:
                            linux_path, win_path = line.split('=', 1)
                            linux_path = linux_path.strip()
                            win_path = win_path.strip()
                            if receptor_source.startswith(linux_path):
                                receptor_source = receptor_source.replace(linux_path, win_path, 1).replace('/', '\\')
                            if receptor_dest.startswith(linux_path):
                                receptor_dest = receptor_dest.replace(linux_path, win_path, 1).replace('/', '\\')
                
                logger.info(f"Receptor mapped path: Src: {receptor_source}")
                logger.info(f"Receptor mapped path: Dst: {receptor_dest}")
                
                # 1. Inform the Receptor to start copying
                payload = {
                    "task_id": torrent.hash,
                    "source": receptor_source,
                    "destination": receptor_dest,
                    "folder_name": folder_name
                }
                
                resp = requests.post(f"http://{host}:{port}/copy", json=payload, timeout=5)
                
                if resp.status_code in [200, 202]:
                    data = resp.json()
                    if data.get("status") in ["started", "already_running", "accepted"]:
                        logger.info(f"Receptor accepted copy task for {torrent.hash}")
                        # Update progress tracking so UI shows "copying"
                        COPY_PROGRESS[torrent.hash] = {
                            'percent': 0,
                            'speed': 0,
                            'status': 'copying',
                            'is_receptor': True
                        }
                        # Start background thread to poll Receptor status
                        threading.Thread(target=_poll_receptor_status, args=(torrent, host, port, source_path, dest_dir, settings, title, year)).start()
                        return
                    else:
                        error_msg = data.get("message", "Unknown Receptor Error")
                        logger.error(f"Receptor returned error: {error_msg}")
                        MoveHistory.create(torrent_name=torrent.name, status='error', message=f"Receptor: {error_msg}", source_path=source_path, dest_path=dest_dir)
                        return
                else:
                    logger.error(f"Receptor HTTP error: {resp.status_code}")
                    MoveHistory.create(torrent_name=torrent.name, status='receptor_offline', message=f"Receptor HTTP {resp.status_code}", source_path=source_path, dest_path=dest_dir)
                    return
            except requests.exceptions.RequestException as e:
                logger.warning(f"Receptor is unreachable ({e}). Marking as waiting for automatic retry.")
                MoveHistory.create(torrent_name=torrent.name, status='receptor_offline', message="Receptor unreachable, waiting...", source_path=source_path, dest_path=dest_dir)
                return
        
        # === LOCAL COPY LOGIC (Fallback / Default) ===
        os.makedirs(dest_dir, exist_ok=True)
        # If it's a file
        if os.path.isfile(source_path):
            logger.info(f"Source is a file: {source_path}")
            ext = os.path.splitext(item_name)[1]
            new_name = f"{folder_name}{ext}"
            dest_file = os.path.join(dest_dir, new_name)
            
            if not os.path.exists(dest_file):
                # Check and reserve disk space BEFORE copying
                success, message, details = check_and_reserve_disk_space(source_path, dest_dir)
                
                if not success:
                    logger.error(f"Disk space check failed for {torrent.name}: {message}")
                    MoveHistory.create(
                        torrent_name=torrent.name,
                        status='error',
                        message=f"Disk space check failed: {message}",
                        source_path=source_path,
                        dest_path=dest_file
                    )
                    return
                
                # Space reserved successfully, proceed with copy
                reserved_bytes = details['required_bytes']
                try:
                    logger.info(f"Copying {source_path} to {dest_file}")
                    copy_with_progress(source_path, dest_file, torrent.hash, limit)
                    MoveHistory.create(torrent_name=torrent.name, source_path=source_path, dest_path=dest_file, status='success')
                    trigger_movies_update_callback()
                    
                    # Notify Telegram: Moved
                    if settings.get('telegram_notify_on_move', True):
                        send_telegram_notification(f"🚀 <b>Movie Moved to Library</b>\n\n🎬 {title} ({year})\n📂 {dest_file}")

                    # Clear Watchlist if applicable
                    try:
                        movie = Movie.get_or_none(Movie.torrent_hash == torrent.hash)
                        if movie and movie.watchlist:
                            movie.watchlist = False
                            movie.watchlist_expiry = None
                            movie.save()
                            logger.info(f"Removed '{title}' ({year}) from watchlist after successful move")
                    except Exception as wl_err:
                        logger.error(f"Error clearing watchlist for {title}: {wl_err}")
                        
                finally:
                    # ALWAYS release reservation, even if copy fails
                    release_disk_space_reservation(dest_dir, reserved_bytes)

            else:
                logger.info(f"File already exists: {dest_file}")
                MoveHistory.create(torrent_name=torrent.name, status='skipped', message="Destination exists", source_path=source_path, dest_path=dest_file)
                trigger_movies_update_callback()
                
        # If it's a directory
        elif os.path.isdir(source_path):
            logger.info(f"Source is a directory: {source_path}")
            
            # Ensure the base directory exists BEFORE checking disk space, as shutil.disk_usage will crash if the directory does not exist yet for directory-based torrents.
            os.makedirs(dest_dir, exist_ok=True)
            
            # Check and reserve disk space BEFORE copying
            success, message, details = check_and_reserve_disk_space(source_path, dest_dir)
            
            if not success:
                logger.error(f"Disk space check failed for {torrent.name}: {message}")
                MoveHistory.create(
                    torrent_name=torrent.name,
                    status='error',
                    message=f"Disk space check failed: {message}",
                    source_path=source_path,
                    dest_path=dest_dir
                )
                return
            
            # Space reserved successfully, proceed with copy
            reserved_bytes = details['required_bytes']
            try:
                video_extensions = ['.mkv', '.mp4', '.avi']
                copied = False
                for root, dirs, files in os.walk(source_path):
                    for file in files:
                        if any(file.lower().endswith(ext) for ext in video_extensions):
                            # Found video
                            src_file = os.path.join(root, file)
                            ext = os.path.splitext(file)[1]
                            new_name = f"{folder_name}{ext}"
                            dest_file = os.path.join(dest_dir, new_name)
                            
                            if not os.path.exists(dest_file):
                                logger.info(f"Copying {src_file} to {dest_file}")
                                copy_with_progress(src_file, dest_file, torrent.hash, limit)
                                copied = True
                            else:
                                logger.info(f"File already exists: {dest_file}")
                                # Mark as skipped if at least one file exists?
                                # But we might have multiple files.
                                pass
                            
                if copied:
                    MoveHistory.create(torrent_name=torrent.name, source_path=source_path, dest_path=dest_dir, status='success')
                    trigger_movies_update_callback()
                    
                    # Notify Telegram: Moved
                    if settings.get('telegram_notify_on_move', True):
                        send_telegram_notification(f"🚀 <b>Movie Moved to Library</b>\n\n🎬 {title} ({year})\n📂 {dest_dir}")

                    # Clear Watchlist if applicable
                    try:
                        movie = Movie.get_or_none(Movie.torrent_hash == torrent.hash)
                        if movie and movie.watchlist:
                            movie.watchlist = False
                            movie.watchlist_expiry = None
                            movie.save()
                            logger.info(f"Removed '{title}' ({year}) from watchlist after successful move")
                    except Exception as wl_err:
                        logger.error(f"Error clearing watchlist for {title}: {wl_err}")

                else:
                    logger.warning(f"No video files found in {source_path}")
                    MoveHistory.create(torrent_name=torrent.name, status='skipped', message="No video file found in folder", source_path=source_path, dest_path=dest_dir)
                    trigger_movies_update_callback()
                    
            finally:
                # ALWAYS release reservation, even if copy fails
                release_disk_space_reservation(dest_dir, reserved_bytes)
        else:
             logger.error(f"Source path is valid but neither file nor dir? {source_path}")
             MoveHistory.create(torrent_name=torrent.name, status='error', message="Invalid source type", source_path=source_path, dest_path="")
             trigger_movies_update_callback()

    except InterruptedError:
        logger.info(f"Copy cancelled for {torrent.name}")
        # History entry? Maybe not needed if cancelled.
    except Exception as e:
        logger.error(f"Error moving {torrent.name}: {e}")
        MoveHistory.create(torrent_name=torrent.name, status='error', message=str(e), source_path="", dest_path="")
        trigger_movies_update_callback()

def _poll_receptor_status(torrent, host, port, source_path, dest_dir, settings, title, year):
    """
    Background thread to poll the receptor for copy progress and handle completion.
    """
    global COPY_PROGRESS, STOP_FLAGS
    
    url = f"http://{host}:{port}/status/{torrent.hash}"
    stop_url = f"http://{host}:{port}/stop/{torrent.hash}"
    
    logger.info(f"Started polling Receptor for {torrent.hash}")
    
    while True:
        try:
            # Check for stop signal from Roverr UI
            if torrent.hash in STOP_FLAGS:
                logger.info(f"Sending stop signal to Receptor for {torrent.hash}")
                requests.post(stop_url, timeout=5)
                STOP_FLAGS.remove(torrent.hash)
                if torrent.hash in COPY_PROGRESS:
                    del COPY_PROGRESS[torrent.hash]
                break
                
            resp = requests.get(url, timeout=3)
            
            if resp.status_code == 200:
                data = resp.json()
                status = data.get("status")
                
                if status == "copying":
                    COPY_PROGRESS[torrent.hash] = {
                        'percent': data.get("percent", 0),
                        'speed': data.get("speed", 0),
                        'status': 'copying',
                        'is_receptor': True
                    }
                elif status == "done":
                    # Receptor finished copying
                    logger.info(f"Receptor finished copying {torrent.hash}")
                    COPY_PROGRESS[torrent.hash] = {
                        'percent': 100,
                        'speed': 0,
                        'status': 'done',
                        'is_receptor': True
                    }
                    MoveHistory.create(torrent_name=torrent.name, source_path=source_path, dest_path=dest_dir, status='success')
                    trigger_movies_update_callback()
                    
                    # Notify Telegram
                    if settings.get('telegram_notify_on_move', True):
                        send_telegram_notification(f"🚀 <b>Movie Moved via Receptor</b>\n\n🎬 {title} ({year})\n📂 {dest_dir}")
                        
                    # Clear Watchlist
                    try:
                        movie = Movie.get_or_none(Movie.torrent_hash == torrent.hash)
                        if movie and movie.watchlist:
                            movie.watchlist = False
                            movie.watchlist_expiry = None
                            movie.save()
                    except Exception as wl_err:
                        logger.error(f"Error clearing watchlist for {title}: {wl_err}")
                        
                    time.sleep(2)
                    if torrent.hash in COPY_PROGRESS:
                        del COPY_PROGRESS[torrent.hash]
                    break
                    
                elif status == "error":
                    # Receptor encountered an error
                    error_msg = data.get("error", "Unknown receptor error")
                    logger.error(f"Receptor copy error for {torrent.hash}: {error_msg}")
                    MoveHistory.create(torrent_name=torrent.name, status='error', message=f"Receptor Error: {error_msg}", source_path=source_path, dest_path=dest_dir)
                    trigger_movies_update_callback()
                    if torrent.hash in COPY_PROGRESS:
                        del COPY_PROGRESS[torrent.hash]
                    break
                    
                elif status == "not_found":
                     # Task was likely cancelled or cleaned up
                     logger.warning(f"Receptor task not found (cancelled?) for {torrent.hash}")
                     if torrent.hash in COPY_PROGRESS:
                         del COPY_PROGRESS[torrent.hash]
                     break
                
            else:
                 logger.warning(f"Receptor status returned {resp.status_code} for {torrent.hash}")
                 
        except Exception as e:
            logger.error(f"Error polling receptor for {torrent.hash}: {e}")
            
        time.sleep(1) # Poll every 1 second

def test_receptor_connection(host, port):
    """
    Tests connection to the Remote Copy Receptor.
    """
    try:
        url = f"http://{host}:{port}/"
        resp = requests.get(url, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("service") == "Roverr Receptor":
                return True, "Successfully connected to Roverr Receptor."
            else:
                return False, "Connected to port, but the service is not Roverr Receptor."
        return False, f"Receptor returned HTTP {resp.status_code}"
    except requests.exceptions.RequestException as e:
        logger.error(f"Receptor connection test failed: {e}")
        return False, f"Failed to connect to {host}:{port}. Is the script running?"

def test_indexer_connection(url, api_key):
    """
    Tests the connection to a Torznab indexer by fetching its capabilities.
    """
    def check_response(resp):
        if resp.status_code == 200:
            content_type = resp.headers.get('Content-Type', '')
            if 'application/xml' in content_type or 'text/xml' in content_type or resp.text.strip().startswith('<?xml'):
                return True, "Connection successful"
            else:
                # Show snippet of what we received
                preview = resp.text[:100].replace('\n', ' ').replace('\r', '')
                return False, f"Connected, but response is not valid XML. Received: {preview}..."
        elif resp.status_code == 401:
            return False, "Unauthorized: Invalid API Key"
        else:
            return False, f"Connection failed: Status {resp.status_code}"

    try:
        # Clean URL
        url = url.rstrip('/')
        params = {'t': 'caps', 'apikey': api_key}
        
        logger.info(f"Testing indexer connection: {url}")
        response = requests.get(url, params=params, timeout=10)
        
        success, message = check_response(response)
        
        if success:
            return True, message
            
        # If failed and URL doesn't end with /api, try appending /api
        if not success and not url.endswith('/api'):
            alt_url = f"{url}/api"
            logger.info(f"Retrying with appended /api: {alt_url}")
            alt_response = requests.get(alt_url, params=params, timeout=10)
            alt_success, alt_message = check_response(alt_response)
            
            if alt_success:
                return True, "Connection successful (URL auto-corrected to end with /api)"
            else:
                # If retry also failed, return the retry's error as it's likely the more 'correct' URL
                return False, f"Retry ({alt_url}) failed: {alt_message}"
                
        return False, message
            
    except requests.exceptions.RequestException as e:
        logger.error(f"Indexer connection error: {e}")
        return False, f"Connection error: {str(e)}"
    except Exception as e:
        logger.error(f"Unexpected error testing indexer: {e}")
        return False, f"Unexpected error: {str(e)}"

def calculate_title_similarity(title1, title2):
    """
    Calcula la similitud entre dos títulos de películas (0.0 a 1.0).
    Normaliza los títulos eliminando puntuación y convirtiendo a minúsculas.
    
    Args:
        title1: Primer título
        title2: Segundo título
    
    Returns:
        float: Similitud entre 0.0 (completamente diferente) y 1.0 (idéntico)
    """
    from difflib import SequenceMatcher
    
    def normalize(text):
        # Eliminar puntuación y convertir a minúsculas
        import re
        text = re.sub(r'[^\w\s]', '', text.lower())
        # Eliminar años
        text = re.sub(r'\b\d{4}\b', '', text)
        # Eliminar palabras comunes de calidad/release
        text = re.sub(r'\b(bluray|bdrip|webrip|hdtv|1080p|720p|480p|x264|x265|hevc|aac|ac3|dd5|dts)\b', '', text, flags=re.IGNORECASE)
        return text.strip()
    
    norm1 = normalize(title1)
    norm2 = normalize(title2)
    
    if not norm1 or not norm2:
        return 0.0
    
    return SequenceMatcher(None, norm1, norm2).ratio()


def is_word_match(search_term, result_title):
    """
    Verifica si el término de búsqueda aparece como palabra completa en el título del resultado.
    Esto previene que "Eli" coincida con "película" o "rebelión".
    
    Args:
        search_term: Término buscado (ej: "Eli")
        result_title: Título del resultado del indexer
    
    Returns:
        bool: True si el término aparece como palabra completa
    """
    import re
    # Buscar el término como palabra completa (con límites de palabra \b)
    pattern = r'\b' + re.escape(search_term) + r'\b'
    return bool(re.search(pattern, result_title, re.IGNORECASE))


def filter_search_results(results, search_query, min_similarity=0.4, year=None):
    """
    Filtra resultados de búsqueda para eliminar coincidencias falsas.
    
    Para títulos cortos (<=4 caracteres), aplica validación estricta de palabra completa.
    Para todos, aplica fuzzy matching para eliminar títulos muy diferentes.
    
    Args:
        results: Lista de resultados de search_indexers
        search_query: Query original de búsqueda (puede contener múltiples títulos separados por |)
        min_similarity: Umbral mínimo de similitud (0.0 a 1.0)
        year: Año de la película para aplicar boost de similitud
    
    Returns:
        Lista filtrada de resultados con campo '_similarity' añadido
    """
    if not results:
        return []
    
    # Extraer títulos base del query (separados por |)
    base_queries = [q.strip() for q in search_query.split('|') if q.strip()]
    
    # CRITICAL FIX: Remove years from base_queries for length checking
    # Years like "2012" were triggering strict word matching for ALL queries
    # We remove them for the short-title check, but keep them for similarity matching
    base_queries_no_year = []
    for q in base_queries:
        # Remove year patterns (4-digit numbers)
        q_no_year = re.sub(r'\b\d{4}\b', '', q).strip()
        if q_no_year:  # Only add if something remains after removing year
            base_queries_no_year.append(q_no_year)
    
    # Use queries without years for short-title detection
    queries_for_length_check = base_queries_no_year if base_queries_no_year else base_queries
    
    logger.debug(f"Filter: Original queries: {base_queries}")
    logger.debug(f"Filter: Queries for length check (years removed): {queries_for_length_check}")
    
    filtered = []
    rejected_count = 0
    
    for result in results:
        result_title = result.get('title', '')
        if not result_title:
            continue
        
        best_similarity = 0.0
        matched_query = None
        is_strict_match = False
        
        for base_query in base_queries:
            # ✅ IMPROVED: If the result title contains the exact query as a word, calculate similarity
            query_no_year = re.sub(r'\b\d{4}\b', '', base_query).strip()
            if query_no_year and is_word_match(query_no_year, result_title):
                # Exact word match found - calculate actual similarity
                similarity = calculate_title_similarity(base_query, result_title)
                
                # ✅ SIMPLIFIED: Extract year from base_query and check if result contains it
                year_match = re.search(r'\b(\d{4})\b', base_query)
                if year_match:
                    query_year = year_match.group(1)
                    if query_year in result_title:
                        similarity += 0.2
                        logger.info(f"🎯 Year boost: '{result_title[:60]}' contains year {query_year}, similarity: {similarity:.3f}")
                
                if similarity > best_similarity:
                    best_similarity = similarity
                    matched_query = base_query
                    is_strict_match = True
                continue
            
            # For very short titles, verify complete word match
            # But use queries_for_length_check to determine if it's "short"
            is_short_query = len(query_no_year) <= 4 if query_no_year else len(base_query) <= 4
            
            if is_short_query:
                # Use the query without year for word matching
                if query_no_year and is_word_match(query_no_year, result_title):
                    is_strict_match = True
                    # Calculate similarity with the full query (including year)
                    similarity = calculate_title_similarity(base_query, result_title)
                    
                    # ✅ SIMPLIFIED: Extract year from base_query
                    year_match = re.search(r'\b(\d{4})\b', base_query)
                    if year_match and year_match.group(1) in result_title:
                        similarity += 0.2
                        logger.info(f"🎯 Year boost (short): '{result_title[:60]}' contains year {year_match.group(1)}, similarity: {similarity:.3f}")
                    
                    if similarity > best_similarity:
                        best_similarity = similarity
                        matched_query = base_query
            else:
                # For normal titles, use fuzzy matching
                similarity = calculate_title_similarity(base_query, result_title)
                
                # ✅ SIMPLIFIED: Extract year from base_query
                year_match = re.search(r'\b(\d{4})\b', base_query)
                if year_match and year_match.group(1) in result_title:
                    similarity += 0.2
                    logger.info(f"🎯 Year boost (normal): '{result_title[:60]}' contains year {year_match.group(1)}, similarity: {similarity:.3f}")
                
                if similarity > best_similarity:
                    best_similarity = similarity
                    matched_query = base_query
        
        # Decide if we accept the result
        accept = False
        
        # Check if ANY query (without year) is short
        has_short_query = any(len(q) <= 4 for q in queries_for_length_check)
        
        if has_short_query:
            # For short queries, REQUIRE complete word match
            if is_strict_match and best_similarity >= min_similarity:
                accept = True
        else:
            # For normal titles, only similarity
            if best_similarity >= min_similarity:
                accept = True
        
        # Also accept if the title starts with any query (without year)
        for query in queries_for_length_check:
            if result_title.lower().startswith(query.lower()):
                accept = True
                # ✅ FIXED: Don't overwrite year-boosted similarity, use max
                best_similarity = max(best_similarity, 0.8)
                break
        
        
        if accept:
            # ✅ FINAL YEAR BOOST/PENALTY: Apply based on year match
            # Extract years from search_query (the multi-language query with years)
            query_years = set(re.findall(r'\b(19|20)\d{2}\b', search_query))
            result_years = set(re.findall(r'\b(19|20)\d{2}\b', result_title))
            
            if query_years:
                if query_years & result_years:
                    # Year match - apply boost if not already at 1.0
                    matching_year = list(query_years & result_years)[0]
                    if best_similarity < 1.0 and abs(best_similarity - 0.8) < 0.01:
                        best_similarity += 0.2
                        logger.info(f"🎯 Final year boost: '{result_title[:60]}' contains year {matching_year}, similarity: {best_similarity:.3f}")
                elif result_years:
                    # Result has a DIFFERENT year - apply penalty
                    wrong_year = list(result_years)[0]
                    query_year = list(query_years)[0]
                    best_similarity -= 0.15
                    logger.info(f"📉 Year penalty: '{result_title[:60]}' has year {wrong_year} (expected {query_year}), similarity: {best_similarity:.3f}")
            
            result['_similarity'] = best_similarity
            result['_matched_query'] = matched_query
            filtered.append(result)
            
            # NOTE: Early exit removed - it was causing size filtering issues
            # by stopping before processing smaller valid torrents
        else:
            rejected_count += 1
            logger.debug(f"Filter: REJECTED '{result_title}' (similarity: {best_similarity:.2f}, matched: {matched_query})")
    
    # Sort by similarity (most similar first)
    filtered.sort(key=lambda x: x.get('_similarity', 0), reverse=True)
    
    logger.info(f"Filtered results: {len(results)} → {len(filtered)} (removed {len(results) - len(filtered)} false positives)")
    
    return filtered


def search_indexers(query, settings, tmdb_id=None):
    """
    Searches all configured Prowlarr indexers for a query
    """
    import xml.etree.ElementTree as ET
    import re
    
    logger.info("=" * 80)
    logger.info(f"🔍 [SEARCH] INDEXER SEARCH STARTED - Query: '{query}'")
    logger.info("=" * 80)
    
    # Extract year from original query BEFORE multi-language conversion
    original_year = None
    year_match = re.search(r'\b(\d{4})\b', query)
    if year_match:
        original_year = year_match.group(1)
        logger.debug(f"Extracted year {original_year} from original query")
    
    indexers = settings.get('indexers', [])
    if not indexers:
        logger.warning("⚠️  [SEARCH] No indexers configured")
        return {"results": [], "total": 0}
    
    logger.info(f"📡 [SEARCH] Searching {len(indexers)} configured indexer(s)")
    # INTELLIGENT MULTI-LANGUAGE SEARCH
    # If we have TMDB ID, detect indexer languages and search with appropriate titles
    if tmdb_id:
        logger.info(f"🌍 Using intelligent multi-language search for TMDB ID: {tmdb_id}")
        
        try:
            # 1. Get languages from all indexers
            indexer_languages = set()
            indexer_lang_map = {}  # Map indexer index to its language
            
            for idx, indexer in enumerate(indexers):
                stats = get_prowlarr_stats(indexer)
                if stats.get('success') and stats.get('languages'):
                    langs = stats['languages']
                    indexer_languages.update(langs)
                    # Store first language for this indexer
                    indexer_lang_map[idx] = langs[0] if langs else None
                    logger.info(f"Indexer '{indexer.get('name')}' supports languages: {langs}")
                else:
                    logger.warning(f"Could not detect language for indexer '{indexer.get('name')}', using fallback")
            
            # 2. Get titles in those languages from TMDB
            if indexer_languages:
                tmdb_api_key = settings.get('tmdb_api_key')
                titles_by_lang = get_movie_titles_in_languages(tmdb_id, indexer_languages, tmdb_api_key)
                
                if titles_by_lang:
                    logger.info(f"📚 Fetched titles: {titles_by_lang}")
                    
                    # 3. Build query string with all language variants
                    unique_titles = list(set(titles_by_lang.values()))
                    
                    # ✅ FIX: Also include original query title as fallback
                    # This ensures we search with user's title even if TMDB returns different
                    original_title_clean = original_query.split('|')[0].strip()
                    # Remove year if present
                    import re
                    original_title_clean = re.sub(r'\s+\d{4}$', '', original_title_clean).strip()
                    if original_title_clean and original_title_clean not in unique_titles:
                        unique_titles.insert(0, original_title_clean)  # Put user's query first
                        logger.info(f"📌 Added user query title as priority: '{original_title_clean}'")
                    
                    # ✅ FIXED: Append year to EACH title, not just at the end
                    if original_year:
                        unique_titles = [f"{title} {original_year}" for title in unique_titles]
                        logger.debug(f"Added year to each title: {unique_titles}")
                    
                    query = " | ".join(unique_titles)
                    logger.info(f"🔍 Multi-language search query: {query}")
                else:
                    logger.warning("Failed to fetch multi-language titles, falling back to text search")
            else:
                logger.warning("No indexer languages detected, falling back to text search")
                
        except Exception as e:
            logger.error(f"Error in intelligent search: {e}, falling back to text search")
    
    # Split by | to get multiple title variants (Spanish | English)
    base_queries = [q.strip() for q in query.split('|')]
    
    # Generate query variants to improve search results
    query_variants = []
    
    for base_query in base_queries:
        if not base_query:
            continue
            
        # Add original query
        query_variants.append(base_query)
        
        # IMPORTANT: Create variant without year
        # Many trackers don't include the year in torrent names
        query_no_year = re.sub(r'\b\d{4}\b', '', base_query).strip()
        if query_no_year and query_no_year != base_query and query_no_year not in query_variants:
            query_variants.append(query_no_year)
        
        # Variant 1: Remove punctuation (: ; , - etc.)
        clean_query = re.sub(r'[:;,\-\–\—]', ' ', base_query)
        clean_query = re.sub(r'\s+', ' ', clean_query).strip()
        if clean_query != base_query and clean_query not in query_variants:
            query_variants.append(clean_query)
        
        # Variant 2: Remove dots/periods (for titles like "Oh. What. Fun.")
        no_dots = base_query.replace('.', ' ')
        no_dots = re.sub(r'\s+', ' ', no_dots).strip()
        if no_dots != base_query and no_dots not in query_variants:
            query_variants.append(no_dots)
        
        # Variant 3: Remove common articles and prepositions at start
        article_removed = re.sub(r'^(El|La|Los|Las|The|A|An)\s+', '', base_query, flags=re.IGNORECASE).strip()
        if article_removed != base_query and article_removed not in query_variants:
            query_variants.append(article_removed)
        
        # Variant 4: Article removed + punctuation removed
        clean_no_article = re.sub(r'[:;,\-\–\—]', ' ', article_removed)
        clean_no_article = re.sub(r'\s+', ' ', clean_no_article).strip()
        if clean_no_article not in query_variants:
            query_variants.append(clean_no_article)
        
        # Variant 5: Article removed + dots removed
        no_dots_no_article = article_removed.replace('.', ' ')
        no_dots_no_article = re.sub(r'\s+', ' ', no_dots_no_article).strip()
        if no_dots_no_article not in query_variants:
            query_variants.append(no_dots_no_article)
        
        # Variant 6: Query without year + article removed
        if query_no_year:
            article_removed_no_year = re.sub(r'^(El|La|Los|Las|The|A|An)\s+', '', query_no_year, flags=re.IGNORECASE).strip()
            if article_removed_no_year and article_removed_no_year not in query_variants:
                query_variants.append(article_removed_no_year)

        # NEW Variant 7: Remove ALL articles and common prepositions (not just at start)
        # This helps when tracker uses different article/preposition placement
        # e.g., "Chainsaw Man - La película: El arco de Reze" → "Chainsaw Man película arco Reze"
        no_articles = re.sub(r'\b(el|la|los|las|de|del|un|una|unos|unas|the|a|an|of)\b', ' ', base_query, flags=re.IGNORECASE)
        no_articles = re.sub(r'[:;,\-\–\—]', ' ', no_articles)  # Also remove punctuation
        no_articles = re.sub(r'\s+', ' ', no_articles).strip()
        if no_articles and len(no_articles) > 3 and no_articles not in query_variants:
            query_variants.append(no_articles)
        
        # NEW Variant 8: Ultra-short - Extract only main keywords (words >= 4 chars)
        # Helps find torrents with very different naming conventions
        # e.g., "Chainsaw Man - La película: El arco de Reze" → "Chainsaw película arco Reze"
        words = re.findall(r'\b\w+\b', base_query)
        keywords = [w for w in words if len(w) >= 4 and not w.isdigit()]  # Skip short words and years
        if len(keywords) >= 2:  # Only if we have at least 2 keywords
            ultra_short = ' '.join(keywords)
            if ultra_short and ultra_short not in query_variants:
                query_variants.append(ultra_short)

    # ✅ PHASE 2: Limit search variants to reduce API calls
    # Keep only the most useful variants (original + no year + 2 best alternates)
    MAX_VARIANTS = 4
    if len(query_variants) > MAX_VARIANTS:
        logger.debug(f"🔄 Reducing {len(query_variants)} variants to {MAX_VARIANTS} to save API calls")
        query_variants = query_variants[:MAX_VARIANTS]
    
    logger.info(f"Searching with {len(query_variants)} variants: {query_variants}")
    
    all_results = []
    seen_urls = set()  # To avoid duplicates by URL
    seen_items = set()  # To avoid duplicates by title+size
    
    for indexer in indexers:
        try:
            name = indexer.get('name', 'Unknown')
            url = indexer.get('url', '').rstrip('/')
            api_key = indexer.get('api_key', '')
            categories = indexer.get('categories', '2000')
            
            if not url or not api_key:
                logger.warning(f"Skipping indexer {name}: missing URL or API key")
                continue
            
            # Try each query variant
            for variant in query_variants:
                try:
                    # Torznab search params
                    params = {
                        't': 'movie',
                        'q': variant,
                        'apikey': api_key,
                        'cat': categories
                    }
                    
                    logger.info(f"Searching {name} for '{variant}'")
                    response = requests.get(url, params=params, timeout=15)
                    
                    if response.status_code != 200:
                        logger.error(f"Indexer {name} returned status {response.status_code}")
                        continue
                    
                    # Parse XML response
                    root = ET.fromstring(response.content)
                    
                    # Torznab uses RSS format with additional attributes
                    for item in root.findall('.//item'):
                        try:
                            title_elem = item.find('title')
                            link_elem = item.find('link')
                            size_elem = item.find('size')
                            
                            # Get download URL to check for duplicates
                            download_url = link_elem.text if link_elem is not None else ''
                            title_text = title_elem.text if title_elem is not None else 'Unknown'
                            size = int(size_elem.text) if size_elem is not None and size_elem.text else 0
                            
                            # Create unique identifier by title + size
                            item_signature = f"{title_text}_{size}"
                            
                            # Skip if we've already seen this URL or title+size combo
                            if download_url in seen_urls or item_signature in seen_items:
                                continue
                            
                            # Extract year from title if possible
                            year = None
                            
                            # ✅ IMPROVED: Multiple patterns for year extraction
                            # Handles: (2023), [2023], .2023., space before + space/dot/end after
                            year_patterns = [
                                r'\((\d{4})\)',           # (2023)
                                r'\[(\d{4})\]',           # [2023]
                                r'\.(\d{4})\.',           # .2023.
                                r'\s(\d{4})(?:[\s\.]|$)', # space before, space/dot/end after
                            ]
                            for pattern in year_patterns:
                                match = re.search(pattern, title_text)
                                if match:
                                    year = match.group(1)
                                    break
                            
                            result = {
                                'title': title_text,
                                'year': year,
                                'size': size,
                                'download_url': download_url,
                                'indexer': name
                            }
                            
                            all_results.append(result)
                            seen_urls.add(download_url)
                            seen_items.add(item_signature)
                            
                        except Exception as e:
                            logger.error(f"Error parsing item from {name}: {e}")
                            continue
                    
                    logger.info(f"Found {len(root.findall('.//item'))} results from {name} with query '{variant}'")
                
                except Exception as e:
                    logger.error(f"❌ [SEARCH] Error searching {name} with variant '{variant}': {e}")
                    continue
                    
        except Exception as e:
            logger.error(f"❌ [SEARCH] Error searching indexer {name}: {e}")
            continue
    
    # FALLBACK TO ENGLISH IF NO RESULTS FOUND
    # If search in tracker's language returned 0 results and we have TMDB ID,
    # try searching with English title as fallback
    if len(all_results) == 0 and tmdb_id:
        logger.warning(f"No results found in tracker language(s). Trying English fallback...")
        
        try:
            # Fetch English title from TMDB
            tmdb_api_key = settings.get('tmdb_api_key')
            english_titles = get_movie_titles_in_languages(tmdb_id, ['en-US'], tmdb_api_key)
            
            if english_titles and 'en-US' in english_titles:
                english_title = english_titles['en-US']
                logger.info(f"🇬🇧 English fallback title: '{english_title}'")
                
                # Generate variants for English title
                english_variants = []
                english_variants.append(english_title)
                
                # Remove punctuation variant
                clean_english = re.sub(r'[:;,\-\–\—]', ' ', english_title)
                clean_english = re.sub(r'\s+', ' ', clean_english).strip()
                if clean_english != english_title:
                    english_variants.append(clean_english)
                
                # Remove dots variant
                no_dots_english = english_title.replace('.', ' ')
                no_dots_english = re.sub(r'\s+', ' ', no_dots_english).strip()
                if no_dots_english != english_title and no_dots_english not in english_variants:
                    english_variants.append(no_dots_english)
                
                logger.info(f"Searching with English variants: {english_variants}")
                
                # Search again with English title
                for indexer in indexers:
                    try:
                        name = indexer.get('name', 'Unknown')
                        url = indexer.get('url', '').rstrip('/')
                        api_key = indexer.get('api_key', '')
                        categories = indexer.get('categories', '2000')
                        
                        if not url or not api_key:
                            continue
                        
                        for variant in english_variants:
                            logger.debug(f"🔧 [English Fallback] Trying variant: '{variant}'") # Changed to debug
                            try:
                                params = {
                                    't': 'movie',
                                    'q': variant,
                                    'apikey': api_key,
                                    'cat': categories
                                }
                                
                                logger.debug(f"[English Fallback] Searching {name} for '{variant}'") # Changed to debug
                                response = requests.get(url, params=params, timeout=15)
                                
                                if response.status_code != 200:
                                    continue
                                
                                root = ET.fromstring(response.content)
                                
                                for item in root.findall('.//item'):
                                    try:
                                        title_elem = item.find('title')
                                        link_elem = item.find('link')
                                        size_elem = item.find('size')
                                        
                                        download_url = link_elem.text if link_elem is not None else ''
                                        title_text = title_elem.text if title_elem is not None else 'Unknown'
                                        size = int(size_elem.text) if size_elem is not None and size_elem.text else 0
                                        
                                        item_signature = f"{title_text}_{size}"
                                        
                                        if download_url in seen_urls or item_signature in seen_items:
                                            continue
                                        
                                        year = None
                                        # ✅ IMPROVED: Multiple patterns for year extraction
                                        year_patterns = [
                                            r'\((\d{4})\)',           # (2023)
                                            r'\[(\d{4})\]',           # [2023]
                                            r'\.(\d{4})\.',           # .2023.
                                            r'\s(\d{4})(?:[\s\.]|$)', # space before, space/dot/end after
                                        ]
                                        for pattern in year_patterns:
                                            match = re.search(pattern, title_text)
                                            if match:
                                                year = match.group(1)
                                                break
                                        
                                        result = {
                                            'title': title_text,
                                            'download_url': download_url,
                                            'size': size,
                                            'indexer': name,
                                            'year': year
                                        }
                                        
                                        all_results.append(result)
                                        seen_urls.add(download_url)
                                        seen_items.add(item_signature)
                                        
                                    except Exception as item_err:
                                        logger.error(f"Error parsing item in English fallback: {item_err}")
                                        continue
                                
                                # Log results found with this variant
                                logger.info(f"Found {len([r for r in all_results if r['indexer'] == name])} results from {name} with English query '{variant}'")
                                
                            except Exception as variant_err:
                                logger.error(f"Error searching variant '{variant}': {variant_err}")
                                continue
                                
                    except Exception as indexer_err:
                        logger.error(f"Error in English fallback for {name}: {indexer_err}")
                        continue
                
                if all_results:
                    logger.info(f"✅ English fallback successful: found {len(all_results)} results")
                else:
                    logger.warning(f"❌ English fallback also returned 0 results")
            else:
                logger.warning("Could not fetch English title from TMDB for fallback")
                
        except Exception as fallback_err:
            logger.error(f"Error in English fallback: {fallback_err}")
    
    logger.info(f"Total raw search results before filtering: {len(all_results)}")
    
    # Extract year from query for similarity boost
    year_for_boost = None
    year_match = re.search(r'\b(\d{4})\b', query)
    if year_match:
        year_for_boost = year_match.group(1)
        logger.debug(f"Extracted year {year_for_boost} from query for similarity boost")
    
    # FILTER RESULTS TO REMOVE FALSE POSITIVES
    # This is critical for short titles like "Eli" which match "película", "rebelión", etc.
    all_results = filter_search_results(all_results, query, min_similarity=0.4, year=year_for_boost)
    
    logger.info(f"Total filtered search results: {len(all_results)}")
    return all_results



def test_rss_feed(url):
    """
    Tests an RSS feed by fetching and parsing it.
    Returns (success, message, feed_info)
    """
    import feedparser
    
    try:
        logger.info(f"Testing RSS feed: {url}")
        
        # Fetch and parse RSS feed
        feed = feedparser.parse(url)
        
        # Check for errors
        if feed.bozo:
            # Feed has errors but might still be parseable
            error = feed.get('bozo_exception', 'Unknown parsing error')
            logger.warning(f"RSS feed has parsing issues: {error}")
        
        # Check if we got any entries
        if not feed.entries:
            return False, "RSS feed is empty or invalid", None
        
        # Extract feed info
        feed_info = {
            'title': feed.feed.get('title', 'Unknown'),
            'description': feed.feed.get('description', ''),
            'entries_count': len(feed.entries),
            'latest_entry': feed.entries[0].get('title', 'N/A') if feed.entries else 'N/A'
        }
        
        logger.info(f"RSS feed valid: {feed_info['title']} ({feed_info['entries_count']} entries)")
        return True, f"RSS feed valid: {feed_info['entries_count']} entries found", feed_info
        
    except Exception as e:
        logger.error(f"RSS feed test error: {e}")
        return False, f"Error testing RSS feed: {str(e)}", None




def select_best_torrent(results, preferred_size_mb, max_size_mb):
    """
    Selects the best torrent based on size criteria.
    - Filters out torrents larger than max_size_mb (if set).
    - Sorts remaining by closeness to preferred_size_mb.
    - Returns the best match or None.
    """
    if not results:
        return None
        
    valid_results = []
    
    # 1. Filter by Max Size
    for res in results:
        size_mb = res.get('size', 0) / 1024 / 1024 # Convert bytes to MB
        res['size_mb'] = size_mb # Store for easier access
        
        if max_size_mb > 0 and size_mb > max_size_mb:
            continue
            
        valid_results.append(res)
        
    if not valid_results:
        return None
        
    # 2. Sort by Similarity (if available) then by Preferred Size
    # ✅ NEW: Prioritize similarity score from filter_false_positives
    has_similarity = any('_similarity' in r for r in valid_results)
    
    logger.debug(f"🔍 select_best_torrent: has_similarity={has_similarity}, total_results={len(valid_results)}")
    
    if has_similarity:
        # Log top 5 results with similarity scores before sorting
        logger.info("📊 Top candidates before sorting:")
        for i, r in enumerate(valid_results[:5]):
            logger.info(f"  {i+1}. {r.get('title', 'Unknown')[:60]} - similarity: {r.get('_similarity', 0):.3f}, size: {r.get('size_mb', 0):.0f} MB")
        
        # Sort by similarity (highest first), then by size preference
        if preferred_size_mb > 0:
            valid_results.sort(
                key=lambda x: (
                    -x.get('_similarity', 0),  # Negative for descending (highest similarity first)
                    abs(x['size_mb'] - preferred_size_mb)  # Then by size preference
                )
            )
        else:
            # Just sort by similarity
            valid_results.sort(key=lambda x: x.get('_similarity', 0), reverse=True)
        
        # Log selected result
        selected = valid_results[0]
        logger.info(f"✅ Selected (by similarity): {selected.get('title', 'Unknown')[:60]} - similarity: {selected.get('_similarity', 0):.3f}")
    else:
        # Legacy behavior: sort by size only
        if preferred_size_mb > 0:
            valid_results.sort(key=lambda x: abs(x['size_mb'] - preferred_size_mb))
        logger.info(f"⚠️ No similarity scores found, selected by size: {valid_results[0].get('title', 'Unknown')[:60]}")
        
    return valid_results[0]

def auto_download_movie(title, year, preferred_size_gb, max_size_gb, label=None, tmdb_id=None):
    """
    Automatically searches for and downloads a movie torrent.
    Returns (torrent_hash, torrent_name, reason) - reason is None on success, error message on failure.
    """
    logger.info("=" * 80)
    logger.info(f"📥 [DOWNLOAD] AUTO-DOWNLOAD STARTED - '{title}' ({year})")
    logger.info("=" * 80)
    logger.info(f"📥 [DOWNLOAD] Size limits: {preferred_size_gb} GB (preferred) / {max_size_gb} GB (max)")
    
    settings = load_settings()
    
    # 1. Search (with intelligent multi-language if tmdb_id provided)
    query = f"{title} {year}" if year else title
    results = search_indexers(query, settings, tmdb_id=tmdb_id)
    
    if not results:
        logger.info(f"No search results found for: {query}")
        return None, None, "No torrents found"
        
    # 2. Select Best Torrent
    best_torrent = select_best_torrent(results, preferred_size_gb, max_size_gb)
    
    if not best_torrent:
        logger.info(f"No suitable torrent found for {title} within size limits (Max: {max_size_gb}MB)")
        return None, None, f"No torrent within size limits (max: {max_size_gb} MB)"
        
    logger.info(f"Selected torrent: {best_torrent['title']} ({int(best_torrent['size_mb'])} MB)")
    
    # 3. Add to torrent client
    try:
        qb = get_qb_client(settings)
        qb.auth_log_in()
        
        # Get torrents list BEFORE adding to compare
        torrents_before = {t['hash'] for t in qb.torrents_info()}
        
        # Add torrent with label/tag if provided
        if label:
            logger.info(f"Adding torrent with label: {label}")
            qb.torrents_add(urls=best_torrent['download_url'], tags=label)
        else:
            qb.torrents_add(urls=best_torrent['download_url'])
            
        # Give torrent client time to add the torrent (retry loop for reliability)
        import time
        max_retries = 6
        new_torrents = []
        
        for attempt in range(max_retries):
            time.sleep(1)  # Sleep 1 second between retries
            
            # Get the torrent hash by finding the NEW torrent that was just added
            torrents_after = qb.torrents_info()
            
            # Find torrents that weren't there before
            new_torrents = [t for t in torrents_after if t['hash'] not in torrents_before]
            
            if new_torrents:
                logger.info(f"New torrent detected after {attempt + 1} attempts")
                break
        
        if new_torrents:
            # If we have multiple new torrents, try to find the one matching our title/year
            matching_torrent = None
            for t in new_torrents:
                t_title, t_year = clean_torrent_name(t['name'])
                # Check if title matches (case insensitive) and year matches (if provided)
                title_matches = t_title.lower() == title.lower() or title.lower() in t_title.lower()
                year_matches = (not year) or (str(t_year) == str(year))
                
                if title_matches and year_matches:
                    matching_torrent = t
                    break
            
            # Use matching torrent if found, otherwise use the first new torrent
            selected = matching_torrent or new_torrents[0]
            logger.info(f"Added torrent to download client: {selected['name']} (hash: {selected['hash'][:8]}...)")
            return selected['hash'], selected['name'], None  # Success - no reason needed
        
        
        # ❌ REMOVED UNSAFE FALLBACK: Do not use "most recent" torrent as it may be wrong
        # If we can't detect the new torrent, it's better to fail than to assign wrong hash
        logger.error(f"❌ Could not detect new torrent after {max_retries} retries for: {best_torrent['title']}")
        logger.error(f"⚠️ This movie will NOT be added to the database to prevent data corruption")
        logger.error(f"💡 Possible causes: Torrent client slow to respond, network issues, or torrent already exists")
        return None, None, "Torrent client did not respond"
        
    except Exception as e:
        logger.error(f"Error adding torrent to download client: {e}")
        return None, None, f"Download client error: {str(e)}"

def is_movie_ignored(title, year, tmdb_id, ignored_movies):
    def normalize(t):
        if not t: return ""
        return "".join(re.sub(r'[^\w\s]', '', t.lower()).split())
        
    norm_title = normalize(title)
    
    for m in ignored_movies:
        if tmdb_id and m.tmdb_id:
            if int(tmdb_id) == int(m.tmdb_id):
                return True
                
        norm_db_title = normalize(m.title)
        norm_db_torrent = normalize(m.torrent_name)
        
        title_matches = (norm_title == norm_db_title or (norm_db_torrent and norm_title == norm_db_torrent))
        
        year_matches = True
        if year and m.year:
            year_matches = str(year) == str(m.year)
            
        if title_matches and year_matches:
            return True
            
    return False

def get_watchlist_movie(title, year, tmdb_id, watchlist_movies):
    def normalize(t):
        if not t: return ""
        return "".join(re.sub(r'[^\w\s]', '', t.lower()).split())
        
    norm_title = normalize(title)
    
    for m in watchlist_movies:
        if tmdb_id and m.tmdb_id:
            if int(tmdb_id) == int(m.tmdb_id):
                return m
                
        norm_db_title = normalize(m.title)
        norm_db_torrent = normalize(m.torrent_name)
        
        title_matches = (norm_title == norm_db_title or (norm_db_torrent and norm_title == norm_db_torrent))
        
        year_matches = True
        if year and m.year:
            year_matches = str(year) == str(m.year)
            
        if title_matches and year_matches:
            return m
            
    return None

def is_duplicate_movie(title, year, tmdb_id, existing_movies):
    def normalize(t):
        if not t: return ""
        return "".join(re.sub(r'[^\w\s]', '', t.lower()).split())
        
    norm_title = normalize(title)
    
    for m in existing_movies:
        if tmdb_id and m.tmdb_id:
            if int(tmdb_id) == int(m.tmdb_id):
                return True
                
        norm_db_title = normalize(m.title)
        norm_db_torrent = normalize(m.torrent_name)
        
        title_matches = (norm_title == norm_db_title or (norm_db_torrent and norm_title == norm_db_torrent))
        
        year_matches = True
        if year and m.year:
            year_matches = str(year) == str(m.year)
            
        if title_matches and year_matches:
            return True
            
    return False

def fetch_rss_movies(limit=30):
    """
    Fetch movies from all RSS feeds and add them to the database
    """
    logger.info("=" * 80)
    logger.info("📡 [RSS] RSS FETCH STARTED")
    logger.info("=" * 80)
    
    settings = load_settings()
    feeds = settings.get('rss_feeds', [])
    api_key = settings.get('tmdb_api_key')
    
    ignored_movies = list(Movie.select().where(Movie.ignored == True))
    watchlist_movies = list(Movie.select().where(Movie.watchlist == True))
    existing_movies = list(Movie.select().where(
        (Movie.ignored == False) & 
        ((Movie.watchlist == False) | (Movie.watchlist.is_null()))
    ))
    
    if not feeds:
        logger.warning("⚠️  [RSS] No RSS feeds configured")
        return {"success": False, "message": "No RSS feeds configured"}
        
    # Create map for easy config lookup
    feed_map = {f.get('name'): f for f in feeds}
    
    import feedparser
    all_entries = []
    
    # 1. Fetch from all feeds
    logger.info(f"📥 [RSS] Fetching from {len(feeds)} configured feed(s)")
    for feed_config in feeds:
        url = feed_config.get('url')
        feed_name = feed_config.get('name', 'Unknown')
        if not url: continue
        
        try:
            logger.debug(f"🔧 [RSS] Fetching feed: {feed_name}")
            feed = feedparser.parse(url)
            
            for entry in feed.entries:
                # Extract basic info
                title = entry.get('title', 'Unknown')
                link = entry.get('link', '')
                
                # Extract TMDB ID from description if available
                tmdb_id = None
                description = entry.get('description', '') or entry.get('summary', '')
                if description:
                    # Look for TMDB Link: <a href="https://anon.to?https://www.themoviedb.org/movie/23168">23168</a>
                    import re
                    tmdb_match = re.search(r'themoviedb\.org/movie/(\d+)', description)
                    if tmdb_match:
                        tmdb_id = tmdb_match.group(1)
                        logger.debug(f"Extracted TMDB ID {tmdb_id} from RSS entry: {title}")
                
                # Parse date
                published = None
                if hasattr(entry, 'published_parsed'):
                    published = datetime.fromtimestamp(time.mktime(entry.published_parsed))
                elif hasattr(entry, 'updated_parsed'):
                    published = datetime.fromtimestamp(time.mktime(entry.updated_parsed))
                else:
                    published = datetime.now()
                
                all_entries.append({
                    'title': title,
                    'link': link,
                    'published': published,
                    'feed_name': feed_config.get('name', 'Unknown'),
                    'tmdb_id': tmdb_id  # Include TMDB ID if found
                })
                
        except Exception as e:
            logger.error(f"Error fetching feed {url}: {e}")
            
    # 2. Deduplicate and Sort
    # Sort by date desc
    all_entries.sort(key=lambda x: x['published'], reverse=True)
    
    unique_entries = []
    seen_titles = set()
    
    for entry in all_entries:
        # Clean title to improve deduplication
        clean_title, year = clean_torrent_name(entry['title'])
        key = f"{clean_title}_{year}" if year else clean_title
        
        if key not in seen_titles:
            seen_titles.add(key)
            unique_entries.append(entry)
            
        if len(unique_entries) >= limit:
            break
            
    # 3. Add to Database
    logger.info(f"Processing {len(unique_entries)} unique entries from RSS feeds (limit: {limit})")
    added_count = 0
    added_movies = []
    
    for entry in unique_entries:
        try:
            # Generate a unique pseudo-hash for RSS items
            # Use MD5 of (title + year + timestamp) to ensure uniqueness
            
            # If TMDB ID is available, fetch exact title and year from TMDB
            title = None
            year = None
            if entry.get('tmdb_id'):
                try:
                    tmdb_url = f"https://api.themoviedb.org/3/movie/{entry['tmdb_id']}"
                    params = {"api_key": api_key, "language": get_language()}
                    res = requests.get(tmdb_url, params=params, timeout=5)
                    if res.status_code == 200:
                        tmdb_data = res.json()
                        title = tmdb_data.get('title')
                        year = tmdb_data.get('release_date', '')[:4] if tmdb_data.get('release_date') else None
                        logger.info(f"Using TMDB ID {entry['tmdb_id']} → Exact match: '{title}' ({year})")
                except Exception as e:
                    logger.warning(f"Failed to fetch TMDB data for ID {entry['tmdb_id']}: {e}")
            
            # Fallback to parsing title from RSS entry if TMDB failed or not available
            if not title:
                title, year = clean_torrent_name(entry['title'])
            
            unique_string = f"{title}_{year}_{entry['published'].isoformat()}_{entry['link']}"
            pseudo_hash = hashlib.md5(unique_string.encode()).hexdigest()
            logger.info(f"Generated pseudo_hash for RSS: '{title}' ({year}) -> {pseudo_hash[:8]}... from link: {entry['link'][:50]}...")
            
            # Check if exists by hash first (exact same RSS entry)
            if Movie.select().where(Movie.torrent_hash == pseudo_hash).exists():
                logger.info(f"RSS movie '{title}' ({year}) already exists with exact hash {pseudo_hash[:8]}..., skipping")
                continue

            # Year filtering check (only for RSS entry)
            feed_config = feed_map.get(entry['feed_name'])
            min_year = feed_config.get('min_year') if feed_config else None
            if min_year:
                try:
                    min_year_val = int(min_year)
                    if year and int(year) < min_year_val:
                        logger.info(f"Skipping RSS movie '{title}' ({year}) as it is older than minimum year filter {min_year_val}. Auto-ignoring in DB.")
                        # Save in DB as ignored to avoid duplicate checks in future
                        Movie.create(
                            torrent_hash=pseudo_hash,
                            title=title,
                            year=year,
                            ignored=True,
                            ignored_at=datetime.now(),
                            state='rss',
                            status='new',
                            torrent_name=entry['title'],
                            overview=f"Auto-ignored: released before {min_year_val}"
                        )
                        continue
                except ValueError:
                    pass
            
            # First check if movie is ignored (skip completely - no RSS entry, no auto-download)
            if is_movie_ignored(title, year, entry.get('tmdb_id'), ignored_movies):
                logger.info(f"Movie '{title}' ({year}) is in ignored list. Skipping RSS entry.")
                continue
            
            # CHECK IF MOVIE IS IN WATCHLIST
            watchlist_movie = get_watchlist_movie(title, year, entry.get('tmdb_id'), watchlist_movies)
            if watchlist_movie:
                # Movie is in watchlist - check expiration and size
                if watchlist_movie.watchlist_expiry and datetime.now() > watchlist_movie.watchlist_expiry:
                    # Watchlist expired - move to dashboard as "New" (no auto-download)
                    logger.info(f"Watchlist expired for '{title}' ({year}). Adding to dashboard as New.")
                    watchlist_movie.watchlist = False
                    watchlist_movie.watchlist_expiry = None
                    watchlist_movie.save()
                    # Continue to add to dashboard below (will NOT auto-download due to flag cleared)
                else:
                    # Still in watchlist - check if size is now acceptable
                    logger.info(f"Movie '{title}' ({year}) is in watchlist. Checking for acceptable size...")
                    
                    # Get feed config for size preferences
                    feed_config = feed_map.get(entry['feed_name'])
                    if feed_config:
                        preferred_size = int(feed_config.get('preferred_size', 0))
                        max_size = int(feed_config.get('max_size', 0))
                        
                        # Check if torrent with acceptable size exists
                        size_found = check_torrent_size_available(title, year, preferred_size, max_size)
                        
                        if size_found:
                            # Size is acceptable now - remove from watchlist and proceed with auto-download
                            logger.info(f"Acceptable size found for '{title}' ({year}). Removing from watchlist, proceeding with auto-download.")
                            watchlist_movie.watchlist = False
                            watchlist_movie.watchlist_expiry = None
                            watchlist_movie.save()
                            # Falls through to auto-download section below
                        else:
                            # Size still not acceptable - keep in watchlist
                            logger.info(f"Size not acceptable for '{title}' ({year}). Keeping in watchlist.")
                            continue
                    else:
                        # No feed config - keep in watchlist
                        logger.info(f"No feed config for watchlist movie '{title}'. Keeping in watchlist.")
                        continue
                
            # CRITICAL FIX: Check if movie already exists in dashboard by title+year (not ignored, not watchlist)
            # This prevents duplicate entries for the same movie in different qualities/formats
            if is_duplicate_movie(title, year, entry.get('tmdb_id'), existing_movies):
                logger.info(f"Movie '{title}' ({year}) already exists in dashboard. Skipping duplicate RSS entry.")
                continue
            
            # CHECK FOR AUTO-DOWNLOAD (only for new, non-ignored movies)
            feed_config = feed_map.get(entry['feed_name'])
            if feed_config and feed_config.get('auto_add'):
                preferred_size = int(feed_config.get('preferred_size', 0))
                max_size = int(feed_config.get('max_size', 0))
                feed_label = feed_config.get('label', '')
                
                # First check if torrent already exists in torrent client
                # If it does, DON'T auto-download but DO add to dashboard as RSS entry
                try:
                    qb = get_qb_client(settings)
                    qb.auth_log_in()
                    existing_torrents = qb.torrents_info()
                    
                    # Check if any torrent matches this movie (by title/year)
                    torrent_exists = False
                    for t in existing_torrents:
                        t_title, t_year = clean_torrent_name(t['name'])
                        if t_title.lower() == title.lower() and (not year or str(t_year) == str(year)):
                            logger.info(f"Movie '{title}' ({year}) already exists in torrent client. Skipping duplicate RSS entry.")
                            torrent_exists = True
                            break
                    
                    if torrent_exists:
                        # Skip this entry entirely - no auto-download, no RSS entry
                        continue
                    
                    # Torrent doesn't exist, proceed with auto-download
                    logger.info(f"Auto-download enabled for {title} from feed '{entry['feed_name']}' with label '{feed_label}'")
                    
                    # Get TMDB ID from entry for intelligent multi-language search
                    entry_tmdb_id = entry.get('tmdb_id')
                    if entry_tmdb_id:
                        logger.info(f"Using TMDB ID {entry_tmdb_id} for intelligent multi-language search")
                    
                    torrent_hash, torrent_name, download_reason = auto_download_movie(
                        title, year, preferred_size, max_size, 
                        label=feed_label, 
                        tmdb_id=entry_tmdb_id
                    )
                    if torrent_hash:
                        logger.info(f"Successfully auto-downloaded {title} from RSS. Adding to DB with real hash.")
                        
                        # Fetch Metadata (same as non-auto-download path)
                        metadata = None
                        if api_key:
                            metadata = fetch_complete_movie_metadata(title, year, api_key, tmdb_id=entry_tmdb_id)
                        
                        poster_local = None
                        backdrop_local = None
                        
                        if metadata:
                            # Download Images using torrent hash (not pseudo-hash)
                            if metadata.get('poster_path'):
                                poster_url = f"https://image.tmdb.org/t/p/w500{metadata.get('poster_path')}"
                                poster_local = download_image(poster_url, f"{torrent_hash}_poster.jpg")
                                
                            if metadata.get('backdrop_path'):
                                backdrop_url = f"https://image.tmdb.org/t/p/w1280{metadata.get('backdrop_path')}"
                                backdrop_local = download_image(backdrop_url, f"{torrent_hash}_backdrop.jpg")
                        
                        # Create DB Entry with REAL torrent hash
                        try:
                            Movie.create(
                                torrent_hash=torrent_hash,
                                title=metadata.get('title', title) if metadata else title,
                                year=metadata.get('year', year) if metadata else year,
                                poster_path=poster_local,
                                backdrop_path=backdrop_local,
                                overview=metadata.get('overview') if metadata else "Auto-downloaded from RSS",
                                runtime=metadata.get('runtime') if metadata else 0,
                                genres=metadata.get('genres') if metadata else None,
                                state='downloading',  # Mark as downloading (not 'rss')
                                progress=0.0,
                                size=0,
                                status='new',
                                cast=metadata.get('cast') if metadata else None,
                                crew=metadata.get('crew') if metadata else None,
                                vote_average=metadata.get('vote_average') if metadata else 0,
                                vote_count=metadata.get('vote_count') if metadata else 0,
                                imdb_id=metadata.get('imdb_id') if metadata else None,
                                imdb_rating=metadata.get('imdb_rating') if metadata else None,
                                imdb_votes=metadata.get('imdb_votes') if metadata else None,
                                tmdb_id=int(entry_tmdb_id) if entry_tmdb_id else None,  # Save TMDB ID for intelligent search
                                country_code=metadata.get('country_code') if metadata else None,  # Save country code for flag display
                                metadata_updated_at=datetime.now(),
                                torrent_name=torrent_name
                            )
                            logger.info(f"Created DB entry for auto-downloaded movie: {title} ({year})")
                            
                            # Notify Telegram: New Movie Found (RSS Auto-Download)
                            settings = load_settings()
                            if settings.get('telegram_notify_on_new_movie', True):
                                movie_title = metadata.get('title', title) if metadata else title
                                movie_year = metadata.get('year', year) if metadata else year
                                send_telegram_notification(f"🆕 <b>New Movie Found</b>\n\n🎬 {movie_title} ({movie_year})\n📥 Auto-downloaded from RSS.")
                            
                        except Exception as create_error:
                            # Handle race condition: sync_movies may have already created this entry
                            if "UNIQUE constraint failed" in str(create_error):
                                logger.info(f"Movie '{title}' ({year}) already added to DB by sync_movies (race condition). Updating with RSS metadata.")
                                
                                # Update the existing entry with proper metadata
                                try:
                                    existing_movie = Movie.get(Movie.torrent_hash == torrent_hash)
                                    
                                    # Update all metadata fields
                                    existing_movie.title = metadata.get('title', title) if metadata else title
                                    existing_movie.year = metadata.get('year', year) if metadata else year
                                    existing_movie.poster_path = poster_local
                                    existing_movie.backdrop_path = backdrop_local
                                    existing_movie.overview = metadata.get('overview') if metadata else "Auto-downloaded from RSS"
                                    existing_movie.runtime = metadata.get('runtime') if metadata else 0
                                    existing_movie.genres = metadata.get('genres') if metadata else None
                                    existing_movie.cast = metadata.get('cast') if metadata else None
                                    existing_movie.crew = metadata.get('crew') if metadata else None
                                    existing_movie.vote_average = metadata.get('vote_average') if metadata else 0
                                    existing_movie.vote_count = metadata.get('vote_count') if metadata else 0
                                    existing_movie.imdb_id = metadata.get('imdb_id') if metadata else None
                                    existing_movie.imdb_rating = metadata.get('imdb_rating') if metadata else None
                                    existing_movie.imdb_votes = metadata.get('imdb_votes') if metadata else None
                                    existing_movie.tmdb_id = int(entry_tmdb_id) if entry_tmdb_id else None  # Save TMDB ID
                                    existing_movie.metadata_updated_at = datetime.now()
                                    existing_movie.torrent_name = torrent_name
                                    
                                    # Override status to 'new' - this was just auto-downloaded from RSS
                                    # Fixes race condition where sync_movies assigns incorrect 'pending' status
                                    existing_movie.status = 'new'
                                    
                                    existing_movie.save()
                                    logger.info(f"Successfully updated existing movie '{title}' ({year}) with RSS metadata")
                                    
                                except Exception as update_error:
                                    logger.error(f"Failed to update existing movie '{title}' with RSS metadata: {update_error}")
                            else:
                                logger.error(f"Error creating DB entry for '{title}': {create_error}")
                        
                        added_count += 1
                        continue  # Skip the normal RSS entry creation path

                    else:
                        # Auto-download failed - create RSS entry with reason
                        logger.info(f"Auto-download failed for {title}: {download_reason}. Creating RSS entry.")
                        
                        # Fetch Metadata for the failed entry
                        metadata = None
                        if api_key:
                            metadata = fetch_complete_movie_metadata(title, year, api_key, tmdb_id=entry_tmdb_id)
                        
                        poster_local = None
                        backdrop_local = None
                        
                        if metadata:
                            if metadata.get('poster_path'):
                                poster_url = f"https://image.tmdb.org/t/p/w500{metadata.get('poster_path')}"
                                poster_local = download_image(poster_url, f"{pseudo_hash}_poster.jpg")
                            if metadata.get('backdrop_path'):
                                backdrop_url = f"https://image.tmdb.org/t/p/w1280{metadata.get('backdrop_path')}"
                                backdrop_local = download_image(backdrop_url, f"{pseudo_hash}_backdrop.jpg")
                        else:
                            poster_local = 'posters/placeholder_unidentified.png'
                        
                        Movie.create(
                            torrent_hash=pseudo_hash,
                            title=metadata.get('title', title) if metadata else title,
                            year=metadata.get('year', year) if metadata else year,
                            poster_path=poster_local,
                            backdrop_path=backdrop_local,
                            overview=metadata.get('overview') if metadata else "Imported from RSS",
                            runtime=metadata.get('runtime') if metadata else 0,
                            genres=metadata.get('genres') if metadata else None,
                            state='rss',
                            progress=0.0,
                            size=0,
                            status='new',
                            status_reason=download_reason,  # Save the reason for failure
                            cast=metadata.get('cast') if metadata else None,
                            crew=metadata.get('crew') if metadata else None,
                            vote_average=metadata.get('vote_average') if metadata else 0,
                            vote_count=metadata.get('vote_count') if metadata else 0,
                            imdb_id=metadata.get('imdb_id') if metadata else None,
                            imdb_rating=metadata.get('imdb_rating') if metadata else None,
                            imdb_votes=metadata.get('imdb_votes') if metadata else None,
                            tmdb_id=int(entry_tmdb_id) if entry_tmdb_id else None,
                            metadata_updated_at=datetime.now(),
                            torrent_name=entry['title']
                        )
                        
                        if settings.get('telegram_notify_on_new_movie', True):
                            movie_title = metadata.get('title', title) if metadata else title
                            movie_year = metadata.get('year', year) if metadata else year
                            send_telegram_notification(f"🆕 <b>New Movie Found</b>\n\n🎬 {movie_title} ({movie_year})\n⚠️ {download_reason}")
                        
                        added_count += 1
                        added_movies.append(entry['title'])
                        continue

                except Exception as e:
                    # Catch errors from torrent client check or auto_download_movie (NOT from Movie.create)
                    logger.error(f"Error in auto-download process: {e}")
                    # Continue to next entry instead of falling through to RSS entry creation
                    continue
            
            logger.info(f"Adding RSS movie: {entry['title']}")
            
            # Fetch Metadata
            title, year = clean_torrent_name(entry['title'])
            metadata = None
            if api_key:
                metadata = fetch_complete_movie_metadata(title, year, api_key)
            
            poster_local = None
            backdrop_local = None
            
            if metadata:
                # Download Images
                if metadata.get('poster_path'):
                    poster_url = f"https://image.tmdb.org/t/p/w500{metadata.get('poster_path')}"
                    poster_local = download_image(poster_url, f"{pseudo_hash}_poster.jpg")
                    
                if metadata.get('backdrop_path'):
                    backdrop_url = f"https://image.tmdb.org/t/p/w1280{metadata.get('backdrop_path')}"
                    backdrop_local = download_image(backdrop_url, f"{pseudo_hash}_backdrop.jpg")
            else:
                # TMDB not found - use placeholder
                logger.warning(f"TMDB metadata not found for '{title}' ({year}), using placeholder")
                poster_local = 'posters/placeholder_unidentified.png'
            
            # Create DB Entry (for feeds without auto_add)
            Movie.create(
                torrent_hash=pseudo_hash,
                title=metadata.get('title', title) if metadata else title,
                year=metadata.get('year', year) if metadata else year,
                poster_path=poster_local,
                backdrop_path=backdrop_local,
                overview=metadata.get('overview') if metadata else "Imported from RSS",
                runtime=metadata.get('runtime') if metadata else 0,
                genres=metadata.get('genres') if metadata else None,
                state='rss',
                progress=0.0,
                size=0,
                status='new', # Changed from 'rss_new' to 'new' per user request
                status_reason="Auto-download disabled for this feed",  # Reason for 'new' status
                cast=metadata.get('cast') if metadata else None,
                crew=metadata.get('crew') if metadata else None,
                vote_average=metadata.get('vote_average') if metadata else 0,
                vote_count=metadata.get('vote_count') if metadata else 0,
                imdb_id=metadata.get('imdb_id') if metadata else None,
                imdb_rating=metadata.get('imdb_rating') if metadata else None,
                imdb_votes=metadata.get('imdb_votes') if metadata else None,
                tmdb_id=int(entry.get('tmdb_id')) if entry.get('tmdb_id') else None,  # Save TMDB ID for intelligent search
                metadata_updated_at=datetime.now(),
                torrent_name=entry['title'] # Store original title
            )
            
            # Notify Telegram: New Movie Found (RSS - Not Auto-Downloaded)
            if settings.get('telegram_notify_on_new_movie', True):
                movie_title = metadata.get('title', title) if metadata else title
                movie_year = metadata.get('year', year) if metadata else year
                send_telegram_notification(f"🆕 <b>New Movie Found</b>\n\n🎬 {movie_title} ({movie_year})\n📥 Added from RSS.")
            
            added_count += 1
            added_movies.append(entry['title'])
            
        except Exception as e:
            logger.error(f"Error adding RSS movie {entry['title']}: {e}")
            
    if added_count > 0:
        trigger_movies_update_callback()
            
    return {
        "success": True, 
        "added": added_count, 
        "movies": added_movies,
        "message": f"Added {added_count} new movies from RSS"
    }


def get_rss_refresh_status():
    """
    Returns information about the next RSS feed refresh.
    Returns: {
        "next_feed_name": str,
        "next_feed_url": str,
        "countdown_seconds": int,
        "has_feeds": bool
    }
    """
    settings = load_settings()
    rss_feeds = settings.get('rss_feeds', [])
    
    # Filter enabled feeds
    enabled_feeds = [f for f in rss_feeds if f.get('enabled', True)]
    
    if not enabled_feeds:
        return {
            "has_feeds": False,
            "next_feed_name": None,
            "next_feed_url": None,
            "countdown_seconds": 0
        }
    
    now = time.time()
    next_feed = None
    min_time_to_refresh = float('inf')
    
    for feed in enabled_feeds:
        url = feed.get('url')
        interval = feed.get('refresh_interval', 300)
        
        # Get last fetch time (initialized by scheduler on startup)
        last_fetch = RSS_LAST_FETCH.get(url, now)
        
        # Calculate next refresh time
        next_refresh_time = last_fetch + interval
        time_to_refresh = next_refresh_time - now
        
        # If it's time to refresh (or past due), set countdown to 0
        if time_to_refresh < 0:
            time_to_refresh = 0
        
        # Track the feed with the soonest refresh
        if time_to_refresh < min_time_to_refresh:
            min_time_to_refresh = time_to_refresh
            next_feed = feed
    
    if next_feed:
        return {
            "has_feeds": True,
            "next_feed_name": next_feed.get('name', 'Unknown'),
            "next_feed_url": next_feed.get('url'),
            "countdown_seconds": int(min_time_to_refresh)
        }
    
    return {
        "has_feeds": False,
        "next_feed_name": None,
        "next_feed_url": None,
        "countdown_seconds": 0
    }


async def rss_scheduler():
    """
    Background task that automatically fetches RSS feeds based on their refresh intervals.
    This runs continuously and checks every 10 seconds if any feed needs refreshing.
    """
    import asyncio
    
    logger.info("RSS Scheduler started")
    
    # Initialize RSS_LAST_FETCH for all feeds on first run (prevents immediate execution)
    settings = load_settings()
    rss_feeds = settings.get('rss_feeds', [])
    enabled_feeds = [f for f in rss_feeds if f.get('enabled', True)]
    
    current_time = time.time()
    for feed in enabled_feeds:
        url = feed.get('url')
        if url and url not in RSS_LAST_FETCH:
            # Initialize to current time so countdown starts from configured interval
            RSS_LAST_FETCH[url] = current_time
            logger.info(f"Initialized RSS timer for {feed.get('name', url)}")
    
    while True:
        try:
            settings = load_settings()
            rss_feeds = settings.get('rss_feeds', [])
            
            # Filter enabled feeds
            enabled_feeds = [f for f in rss_feeds if f.get('enabled', True)]
            
            if enabled_feeds:
                now = time.time()
                
                for feed in enabled_feeds:
                    url = feed.get('url')
                    interval = feed.get('refresh_interval', 300)
                    
                    # Get last fetch time (should exist from initialization, but fallback to now)
                    last_fetch = RSS_LAST_FETCH.get(url, now)
                    
                    # Check if it's time to refresh
                    if now - last_fetch >= interval:
                        logger.info(f"Auto-refreshing RSS feed: {feed.get('name', url)}")
                        
                        try:
                            # Call fetch_rss_movies (same as clicking "Fetch RSS" button)
                            result = fetch_rss_movies(limit=30)
                            
                            if result.get('success'):
                                logger.info(f"RSS auto-refresh successful: {result.get('message')}")
                            else:
                                logger.error(f"RSS auto-refresh failed: {result.get('message')}")
                            
                            # Update last fetch time
                            RSS_LAST_FETCH[url] = now
                            
                        except Exception as e:
                            logger.error(f"Error auto-refreshing RSS feed {url}: {e}")
            
            # Sleep for 10 seconds before checking again
            await asyncio.sleep(10)
            
        except Exception as e:
            logger.error(f"Error in RSS scheduler: {e}")
            await asyncio.sleep(10)

