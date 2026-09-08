import os
import re
import time
import json
import requests
import threading
import hashlib
import shutil
from datetime import datetime
from database import Movie, MoveHistory
from .config import logger, load_settings, get_language, trigger_movies_update_callback, MANUAL_SEARCH_TAG
from .notifications import send_telegram_notification
from .mover import clean_torrent_name, sanitize_path_component, manual_move, get_copy_progress, COPY_PROGRESS

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(APP_DIR, 'static')
POSTERS_DIR = "/data/posters" if os.path.exists("/data") else os.path.join(STATIC_DIR, 'posters')
os.makedirs(POSTERS_DIR, exist_ok=True)

# Global TMDB cache
_TMDB_SEARCH_CACHE = {}
TMDB_CACHE_TTL = 86400 # 24 hours

_TITLE_CACHE = {}

def get_cached_tmdb_result(title, year):
    """Get cached TMDB search result if available and not expired."""
    cache_key = f"{title.lower().strip()}_{year}"
    if cache_key in _TMDB_SEARCH_CACHE:
        timestamp, result = _TMDB_SEARCH_CACHE[cache_key]
        if time.time() - timestamp < TMDB_CACHE_TTL:
            logger.debug(f"TMDB cache hit for '{title}' ({year})")
            return result
    return None

def cache_tmdb_result(title, year, result):
    """Cache a TMDB search result."""
    cache_key = f"{title.lower().strip()}_{year}"
    _TMDB_SEARCH_CACHE[cache_key] = (time.time(), result)
    logger.debug(f"TMDB result cached for '{title}' ({year})")

def download_image(url, filename, force=False):
    """
    Downloads an image from url and saves it to POSTERS_DIR/filename.
    Returns the relative path for the frontend (e.g., 'posters/filename').
    If force=True, re-downloads even if file exists.
    """
    if not url:
        return None
    
    try:
        os.makedirs(POSTERS_DIR, exist_ok=True)
        save_path = os.path.join(POSTERS_DIR, filename)
        
        # If file exists, has valid size (> 100 bytes) and not forcing, skip download (cache)
        if os.path.exists(save_path) and os.path.getsize(save_path) > 100 and not force:
            return f"posters/{filename}"
        
        old_size = os.path.getsize(save_path) if os.path.exists(save_path) else 0
        logger.info(f"🖼️ [DOWNLOAD] Downloading: {url}")
        logger.info(f"🖼️ [DOWNLOAD] Saving to: {save_path} (force={force}, old_size={old_size})")
        
        temp_path = f"{save_path}.tmp"
        res = requests.get(url, stream=True, timeout=15)
        if res.status_code == 200:
            with open(temp_path, 'wb') as f:
                shutil.copyfileobj(res.raw, f)
            new_size = os.path.getsize(temp_path)
            if new_size > 100:
                if os.path.exists(save_path):
                    try:
                        os.remove(save_path)
                    except Exception:
                        pass
                os.replace(temp_path, save_path)
                logger.info(f"🖼️ [DOWNLOAD] Success! New size: {new_size} bytes")
                return f"posters/{filename}"
            else:
                logger.warning(f"🖼️ [DOWNLOAD] Image too small ({new_size} bytes), discarding")
                if os.path.exists(temp_path):
                    os.remove(temp_path)
        else:
            logger.error(f"🖼️ [DOWNLOAD] Failed! HTTP status: {res.status_code}")
            if os.path.exists(temp_path):
                os.remove(temp_path)
    except Exception as e:
        logger.error(f"Error downloading image {url}: {e}")
        if 'temp_path' in locals() and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass
    
    return None

