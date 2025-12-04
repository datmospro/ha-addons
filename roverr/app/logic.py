import os
import shutil
import time
import threading
import logging
import qbittorrentapi
import re
import json
import requests
import hashlib
from datetime import datetime
from database import MoveHistory

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s:%(name)s:%(message)s'
)
logger = logging.getLogger("PlexMover")

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
    "language": "es-ES"  # Default to Spanish for backwards compatibility
}

# Global State
COPY_PROGRESS = {} # {hash: {percent: float, speed: float, status: str}}
STOP_FLAGS = set() # Set of hashes to stop
RSS_LAST_FETCH = {} # {feed_url: timestamp} - Track last fetch time for each RSS feed

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
            
        res = requests.get(url, stream=True, timeout=10)
        if res.status_code == 200:
            with open(save_path, 'wb') as f:
                shutil.copyfileobj(res.raw, f)
            return f"posters/{filename}"
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
        logger.error(f"Error scraping IMDb: {e}")
    return None, None

def fetch_complete_movie_metadata(title, year, api_key, images_only=False):
    """
    Fetches complete movie metadata from TMDB including cast, crew, and ratings.
    If images_only=True, skips credits, external_ids and IMDb scraping to be faster.
    Returns a dictionary with all metadata or None if not found.
    """
    try:
        # 1. Search for movie
        search_url = "https://api.themoviedb.org/3/search/movie"
        params = {"api_key": api_key, "query": title, "language": get_language(), "year": year}
        res = requests.get(search_url, params=params, timeout=5)
        search_data = res.json()
        
        if not search_data.get('results'):
            return None
            
        result = search_data['results'][0]
        movie_id = result['id']
        
        # 2. Get full details
        details_url = f"https://api.themoviedb.org/3/movie/{movie_id}"
        details_res = requests.get(details_url, params={"api_key": api_key, "language": get_language()}, timeout=5)
        details = details_res.json()
        
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
            'tmdb_id': movie_id  # Add TMDB ID for multi-language search
        }
        
    except Exception as e:
        logger.error(f"Error fetching complete metadata for {title}: {e}")
        return None