def download_image_background(url, filename, movie_id, is_poster=True):
    """
    Downloads image in background and updates database when done.
    """
    try:
        local_path = download_image(url, filename, force=True)
        if local_path:
            from database import Movie
            try:
                movie = Movie.get_by_id(movie_id)
                if is_poster:
                    movie.poster_path = local_path
                else:
                    movie.backdrop_path = local_path
                movie.metadata_updated_at = datetime.now()
                movie.save()
                logger.info(f"Background download complete for {filename}")
                trigger_movies_update_callback()
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
    logger.info(f"­ƒÄ¼ [TMDB] METADATA FETCH STARTED - '{title}' ({year})")
    logger.info("=" * 80)
    try:
        movie_id = None
        matched_result = None
        
        # If TMDB ID is provided (e.g., from RSS), use it directly
        if tmdb_id:
            logger.info(f"­ƒÄ» [TMDB] Using exact TMDB ID: {tmdb_id} (from RSS)")
            movie_id = int(tmdb_id)
            # Fetch basic details to get the matched result
            try:
                details_url = f"https://api.themoviedb.org/3/movie/{movie_id}"
                params = {"api_key": api_key, "language": get_language()}
                res = requests.get(details_url, params=params, timeout=5)
                if res.status_code == 200:
                    matched_result = res.json()
                    logger.info(f"Ô£à [TMDB] Exact match using ID: '{matched_result.get('title')}' ({matched_result.get('release_date', '')[:4] if matched_result.get('release_date') else 'Unknown'})")
                else:
                    logger.warning(f"ÔÜá´©Å [TMDB] Failed to fetch movie with ID {tmdb_id}, falling back to search")
                    movie_id = None
            except Exception as e:
                logger.warning(f"ÔÜá´©Å [TMDB] Error fetching movie with ID {tmdb_id}: {e}, falling back to search")
                movie_id = None
        
        # If no TMDB ID or direct fetch failed, search for movie
        if not movie_id:
            # Ô£à PHASE 2: Check cache first
            cached = get_cached_tmdb_result(title, year)
            if cached:
                movie_id = cached.get('id')
                matched_result = cached
                logger.info(f"Ô£à [TMDB] Using cached result: '{cached.get('title')}' ({cached.get('release_date', '')[:4] if cached.get('release_date') else 'Unknown'})")
            else:
                # 1. Search for movie with fallback variants
                search_url = "https://api.themoviedb.org/3/search/movie"
                original_lang = get_language()
                
                # Generate search variants (ordered from most to least specific)
                variants = [
                    {"query": title, "year": year, "language": original_lang},  # Original with year
                    {"query": title, "language": original_lang},  # Without year
                ]
                
                # Variant 3: Remove trailing numbers (e.g., "K├Âln 75" ÔåÆ "K├Âln")
                import re
                title_no_numbers = re.sub(r'\s+\d+$', '', title).strip()
                if title_no_numbers != title:
                    variants.append({"query": title_no_numbers, "year": year, "language": original_lang})
                
                # Variant 4: Try in English
                if original_lang != 'en-US':
                    variants.append({"query": title, "year": year, "language": "en-US"})
                
                # Variant 5: Normalize special characters (├ÂÔåÆo, ├íÔåÆa, etc.)
                import unicodedata
                normalized = unicodedata.normalize('NFKD', title).encode('ascii', 'ignore').decode('utf-8')
                if normalized != title and normalized:
                    variants.append({"query": normalized, "year": year, "language": original_lang})
                
                # Ô£à PHASE 2: Single loop with integrated fallback (was two separate loops)
                fallback_result = None  # Store first result as fallback
                
                for i, variant in enumerate(variants):
                    params = {"api_key": api_key, **variant}
                    logger.debug(f"­ƒöº [TMDB] Variant {i+1}/{len(variants)}: query='{variant['query']}', year={variant.get('year', 'None')}, lang={variant['language']}")
                    
                    res = requests.get(search_url, params=params, timeout=10)  # Increased timeout
                    search_data = res.json()
                    
                    if search_data.get('results'):
                        for result in search_data['results']:
                            result_year = result.get('release_date', '')[:4] if result.get('release_date') else None
                            result_title = result.get('title', 'Unknown')
                            
                            # Store first result as fallback (in case no year match)
                            if not fallback_result:
                                fallback_result = result
                            
                            # If year was provided, validate it matches (tolerance ┬▒1 year)
                            if year:
                                if result_year:
                                    try:
                                        year_diff = abs(int(result_year) - int(year))
                                        if year_diff <= 1:
                                            movie_id = result['id']
                                            matched_result = result
                                            logger.info(f"Ô£à [TMDB] Matched '{result_title}' ({result_year}) - Year validated (diff: {year_diff})")
                                            break
                                    except (ValueError, TypeError):
                                        continue
                            else:
                                # No year provided, take first result
                                movie_id = result['id']
                                matched_result = result
                                logger.warning(f"ÔÜá´©Å [TMDB] No year provided, using first result: '{result_title}' ({result_year or 'Unknown'})")
                                break
                        
                        # If we found a match, stop trying variants
                        if movie_id:
                            if i > 0:
                                logger.info(f"Ô£à [TMDB] Found movie using variant #{i+1}: '{variant['query']}'")
                            break
                
                # Use fallback if no exact year match found
                if not movie_id and fallback_result:
                    movie_id = fallback_result['id']
                    matched_result = fallback_result
                    result_year = fallback_result.get('release_date', '')[:4] if fallback_result.get('release_date') else 'Unknown'
                    result_title = fallback_result.get('title', 'Unknown')
                    logger.warning(f"ÔÜá´©Å [TMDB] No exact year match for '{title}' ({year}). Using best guess: '{result_title}' ({result_year})")
                
                # Ô£à PHASE 2: Cache the result
                if matched_result:
                    cache_tmdb_result(title, year, matched_result)

        
        if not movie_id:
            logger.warning(f"ÔÜá´©Å  [TMDB] No results found for '{title}' ({year})")
            return None
        
        # 2. Get full details (localized for metadata)
        details_url = f"https://api.themoviedb.org/3/movie/{movie_id}"
        details_res = requests.get(details_url, params={"api_key": api_key, "language": get_language()}, timeout=5)
        details = details_res.json()
        
        # Ô£à FIX: Fetch without language to get original poster (not localized)
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
        country_code = production_countries[0].get('iso_3166_1') if production_countries else None
        # Get watch providers
        watch_providers = []
        try:
            providers_url = f"https://api.themoviedb.org/3/movie/{movie_id}/watch/providers"
            providers_res = requests.get(providers_url, params={"api_key": api_key}, timeout=5)
            if providers_res.status_code == 200:
                p_results = providers_res.json().get('results', {})
                current_lang = get_language()
                pref_country = current_lang.split('-')[-1].upper() if '-' in current_lang else 'ES'
                country_data = p_results.get(pref_country) or p_results.get('ES') or p_results.get('US') or (next(iter(p_results.values())) if p_results else {})
                seen_provs = set()
                for p_type in ['flatrate', 'rent', 'buy']:
                    for prov in country_data.get(p_type, []):
                        p_name = prov.get('provider_name')
                        if p_name and p_name not in seen_provs:
                            seen_provs.add(p_name)
                            logo_path = prov.get('logo_path')
                            local_logo = get_provider_local_logo(p_name, logo_path)
                            watch_providers.append({
                                'name': p_name,
                                'logo_url': local_logo,
                                'type': p_type
                            })
        except Exception as e:
            logger.warning(f"ÔÜá´©Å [TMDB] Failed to fetch watch providers for ID {movie_id}: {e}")

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
            'country_code': country_code,  # Add country code for flag display
            'watch_providers': json.dumps(watch_providers)
        }
        
    except Exception as e:
        logger.error(f"ÔØî [TMDB] API error for '{title}' ({year}): {e}")
        return None

def get_provider_local_logo(p_name, logo_path=None):
    """
    Returns relative path to local SVG/PNG provider logo.
    Skips external URL issues in Home Assistant Ingress.
    """
    if not p_name:
        return None

    name_lower = p_name.lower()
    if 'netflix' in name_lower or 'nf' == name_lower:
        return 'providers/netflix.svg'
    elif 'amazon' in name_lower or 'prime' in name_lower or 'amzn' in name_lower:
        return 'providers/prime.svg'
    elif 'hbo' in name_lower or 'max' in name_lower or 'hmax' in name_lower:
        return 'providers/hbo.svg'
    elif 'disney' in name_lower or 'dsnp' in name_lower:
        return 'providers/disney.svg'
    elif 'apple' in name_lower:
        return 'providers/appletv.svg'
    elif 'sky' in name_lower or 'showtime' in name_lower:
        return 'providers/skyshowtime.svg'
    elif 'movistar' in name_lower:
        return 'providers/movistar.svg'
    elif 'filmin' in name_lower:
        return 'providers/filmin.svg'

    # Download remote TMDB logo locally if provided
    if logo_path:
        try:
            filename = f"prov_{abs(hash(p_name))}.png"
            remote_url = f"https://image.tmdb.org/t/p/w92{logo_path}" if logo_path.startswith('/') else logo_path
            save_dir = os.path.join(STATIC_DIR, 'posters')
            os.makedirs(save_dir, exist_ok=True)
            save_path = os.path.join(save_dir, filename)
            if not os.path.exists(save_path):
                res = requests.get(remote_url, timeout=5)
                if res.status_code == 200:
                    with open(save_path, 'wb') as f:
                        f.write(res.content)
            if os.path.exists(save_path):
                return f"posters/{filename}"
        except Exception as e:
            logger.warning(f"Failed downloading provider logo {p_name}: {e}")

    return None