def sync_movies(torrents, api_key):
    """
    Syncs active torrents with the Movie database.
    - Adds new movies (fetches TMDB, downloads images).
    - Updates status/progress for existing movies.
    - Does NOT delete movies if torrent is missing (independent dashboard).
    """
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
                                     folder_name = f"{title} ({year})"
                                     dest_path = os.path.join(local_dest, folder_name)
                                     
                                     if os.path.exists(dest_path):
                                         movie.status = 'moved' if history.status == 'success' else 'moved_manually'
                                     else:
                                         movie.status = 'missing'
                                 else:
                                     movie.status = 'moved' if history.status == 'success' else 'moved_manually'
                             else:
                                 movie.status = 'moved' if history.status == 'success' else 'moved_manually'
                                 
                         elif history.status == 'error': movie.status = 'error'
                         elif history.status == 'skipped': movie.status = 'skipped'
                    else:
                        # 3. No history and not downloading -> Pending or Error
                        if state in ['uploading', 'pausedUP', 'queuedUP', 'stalledUP', 'completed', 'checkingUP', 'checkingDL']:
                            movie.status = 'pending'
                        elif state in ['error', 'missingFiles']:
                            movie.status = 'error'
                        else:
                            movie.status = 'pending' # Default fallback
            
            # Check for status change from downloading to pending (download completed)
            old_status = Movie.get_or_none(Movie.torrent_hash == t['hash']).status if movie.id else None
            
            movie.save()
            
            # AUTO-COPY: Trigger copy if download just completed and RSS feed has auto_copy enabled
            # Expanded to detect multiple final states (not just 'pending') for better reliability
            download_completed = (old_status == 'downloading' and 
                                movie.status in ['pending', 'uploading', 'completed', 'queuedUP', 'stalledUP'])
            
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
                            status='pending',
                            cast=metadata.get('cast'), # Already JSON string
                            crew=metadata.get('crew'), # Already JSON string
                            vote_average=metadata.get('vote_average'),
                            vote_count=metadata.get('vote_count'),
                            imdb_id=metadata.get('imdb_id'),
                            imdb_rating=metadata.get('imdb_rating'),
                            imdb_votes=metadata.get('imdb_votes'),
                            tmdb_id=metadata.get('tmdb_id'),  # Save TMDB ID for multi-language search
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
        
        movies.append({
            "title": m.title,
            "year": m.year,
            "poster_url": m.poster_path,
            "backdrop_url": m.backdrop_path,
            "overview": m.overview,
            "torrent_hash": m.torrent_hash,
            "status": m.status,
            "progress": m.progress,
            "state": m.state
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
        # Fetch complete details from TMDB
        url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
        params = {"api_key": api_key, "language": get_language()}
        res = requests.get(url, params=params, timeout=5)
        
        if res.status_code != 200:
            return False, "TMDB ID not found"
            
        details = res.json()
        
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
        movie.metadata_updated_at = datetime.now()
        
        # Update Images
        if details.get('poster_path'):
            poster_url = f"https://image.tmdb.org/t/p/w500{details.get('poster_path')}"
            movie.poster_path = download_image(poster_url, f"{torrent_hash}_poster.jpg", force=True)
            
        if details.get('backdrop_path'):
            backdrop_url = f"https://image.tmdb.org/t/p/w1280{details.get('backdrop_path')}"
            movie.backdrop_path = download_image(backdrop_url, f"{torrent_hash}_backdrop.jpg", force=True)
            
        movie.save()
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
        movie.save()
        logger.info(f"Successfully removed movie from dashboard (ignored): {movie_title}")
    else:
        # Hard delete from database
        movie.delete_instance()
        logger.info(f"Successfully deleted movie from database: {movie_title}")
        
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
                        "genres": json.loads(movie.genres) if movie.genres else []
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
                "imdb_votes": movie.imdb_votes
            }
        else:
            # No cache, fetch from TMDB
            logger.info(f"No cache found for {name}, fetching from TMDB")
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
                    "imdb_votes": metadata.get('imdb_votes')
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
                # Fallback if TMDB fetch fails
                title, year = clean_torrent_name(name)
                movie_details = {
                    "title": title,
                    "year": year,
                    "overview": "Movie not found in TMDB.",
                    "cast": [],
                    "crew": []
                }

        # Calculate Paths & Status (dynamic data from torrent client)
        content_path = t.content_path
        normalized_path = content_path.replace('\\', '/')
        item_name = os.path.basename(normalized_path.rstrip('/'))
        
        local_source = settings.get('local_source_path', '')
        local_dest = settings.get('local_dest_path', '')
        
        title = movie_details.get('title', clean_torrent_name(name)[0])
        year = movie_details.get('year', clean_torrent_name(name)[1])
        folder_name = f"{title} ({year})"
        dest_path = os.path.join(local_dest, folder_name)
        
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
                    if history.status == 'success' or history.status == 'manual':
                        status = 'moved' if history.status == 'success' else 'moved_manually'
                        
                        # Use the actual path from history if available
                        if history.dest_path:
                            dest_path = history.dest_path
                        
                        # Verify existence
                        if os.path.exists(dest_path):
                            pass # Status remains moved
                        else:
                            status = 'missing'
                    elif history.status == 'skipped': status = 'skipped'
                    elif history.status == 'error': status = 'error'
                else:
                    # 3. No history and not downloading -> Pending or Error
                    if state in ['uploading', 'pausedUP', 'queuedUP', 'stalledUP', 'completed', 'checkingUP', 'checkingDL']:
                        status = 'pending'
                    elif state in ['error', 'missingFiles']:
                        status = 'error'
            
            
        # Check if copying
        if torrent_hash in COPY_PROGRESS:
            status = 'copying'

        movie_details.update({
            "torrent_name": t.name,
            "torrent_hash": t.hash,
            "size": t.size,
            "state": t.state,
            "status": status,
            "source_path": content_path,
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
        
        return {
            'success': True,
            'tracker_count': tracker_count,
            'languages': sorted(list(languages)),
            'trackers': tracker_details
        }
        
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
    # Usar caché para evitar consultas repetidas
    cache_key = f"{tmdb_id}_{'-'.join(sorted(languages))}"
    if cache_key in _TITLE_CACHE:
        logger.info(f"Using cached titles for TMDB ID {tmdb_id}")
        return _TITLE_CACHE[cache_key]
    
    titles = {}
    
    try:
        for lang in languages:
            try:
                url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
                params = {"api_key": api_key, "language": lang}
                response = requests.get(url, params=params, timeout=5)
                
                if response.status_code == 200:
                    data = response.json()
                    title = data.get('title')
                    if title:
                        titles[lang] = title
                        logger.info(f"Fetched title for {lang}: '{title}'")
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
    logger.info("Starting torrent check...")
    
    try:
        qb = get_qb_client(settings)
        qb.auth_log_in()
    except Exception as e:
        logger.error(f"Failed to connect to torrent client: {e}")
        return

    # Get completed torrents
    torrents = qb.torrents_info(status_filter='completed')
    
    for torrent in torrents:
        # Check if already processed
        if MoveHistory.select().where(MoveHistory.torrent_name == torrent.name, MoveHistory.status == 'success').exists():
            continue

        process_single_torrent(qb, torrent, settings)

def get_active_torrents(config_ignored=None):
    settings = load_settings()
    try:
        qb = get_qb_client(settings)
        qb.auth_log_in()
        
        # Get all torrents
        torrents = qb.torrents_info()
        
        results = []
        for t in torrents:
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
                             folder_name = f"{title} ({year})"
                             dest_path = os.path.join(local_dest, folder_name)
                             
                             if not os.path.exists(dest_path):
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
    settings = load_settings()
    try:
        qb = get_qb_client(settings)
        qb.auth_log_in()
        
        torrents = qb.torrents_info(torrent_hashes=torrent_hash)
        if not torrents:
            return {"success": False, "message": "Torrent not found"}
            
        torrent = torrents[0]
        process_single_torrent(qb, torrent, settings)
        return {"success": True, "message": f"Started processing {torrent.name}"}
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
            logger.warning(f"Could not find {item_name} in {local_source}")
            MoveHistory.create(torrent_name=torrent.name, status='error', message=f"File not found in {local_source}", source_path="", dest_path="")
            return

    # 3. Parse Name (Movie vs Series) - Allow space before year to be optional
    match = re.search(r"(.+?)\s*\((\d{4})\)", item_name)
    if not match:
        logger.info(f"Skipping {torrent.name}: Does not match 'Title (Year)' pattern.")
        MoveHistory.create(torrent_name=torrent.name, status='skipped', message="Invalid name format", source_path=source_path, dest_path="")
        return

    title = match.group(1).strip()
    year = match.group(2).strip()
    folder_name = f"{title} ({year})"
    
    # Destination Path
    local_dest = settings.get('local_dest_path')
    if not local_dest:
        logger.error("No local_dest_path configured in settings.")
        return

    dest_dir = os.path.join(local_dest, folder_name)
    logger.info(f"Destination directory: {dest_dir}")
    
    try:
        os.makedirs(dest_dir, exist_ok=True)
        
        limit = settings.get('copy_speed_limit', 10)
        logger.info(f"Using copy speed limit: {limit} MB/s")
        
        # If it's a file
        if os.path.isfile(source_path):
            logger.info(f"Source is a file: {source_path}")
            ext = os.path.splitext(item_name)[1]
            new_name = f"{folder_name}{ext}"
            dest_file = os.path.join(dest_dir, new_name)
            
            if not os.path.exists(dest_file):
                logger.info(f"Copying {source_path} to {dest_file}")
                copy_with_progress(source_path, dest_file, torrent.hash, limit)
                MoveHistory.create(torrent_name=torrent.name, source_path=source_path, dest_path=dest_file, status='success')
                
                # Notify Telegram: Moved
                if settings.get('telegram_notify_on_move', True):
                    send_telegram_notification(f"🚀 <b>Movie Moved to Library</b>\n\n🎬 {title} ({year})\n📂 {dest_file}")

            else:
                logger.info(f"File already exists: {dest_file}")
                MoveHistory.create(torrent_name=torrent.name, status='skipped', message="Destination exists", source_path=source_path, dest_path=dest_file)
                
        # If it's a directory
        elif os.path.isdir(source_path):
            logger.info(f"Source is a directory: {source_path}")
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
                
                # Notify Telegram: Moved
                if settings.get('telegram_notify_on_move', True):
                    send_telegram_notification(f"🚀 <b>Movie Moved to Library</b>\n\n🎬 {title} ({year})\n📂 {dest_dir}")

            else:
                logger.warning(f"No video files found in {source_path}")
                MoveHistory.create(torrent_name=torrent.name, status='skipped', message="No video file found in folder", source_path=source_path, dest_path=dest_dir)
        else:
             logger.error(f"Source path is valid but neither file nor dir? {source_path}")
             MoveHistory.create(torrent_name=torrent.name, status='error', message="Invalid source type", source_path=source_path, dest_path="")

    except InterruptedError:
        logger.info(f"Copy cancelled for {torrent.name}")
        # History entry? Maybe not needed if cancelled.
    except Exception as e:
        logger.error(f"Error moving {torrent.name}: {e}")
        MoveHistory.create(torrent_name=torrent.name, status='error', message=str(e), source_path="", dest_path="")

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

def search_indexers(query, settings, tmdb_id=None):
    """
    Search all configured indexers for movies matching the query.
    If tmdb_id is provided, uses intelligent multi-language search.
    Returns a list of results with title, year, size, download URL, and indexer name.
    """
    import xml.etree.ElementTree as ET
    import re
    
    indexers = settings.get('indexers', [])
    if not indexers:
        logger.warning("No indexers configured")
        return []
    
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
                            
                            # Try to extract year from title (common formats: "Movie (2024)" or "Movie 2024")
                            year_match = re.search(r'\((\d{4})\)|\s(\d{4})(?:\s|$)', title_text)
                            if year_match:
                                year = year_match.group(1) or year_match.group(2)
                            
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
                    logger.error(f"Error searching {name} with variant '{variant}': {e}")
                    continue
                    
        except Exception as e:
            logger.error(f"Error searching indexer {name}: {e}")
            continue
    
    logger.info(f"Total search results: {len(all_results)}")
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
        
    # 2. Sort by Preferred Size
    if preferred_size_mb > 0:
        # Sort by absolute difference from preferred size
        valid_results.sort(key=lambda x: abs(x['size_mb'] - preferred_size_mb))
    else:
        # If no preference, stick to search result order (usually relevance/seeders)
        pass
        
    return valid_results[0]

def auto_download_movie(title, year, preferred_size, max_size, label=None, tmdb_id=None):
    """
    Searches for a movie and automatically downloads the best torrent.
    Args:
        label: Optional tag/label to apply to the torrent (e.g., RSS feed label)
        tmdb_id: Optional TMDB ID for intelligent multi-language search
    Returns (torrent_hash, torrent_name) if successful, (None, None) otherwise.
    """
    logger.info(f"Auto-downloading movie: {title} ({year})")
    
    settings = load_settings()
    
    # 1. Search (with intelligent multi-language if tmdb_id provided)
    query = f"{title} {year}" if year else title
    results = search_indexers(query, settings, tmdb_id=tmdb_id)
    
    if not results:
        logger.info(f"No search results found for: {query}")
        return None, None
        
    # 2. Select Best Torrent
    best_torrent = select_best_torrent(results, preferred_size, max_size)
    
    if not best_torrent:
        logger.info(f"No suitable torrent found for {title} within size limits (Max: {max_size}MB)")
        return None, None
        
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
            return selected['hash'], selected['name']
        
        # Fallback: If no new torrents detected after all retries, get the most recent torrent
        torrents_after = qb.torrents_info()
        if torrents_after:
            latest = sorted(torrents_after, key=lambda x: x.get('added_on', 0), reverse=True)[0]
            logger.warning(f"Could not detect new torrent after {max_retries} retries, using most recent: {latest['name']}")
            return latest['hash'], latest['name']
            
        logger.warning(f"Torrent added but could not find hash for: {best_torrent['title']}")
        return None, None
        
    except Exception as e:
        logger.error(f"Error adding torrent to download client: {e}")
        return None, None

def fetch_rss_movies(limit=30):
    """
    Fetches movies from all configured RSS feeds.
    - Deduplicates by title and year.
    - Sorts by publication date (newest first).
    - Adds new movies to DB with status 'rss_new'.
    - Returns list of added movies.
    """
    import feedparser
    
    settings = load_settings()
    rss_feeds = settings.get('rss_feeds', [])
    api_key = settings.get('tmdb_api_key')
    
    if not rss_feeds:
        return {"success": False, "message": "No RSS feeds configured"}
        
    # Create map for easy config lookup
    feed_map = {f.get('name'): f for f in rss_feeds}
        
    all_entries = []
    
    # 1. Fetch from all feeds
    for feed_config in rss_feeds:
        url = feed_config.get('url')
        if not url: continue
        
        try:
            logger.info(f"Fetching RSS: {url}")
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
            
            # First check if movie is ignored (skip completely - no RSS entry, no auto-download)
            ignored_query = Movie.select().where(Movie.title == title, Movie.ignored == True)
            if year:
                ignored_query = ignored_query.where(Movie.year == year)
            
            if ignored_query.exists():
                logger.info(f"Movie '{title}' ({year}) is in ignored list. Skipping RSS entry and auto-download.")
                continue
            
            # CHECK IF MOVIE IS IN WATCHLIST
            watchlist_query = Movie.select().where(Movie.title == title, Movie.watchlist == True)
            if year:
                watchlist_query = watchlist_query.where(Movie.year == year)
            
            watchlist_movie = watchlist_query.first()
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
            existing_query = Movie.select().where(
                Movie.title == title, 
                Movie.ignored == False,
                (Movie.watchlist == False) | (Movie.watchlist.is_null())
            )
            if year:
                existing_query = existing_query.where(Movie.year == year)
            
            existing_movie = existing_query.first()
            if existing_movie:
                logger.info(f"Movie '{title}' ({year}) already exists in dashboard with hash {existing_movie.torrent_hash[:8]}... Skipping duplicate RSS entry.")
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
                            logger.info(f"Movie '{title}' ({year}) already exists in torrent client. Adding to dashboard as RSS entry (no auto-download).")
                            torrent_exists = True
                            break
                    
                    if not torrent_exists:
                        # Torrent doesn't exist, proceed with auto-download
                        logger.info(f"Auto-download enabled for {title} from feed '{entry['feed_name']}' with label '{feed_label}'")
                        
                        # Get TMDB ID from entry for intelligent multi-language search
                        entry_tmdb_id = entry.get('tmdb_id')
                        if entry_tmdb_id:
                            logger.info(f"Using TMDB ID {entry_tmdb_id} for intelligent multi-language search")
                        
                        torrent_hash, torrent_name = auto_download_movie(
                            title, year, preferred_size, max_size, 
                            label=feed_label, 
                            tmdb_id=entry_tmdb_id
                        )
                        if torrent_hash:
                            logger.info(f"Successfully auto-downloaded {title} from RSS. Adding to DB with real hash.")
                            
                            # Fetch Metadata (same as non-auto-download path)
                            metadata = None
                            if api_key:
                                metadata = fetch_complete_movie_metadata(title, year, api_key)
                            
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
                                    metadata_updated_at=datetime.now(),
                                    torrent_name=torrent_name
                                )
                                logger.info(f"Created DB entry for auto-downloaded movie: {title} ({year})")
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
                                        existing_movie.metadata_updated_at = datetime.now()
                                        existing_movie.torrent_name = torrent_name
                                        
                                        # Keep the current status since sync_movies determines it based on torrent state
                                        
                                        existing_movie.save()
                                        logger.info(f"Successfully updated existing movie '{title}' ({year}) with RSS metadata")
                                        
                                    except Exception as update_error:
                                        logger.error(f"Failed to update existing movie '{title}' with RSS metadata: {update_error}")
                                else:
                                    logger.error(f"Error creating DB entry for '{title}': {create_error}")
                            
                            added_count += 1
                            continue  # Skip the normal RSS entry creation path
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
            
            # Create DB Entry
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
                cast=metadata.get('cast') if metadata else None,
                crew=metadata.get('crew') if metadata else None,
                vote_average=metadata.get('vote_average') if metadata else 0,
                vote_count=metadata.get('vote_count') if metadata else 0,
                imdb_id=metadata.get('imdb_id') if metadata else None,
                imdb_rating=metadata.get('imdb_rating') if metadata else None,
                imdb_votes=metadata.get('imdb_votes') if metadata else None,
                metadata_updated_at=datetime.now(),
                torrent_name=entry['title'] # Store original title
            )
            
            added_count += 1
            added_movies.append(entry['title'])
            
        except Exception as e:
            logger.error(f"Error adding RSS movie {entry['title']}: {e}")
            
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