def detect_source_info(torrent_name, watch_providers_json=None):
    """
    Analyzes torrent name and TMDB watch providers to return platform/source details with local logos.
    """
    providers = []
    if watch_providers_json:
        try:
            raw_provs = json.loads(watch_providers_json) if isinstance(watch_providers_json, str) else watch_providers_json
            for p in raw_provs:
                p_name = p.get('name') if isinstance(p, dict) else str(p)
                p_logo = p.get('logo_url') if isinstance(p, dict) else None
                local_logo = get_provider_local_logo(p_name, p_logo)
                providers.append({'name': p_name, 'logo_url': local_logo})
        except Exception:
            providers = []

    source_tag = None
    if torrent_name:
        upper_name = torrent_name.upper()
        if any(tag in upper_name for tag in ['CAM', 'CAMRIP', 'TELESYNC', 'TS', 'HDCAM']):
            source_tag = 'Cine'
        elif any(tag in upper_name for tag in ['WEB-DL', 'WEBRIP', 'WEB']):
            source_tag = 'WEB-DL'
        elif 'BLURAY' in upper_name or 'BDRIP' in upper_name:
            source_tag = 'BluRay'

        # Fallback platform logos from torrent tags if watch_providers is empty
        if not providers:
            if 'NF' in upper_name or 'NETFLIX' in upper_name:
                providers.append({'name': 'Netflix', 'logo_url': 'providers/netflix.svg'})
            elif 'HMAX' in upper_name or 'HBO' in upper_name or 'MAX' in upper_name:
                providers.append({'name': 'HBO Max', 'logo_url': 'providers/hbo.svg'})
            elif 'AMZN' in upper_name or 'PRIME' in upper_name:
                providers.append({'name': 'Amazon Prime Video', 'logo_url': 'providers/prime.svg'})
            elif 'DSNP' in upper_name or 'DISNEY' in upper_name:
                providers.append({'name': 'Disney+', 'logo_url': 'providers/disney.svg'})

    # Default to Cine if no streaming provider found
    if not providers:
        providers.append({'name': 'Cine', 'logo_url': 'providers/cine.svg'})

    return {
        'watch_providers': providers,
        'source_tag': source_tag
    }

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
    logger.info("­ƒÆ¥ [DB] DATABASE SYNC STARTED")
    logger.info("=" * 80)
    
    logger.info(f"­ƒÆ¥ [DB] Processing {len(torrents)} torrent(s)")
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
            # 1. Normal: 'downloading' ÔåÆ 'pending/uploading/completed' (slow downloads)
            # 2. Fast: 'new' ÔåÆ 'pending/uploading/completed' (very fast downloads that skip 'downloading' state)
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
                    send_telegram_notification(f"Ô£à <b>Download Complete</b>\n\n­ƒÄ¼ {movie.title} ({movie.year})\n­ƒÆ¥ Ready to move.")

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
                            watch_providers=metadata.get('watch_providers'),
                            metadata_updated_at=datetime.now(),
                            torrent_name=t['name']
                        )
                        
                        # Notify Telegram: New Movie Found
                        settings = load_settings()
                        if settings.get('telegram_notify_on_new_movie', True):
                            send_telegram_notification(f"­ƒåò <b>New Movie Found</b>\n\n­ƒÄ¼ {metadata.get('title', title)} ({metadata.get('year', year)})\n­ƒôÑ Added to Dashboard.")

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
        # Auto-enrich movies with missing metadata/posters in background
    if api_key:
        threading.Thread(target=enrich_missing_metadata_background, args=(api_key,), daemon=True).start()

    trigger_movies_update_callback()

def enrich_missing_metadata_background(api_key):
    """
    Scans database for movies missing TMDB metadata/posters and updates them in background.
    """
    try:
        missing_movies = list(Movie.select().where(
            (Movie.ignored == False) & 
            ((Movie.poster_path.is_null()) | (Movie.overview.is_null()) | (Movie.tmdb_id.is_null()))
        ))
        if not missing_movies:
            return

        logger.info(f"­ƒöä [TMDB AUTO-ENRICH] Found {len(missing_movies)} movie(s) with missing metadata/posters. Starting background enrichment...")
        updated_any = False

        for m in missing_movies:
            try:
                search_title = m.title
                search_year = m.year
                if m.torrent_name:
                    cleaned_title, cleaned_year = clean_torrent_name(m.torrent_name)
                    if cleaned_title:
                        search_title = cleaned_title
                    if cleaned_year:
                        search_year = cleaned_year

                metadata = fetch_complete_movie_metadata(search_title, search_year, api_key, tmdb_id=m.tmdb_id)
                if metadata:
                    poster_local = m.poster_path
                    backdrop_local = m.backdrop_path

                    p_file = os.path.join(POSTERS_DIR, f"{m.torrent_hash}_poster.jpg")
                    b_file = os.path.join(POSTERS_DIR, f"{m.torrent_hash}_backdrop.jpg")

                    if metadata.get('poster_path') and (not poster_local or not (os.path.exists(p_file) and os.path.getsize(p_file) > 100)):
                        poster_url = f"https://image.tmdb.org/t/p/w500{metadata.get('poster_path')}"
                        poster_local = download_image(poster_url, f"{m.torrent_hash}_poster.jpg", force=True)

                    if metadata.get('backdrop_path') and (not backdrop_local or not (os.path.exists(b_file) and os.path.getsize(b_file) > 100)):
                        backdrop_url = f"https://image.tmdb.org/t/p/w1280{metadata.get('backdrop_path')}"
                        backdrop_local = download_image(backdrop_url, f"{m.torrent_hash}_backdrop.jpg", force=True)

                    m.title = metadata.get('title', m.title)
                    m.year = metadata.get('year', m.year)
                    m.poster_path = poster_local
                    m.backdrop_path = backdrop_local
                    m.overview = metadata.get('overview')
                    m.runtime = metadata.get('runtime')
                    m.genres = metadata.get('genres')
                    m.cast = metadata.get('cast')
                    m.crew = metadata.get('crew')
                    m.vote_average = metadata.get('vote_average')
                    m.vote_count = metadata.get('vote_count')
                    m.imdb_id = metadata.get('imdb_id')
                    m.imdb_rating = metadata.get('imdb_rating')
                    m.imdb_votes = metadata.get('imdb_votes')
                    m.tmdb_id = metadata.get('tmdb_id') or m.tmdb_id
                    m.country_code = metadata.get('country_code')
                    m.watch_providers = metadata.get('watch_providers')
                    m.metadata_updated_at = datetime.now()
                    m.save()
                    updated_any = True
                    logger.info(f"✅ [TMDB AUTO-ENRICH] Successfully updated '{m.title}' ({m.year})")
            except Exception as e:
                logger.warning(f"⚠️ [TMDB AUTO-ENRICH] Failed for '{m.title}': {e}")

        if updated_any:
            trigger_movies_update_callback()
    except Exception as e:
        logger.error(f"❌ [TMDB AUTO-ENRICH] Background thread error: {e}")

def heal_movie_images_background(torrent_hash, api_key):
    """
    Auto-heals missing poster and backdrop for a movie using TMDB ID or title/year.
    Downloads images to POSTERS_DIR, updates DB, and notifies UI via WebSocket.
    """
    if not api_key or not torrent_hash:
        return
    try:
        from database import Movie
        movie = Movie.get_or_none(Movie.torrent_hash == torrent_hash)
        if not movie:
            return

        poster_file = f"{torrent_hash}_poster.jpg"
        backdrop_file = f"{torrent_hash}_backdrop.jpg"

        poster_full_path = os.path.join(POSTERS_DIR, poster_file)
        backdrop_full_path = os.path.join(POSTERS_DIR, backdrop_file)

        poster_needed = not (os.path.exists(poster_full_path) and os.path.getsize(poster_full_path) > 100)
        backdrop_needed = not (os.path.exists(backdrop_full_path) and os.path.getsize(backdrop_full_path) > 100)

        if not poster_needed and not backdrop_needed:
            return

        tmdb_data = None
        # 1. Try exact TMDB ID first
        if movie.tmdb_id:
            try:
                url = f"https://api.themoviedb.org/3/movie/{movie.tmdb_id}"
                res = requests.get(url, params={"api_key": api_key, "language": get_language()}, timeout=5)
                if res.status_code == 200:
                    tmdb_data = res.json()
            except Exception as e:
                logger.warning(f"Failed fetching TMDB ID {movie.tmdb_id} for healing: {e}")

        # 2. Try title/year search if no TMDB ID or fetch failed
        if not tmdb_data and movie.title:
            try:
                tmdb_data = fetch_complete_movie_metadata(movie.title, movie.year, api_key, images_only=True)
            except Exception as e:
                logger.warning(f"Failed searching TMDB for healing '{movie.title}': {e}")

        if tmdb_data:
            updated = False
            if poster_needed and tmdb_data.get('poster_path'):
                p_url = f"https://image.tmdb.org/t/p/w500{tmdb_data.get('poster_path')}"
                downloaded_poster = download_image(p_url, poster_file, force=True)
                if downloaded_poster:
                    movie.poster_path = downloaded_poster
                    updated = True

            if backdrop_needed and tmdb_data.get('backdrop_path'):
                b_url = f"https://image.tmdb.org/t/p/w1280{tmdb_data.get('backdrop_path')}"
                downloaded_backdrop = download_image(b_url, backdrop_file, force=True)
                if downloaded_backdrop:
                    movie.backdrop_path = downloaded_backdrop
                    updated = True

            if not movie.tmdb_id and tmdb_data.get('id'):
                movie.tmdb_id = tmdb_data.get('id')
                updated = True

            if updated:
                movie.metadata_updated_at = datetime.now()
                movie.save()
                logger.info(f"✅ Auto-healed images for '{movie.title}'")
                trigger_movies_update_callback()
    except Exception as e:
        logger.error(f"Error in heal_movie_images_background for {torrent_hash}: {e}")

def re_download_poster_background(title, year, torrent_hash, api_key):
    """Backwards-compatible alias for heal_movie_images_background"""
    heal_movie_images_background(torrent_hash, api_key)

from .client import get_torrent_client_status, get_qb_client

def get_movie_data(torrents, api_key):
    """
    Returns list of movies from the Database AND list of ignored series.
    Triggers a sync first.
    """
    # Trigger sync
    sync_movies(torrents, api_key)
    
    # Return all movies from DB (excluding ignored)
    movies = []
    
    for m in Movie.select().where((Movie.ignored == False) & ((Movie.watchlist == False) | (Movie.watchlist.is_null()))).order_by(Movie.added_at.desc()):
        poster_display = 'posters/placeholder_unidentified.png'
        poster_missing = True
        if m.poster_path:
            poster_filename = os.path.basename(m.poster_path)
            poster_full_path = os.path.join(POSTERS_DIR, poster_filename)
            if os.path.exists(poster_full_path) and os.path.getsize(poster_full_path) > 100:
                poster_display = f"posters/{poster_filename}"
                poster_missing = False
        
        backdrop_display = None
        backdrop_missing = True
        if m.backdrop_path:
            backdrop_filename = os.path.basename(m.backdrop_path)
            backdrop_full_path = os.path.join(POSTERS_DIR, backdrop_filename)
            if os.path.exists(backdrop_full_path) and os.path.getsize(backdrop_full_path) > 100:
                backdrop_display = f"posters/{backdrop_filename}"
                backdrop_missing = False
        
        # If either image is missing on disk, auto-heal in background
        if (poster_missing or backdrop_missing) and api_key and (m.tmdb_id or m.title):
            threading.Thread(
                target=heal_movie_images_background,
                args=(m.torrent_hash, api_key),
                daemon=True
            ).start()
        
        movies.append({
            "title": m.title,
            "year": m.year,
            "poster_url": poster_display,
            "backdrop_url": backdrop_display,
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
            
    return {"movies": movies, "ignored_series": ignored_series, "client_status": get_torrent_client_status()}

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
        
        # Ô£à FIX: Also fetch without language to get original poster (not localized)
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
            logger.info(f"­ƒû╝´©Å [IDENTIFY] Using original poster: {details.get('poster_path')}")
        
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
        movie.tmdb_id = tmdb_id  # Ô£à FIX: Save TMDB ID
        
        # Update Images - force re-download with new TMDB data
        logger.info(f"­ƒû╝´©Å [IDENTIFY] Downloading new images for '{movie.title}' from TMDB ID {tmdb_id}")
        if details.get('poster_path'):
            poster_url = f"https://image.tmdb.org/t/p/w500{details.get('poster_path')}"
            logger.info(f"­ƒû╝´©Å [IDENTIFY] Poster URL: {poster_url}")
            movie.poster_path = download_image(poster_url, f"{torrent_hash}_poster.jpg", force=True)
            logger.info(f"­ƒû╝´©Å [IDENTIFY] Poster saved to: {movie.poster_path}")
            
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
        base_dir = STATIC_DIR
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
            
            # Validate image paths - ensure they exist on disk, heal if missing
            poster_url = None
            backdrop_url = None
            
            poster_file = os.path.basename(movie.poster_path) if movie.poster_path else f"{torrent_hash}_poster.jpg"
            poster_full_path = os.path.join(POSTERS_DIR, poster_file)
            
            backdrop_file = os.path.basename(movie.backdrop_path) if movie.backdrop_path else f"{torrent_hash}_backdrop.jpg"
            backdrop_full_path = os.path.join(POSTERS_DIR, backdrop_file)
            
            if os.path.exists(poster_full_path) and os.path.getsize(poster_full_path) > 100:
                poster_url = f"posters/{poster_file}"
                
            if os.path.exists(backdrop_full_path) and os.path.getsize(backdrop_full_path) > 100:
                backdrop_url = f"posters/{backdrop_file}"
                
            # If poster or backdrop is missing on disk, resolve from TMDB immediately!
            if (not poster_url or not backdrop_url) and api_key:
                logger.warning(f"Images missing on disk for '{movie.title}', resolving from TMDB...")
                try:
                    tmdb_data = None
                    if movie.tmdb_id:
                        url = f"https://api.themoviedb.org/3/movie/{movie.tmdb_id}"
                        res = requests.get(url, params={"api_key": api_key, "language": get_language()}, timeout=5)
                        if res.status_code == 200:
                            tmdb_data = res.json()
                    
                    if not tmdb_data and movie.title:
                        tmdb_data = fetch_complete_movie_metadata(movie.title, movie.year, api_key, images_only=True)
                    
                    if tmdb_data:
                        if not poster_url and tmdb_data.get('poster_path'):
                            remote_poster = f"https://image.tmdb.org/t/p/w500{tmdb_data.get('poster_path')}"
                            poster_url = remote_poster
                            threading.Thread(
                                target=download_image_background,
                                args=(remote_poster, poster_file, movie.id, True),
                                daemon=True
                            ).start()
                            
                        if not backdrop_url and tmdb_data.get('backdrop_path'):
                            remote_backdrop = f"https://image.tmdb.org/t/p/w1280{tmdb_data.get('backdrop_path')}"
                            backdrop_url = remote_backdrop
                            threading.Thread(
                                target=download_image_background,
                                args=(remote_backdrop, backdrop_file, movie.id, False),
                                daemon=True
                            ).start()
                except Exception as e:
                    logger.error(f"Error resolving missing images from TMDB for {movie.title}: {e}")
                    
            if not poster_url:
                poster_url = 'posters/placeholder_unidentified.png'
                
            if not backdrop_url and poster_url and not 'placeholder' in poster_url:
                backdrop_url = poster_url
            
            watch_prov_raw = movie.watch_providers if hasattr(movie, 'watch_providers') else None
            source_info = detect_source_info(movie.torrent_name or name, watch_prov_raw)

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
                "watch_providers": source_info['watch_providers'],
                "source_tag": source_info['source_tag'],
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
                
                source_info = detect_source_info(name, metadata.get('watch_providers'))

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
                    "watch_providers": source_info['watch_providers'],
                    "source_tag": source_info['source_tag'],
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
                    movie.watch_providers = metadata.get('watch_providers')
                    movie.metadata_updated_at = datetime.now()
                    movie.save()
            else:
                # TMDB fetch failed - Movie not found
                logger.warning(f"ÔÜá´©Å  [TMDB] No results found for '{title}' ({year})")
                
                # Use placeholder image for unidentified movies
                placeholder_poster = 'posters/placeholder_unidentified.png'
                
                movie_details = {
                    "title": title,
                    "year": year,
                    "overview": "ÔÜá´©Å This movie could not be identified in TMDB. You can manually identify it using the 'Identify Manually' button.",
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
                            logger.info(f"DEBUG PATH CHECK - Ô£ô Path EXISTS: '{dest_path}'")
                            pass # Status remains moved
                        else:
                            receptor_enabled = settings.get('receptor_enabled', False)
                            if not receptor_enabled or (local_dest and os.path.exists(local_dest)):
                                logger.warning(f"DEBUG PATH CHECK - Ô£ù Path NOT FOUND: '{dest_path}' - Setting status to 'missing'")
                                status = 'missing'
                            else:
                                logger.info(f"DEBUG PATH CHECK - Ô£ù Path NOT FOUND: '{dest_path}', but local base dest '{local_dest}' does not exist (unmounted) and Receptor is enabled. Keeping moved/moved_manually status.")
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

def get_movie_titles_in_languages(tmdb_id, languages, api_key):
    """
    Obtiene t├¡tulos de una pel├¡cula en m├║ltiples idiomas desde TMDB.
    Args:
        tmdb_id: ID de TMDB de la pel├¡cula
        languages: Set/list de c├│digos de idioma (ej: ['es-ES', 'en-US'])
        api_key: TMDB API key
    Returns:
        Dict con t├¡tulos por idioma: {'es-ES': 'El Concursante', 'en-US': 'The Contestant'}
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
    
    # Usar cach├® para evitar consultas repetidas
    cache_key = f"{tmdb_id}_{'-'.join(sorted(languages))}"
    if cache_key in _TITLE_CACHE:
        logger.info(f"Using cached titles for TMDB ID {tmdb_id}")
        return _TITLE_CACHE[cache_key]
    
    titles = {}
    english_title = None
    
    try:
        # Ô£à ALWAYS fetch original title first (usually English)
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
                    
                    # Ô£à FIX: Check if title is usable for Latin-based language searches
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
                                logger.warning(f"ÔÜá´©Å TMDB returned non-Latin '{title}' for {lang}, using English fallback: '{english_title}'")
                            else:
                                logger.warning(f"ÔÜá´©Å No usable title for {lang} (got non-Latin: '{title}')")
                else:
                    logger.warning(f"Failed to fetch title for {lang}, status: {response.status_code}")
                    
            except Exception as e:
                logger.error(f"Error fetching title for language {lang}: {e}")
                continue
        
        # Guardar en cach├®
        if titles:
            _TITLE_CACHE[cache_key] = titles
            
        return titles
        
    except Exception as e:
        logger.error(f"Error in get_movie_titles_in_languages: {e}")
        return {}

