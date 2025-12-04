import json
import asyncio
import logging
from fastapi import FastAPI, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from database import init_db, MoveHistory
from logic import process_torrents, get_active_torrents, manual_move, mark_as_moved, load_settings, save_settings, get_copy_progress, stop_copy, get_movie_data

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Main")

# Scheduler
async def scheduler():
    while True:
        settings = load_settings()
        interval = settings.get('poll_interval', 5) * 60
        
        # Check if scheduler is enabled
        if settings.get('enable_scheduler', False) and interval > 0:
            logger.info("Running scheduled check...")
            try:
                process_torrents(None)
            except Exception as e:
                logger.error(f"Error in scheduler: {e}")
        else:
            # logger.info("Scheduler disabled.") # Too verbose for loop
            pass
        
        await asyncio.sleep(max(60, interval)) # Sleep at least 60s

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    asyncio.create_task(scheduler())
    
    # Import and start RSS scheduler
    from logic import rss_scheduler
    asyncio.create_task(rss_scheduler())
    
    yield
    # Shutdown

app = FastAPI(lifespan=lifespan)

# API Endpoints
@app.get("/api/history")
def get_history():
    query = MoveHistory.select().order_by(MoveHistory.timestamp.desc()).limit(50)
    return list(query.dicts())

@app.post("/api/trigger")
def trigger_check(background_tasks: BackgroundTasks):
    background_tasks.add_task(process_torrents, None)
    return {"status": "triggered"}

@app.get("/api/torrents")
def api_get_torrents():
    torrents = get_active_torrents(None)
    progress_data = get_copy_progress()
    
    # Merge progress data
    for t in torrents:
        if t['hash'] in progress_data:
            prog = progress_data[t['hash']]
            t['copy_progress'] = prog
            # Override status if copying
            if prog['status'] == 'copying':
                t['status'] = 'copying'
            
    return torrents

@app.get("/api/settings")
def get_settings():
    return load_settings()

@app.post("/api/settings")
def update_settings(settings: dict):
    save_settings(settings)
    return {"success": True, "message": "Settings saved"}

@app.get("/api/indexer/stats/{indexer_id}")
def get_indexer_stats(indexer_id: int):
    """Get statistics from Prowlarr indexer (tracker count and languages)"""
    from logic import get_prowlarr_stats
    
    try:
        settings = load_settings()
        indexers = settings.get('indexers', [])
        
        if indexer_id >= len(indexers):
            return {"success": False, "message": "Indexer not found"}
        
        indexer = indexers[indexer_id]
        stats = get_prowlarr_stats(indexer)
        
        return stats
        
    except Exception as e:
        logger.error(f"Error getting indexer stats: {e}")
        return {"success": False, "message": str(e)}


@app.get("/api/movies")
def get_movies():
    settings = load_settings()
    api_key = settings.get('tmdb_api_key')
    if not api_key:
        return {"movies": [], "ignored_series": []}
    
    torrents = get_active_torrents(None)
    from logic import get_movie_data # Import here to avoid circular dependency if any
    data = get_movie_data(torrents, api_key)
    return data

@app.post("/api/movie/{torrent_hash}/identify")
def identify_movie_endpoint(torrent_hash: str, payload: dict):
    settings = load_settings()
    api_key = settings.get('tmdb_api_key')
    tmdb_id = payload.get('tmdb_id')
    
    if not api_key or not tmdb_id:
        return {"success": False, "message": "Missing API Key or TMDB ID"}
        
    from logic import identify_movie
    success, message = identify_movie(torrent_hash, tmdb_id, api_key)
    return {"success": success, "message": message}

@app.get("/api/movie/{torrent_hash}")
def get_movie_details_endpoint(torrent_hash: str):
    settings = load_settings()
    api_key = settings.get('tmdb_api_key')
    if not api_key:
        return {"error": "No API Key"}
        
    from logic import get_movie_details, get_copy_progress
    details = get_movie_details(torrent_hash, api_key)
    if not details:
        return {"error": "Movie not found"}
        
    # Inject Copy Progress
    progress_data = get_copy_progress()
    if torrent_hash in progress_data:
        prog = progress_data[torrent_hash]
        details['copy_progress'] = prog
        if prog['status'] == 'copying':
            details['status'] = 'copying'
            
    return details

@app.post("/api/move/{torrent_hash}")
def move_torrent_endpoint(torrent_hash: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(manual_move, torrent_hash)
    return {"status": "started", "message": "Move started in background"}

@app.post("/api/mark/{torrent_hash}")
def mark_moved_endpoint(torrent_hash: str):
    result = mark_as_moved(torrent_hash)
    return result

@app.delete("/api/movie/{torrent_hash}")
def delete_movie_endpoint(torrent_hash: str):
    from logic import delete_movie
    success = delete_movie(torrent_hash)
    if success:
        return {"success": True, "message": "Movie deleted"}
    return {"success": False, "message": "Movie not found"}

@app.post("/api/stop/{torrent_hash}")
def stop_copy_endpoint(torrent_hash: str):
    success = stop_copy(torrent_hash)
    if success:
        return {"success": True, "message": "Stop signal sent"}
    return {"success": False, "message": "Could not stop copy (maybe not running?)"}

@app.post("/api/movies/batch-delete")
def batch_delete_movies(payload: dict):
    """Delete multiple movies from DB and/or delete files from destination"""
    from logic import delete_movie, get_qb_client, add_to_watchlist
    from database import Movie, MoveHistory
    import os
    import shutil
    
    torrent_hashes = payload.get('torrent_hashes', [])
    delete_from_db = payload.get('delete_from_db', False)
    delete_from_destination = payload.get('delete_from_destination', False)
    ignore_movie = payload.get('ignore_movie', True)
    watchlist_movie = payload.get('watchlist_movie', False)
    watchlist_days = payload.get('watchlist_days', 7)
    
    # If watchlist is selected, handle it and return early
    if watchlist_movie:
        added_to_watchlist = 0
        errors = []
        
        for hash in torrent_hashes:
            try:
                if add_to_watchlist(hash, watchlist_days):
                    added_to_watchlist += 1
                else:
                    errors.append(f"{hash}: Failed to add to watchlist")
            except Exception as e:
                errors.append(f"{hash}: {str(e)}")
        
        message = f"Added {added_to_watchlist} movie(s) to watchlist for {watchlist_days} days"
        if errors:
            message += f". Errors: {'; '.join(errors)}"
        
        return {
            "success": True,
            "message": message,
            "added_to_watchlist": added_to_watchlist
        }
    
    deleted_from_db = 0
    deleted_from_folder = 0
    errors = []
    settings = load_settings()
    dest_path = settings.get('local_dest_path', '')
    
    # Pre-fetch active torrents to map hash -> name (to find history)
    hash_to_name = {}
    if delete_from_destination:
        try:
            qb = get_qb_client(settings)
            qb.auth_log_in()
            torrents = qb.torrents_info(torrent_hashes=torrent_hashes)
            for t in torrents:
                hash_to_name[t.hash.lower()] = t.name
        except Exception as e:
            logger.error(f"Error fetching torrents for delete mapping: {e}")

    for hash in torrent_hashes:
        try:
            # Get movie from database
            movie = None
            try:
                movie = Movie.get(Movie.torrent_hash == hash)
            except:
                pass
            
            # Delete from destination folder if requested
            if delete_from_destination and dest_path:
                target_path = None
                
                # 1. Try to find path from History (Most accurate)
                torrent_name = hash_to_name.get(hash.lower())
                if torrent_name:
                    history = MoveHistory.select().where(
                        MoveHistory.torrent_name == torrent_name, 
                        MoveHistory.status == 'success'
                    ).order_by(MoveHistory.timestamp.desc()).first()
                    
                    if history and history.dest_path:
                        target_path = history.dest_path
                
                # 2. Fallback: Construct from Movie Title (if history missing)
                if not target_path and movie:
                    folder_name = movie.title
                    if movie.year:
                        folder_name = f"{movie.title} ({movie.year})"
                    target_path = os.path.join(dest_path, folder_name)
                
                # Execute Delete
                if target_path and os.path.exists(target_path):
                    try:
                        # Check if we should delete the parent folder (Safety Check)
                        # User wants to delete the folder ONLY if it has the same name as the file
                        if os.path.isfile(target_path):
                            parent_dir = os.path.dirname(target_path)
                            file_name = os.path.splitext(os.path.basename(target_path))[0]
                            folder_name = os.path.basename(parent_dir)
                            
                            if file_name == folder_name:
                                logger.info(f"Promoting delete target to parent folder: {parent_dir}")
                                target_path = parent_dir
                        
                        if os.path.isdir(target_path):
                            shutil.rmtree(target_path)
                        else:
                            os.remove(target_path)
                        deleted_from_folder += 1
                        logger.info(f"Deleted files at: {target_path}")
                    except Exception as e:
                        errors.append(f"{hash}: Failed to delete {target_path} - {str(e)}")
                else:
                    # Only report error if we expected to find it (i.e. we had a path)
                    if target_path:
                        logger.warning(f"Target path not found for deletion: {target_path}")
            
            # Delete from database if requested
            if delete_from_db:
                if delete_movie(hash, ignore_movie=ignore_movie):
                    deleted_from_db += 1
                    
        except Exception as e:
            errors.append(f"{hash}: {str(e)}")
    
    return {
        "success": True,
        "deleted_from_db": deleted_from_db,
        "deleted_from_folder": deleted_from_folder,
        "errors": errors
    }

@app.post("/api/movies/batch-copy")
def batch_copy_movies(payload: dict, background_tasks: BackgroundTasks):
    """Trigger copy for multiple movies (excluding Error and Orphaned)"""
    from logic import manual_move
    from database import Movie
    
    torrent_hashes = payload.get('torrent_hashes', [])
    copied = 0
    skipped = 0
    errors = []
    
    for hash in torrent_hashes:
        try:
            # Get movie from database
            try:
                movie = Movie.get(Movie.torrent_hash == hash)
                status = movie.status
            except:
                skipped += 1
                continue
            
            # Skip error states: error, orphaned
            if status in ['error', 'orphaned']:
                skipped += 1
                continue
            
            # Trigger copy via background task
            background_tasks.add_task(manual_move, hash)
            copied += 1
                
        except Exception as e:
            errors.append(f"{hash}: {str(e)}")
    
    return {
        "success": True,
        "copied": copied,
        "skipped": skipped,
        "errors": errors
    }

@app.post("/api/test_indexer")
def test_indexer(payload: dict):
    from logic import test_indexer_connection
    
    url = payload.get('url')
    api_key = payload.get('api_key')
    
    if not url or not api_key:
        return {"success": False, "message": "Missing URL or API Key"}
        
    success, message = test_indexer_connection(url, api_key)
    return {"success": success, "message": message}

@app.post("/api/test_telegram")
def test_telegram(payload: dict):
    from logic import test_telegram_connection
    
    token = payload.get('token')
    chat_id = payload.get('chat_id')
    
    if not token or not chat_id:
        return {"success": False, "message": "Missing Token or Chat ID"}
        
    success, message = test_telegram_connection(token, chat_id)
    return {"success": success, "message": message}

@app.get("/api/search_tmdb")
def search_tmdb(q: str):
    """Search TMDB for movies"""
    from logic import load_settings, get_language
    import requests
    
    if not q or len(q.strip()) < 2:
        return {"success": False, "message": "Query too short", "results": []}
    
    try:
        settings = load_settings()
        tmdb_api_key = settings.get('tmdb_api_key')
        
        if not tmdb_api_key:
            return {"success": False, "message": "TMDB API key not configured", "results": []}
        
        url = "https://api.themoviedb.org/3/search/movie"
        params = {
            "api_key": tmdb_api_key,
            "query": q.strip(),
            "language": get_language(),
            "page": 1
        }
        
        response = requests.get(url, params=params, timeout=10)
        
        if response.status_code != 200:
            return {"success": False, "message": f"TMDB API error: {response.status_code}", "results": []}
        
        data = response.json()
        results = []
        
        for movie in data.get('results', [])[:10]:  # Limit to 10 results
            poster_path = movie.get('poster_path')
            results.append({
                'tmdb_id': movie.get('id'),
                'title': movie.get('title', 'Unknown'),
                'original_title': movie.get('original_title', ''),  # English title
                'year': movie.get('release_date', '')[:4] if movie.get('release_date') else None,
                'overview': movie.get('overview', ''),
                'poster': f"https://image.tmdb.org/t/p/w500{poster_path}" if poster_path else None,
                'vote_average': movie.get('vote_average', 0)
            })
        
        return {"success": True, "results": results, "count": len(results)}
        
    except Exception as e:
        logger.error(f"TMDB search error: {e}")
        return {"success": False, "message": str(e), "results": []}

@app.get("/api/search")
def search_movies(q: str, tmdb_id: int = None):
    """Search for movies using configured indexers with optional intelligent multi-language search"""
    from logic import search_indexers, load_settings
    
    if not q or len(q.strip()) < 2:
        return {"success": False, "message": "Query too short", "results": []}
    
    try:
        settings = load_settings()
        results = search_indexers(q.strip(), settings, tmdb_id=tmdb_id)
        return {"success": True, "results": results, "count": len(results)}
    except Exception as e:
        logger.error(f"Search error: {e}")
        return {"success": False, "message": str(e), "results": []}

@app.post("/api/add_torrent")
def add_torrent_from_url(payload: dict):
    """Add torrent to download client from URL"""
    from logic import get_qb_client, load_settings, MANUAL_SEARCH_TAG
    import time
    
    url = payload.get('url')
    title = payload.get('title', 'Unknown')
    
    if not url:
        return {"success": False, "message": "Missing torrent URL"}
    
    try:
        settings = load_settings()
        auto_copy_manual = settings.get('auto_copy_manual_search', False)
        qb = get_qb_client(settings)
        qb.auth_log_in()
        
        # Add torrent from URL with tag if auto-copy is enabled
        if auto_copy_manual:
            logger.info(f"Adding manual search torrent with auto-copy tag: {MANUAL_SEARCH_TAG}")
            qb.torrents_add(urls=url, tags=MANUAL_SEARCH_TAG)
        else:
            qb.torrents_add(urls=url)
        
        # Poll for the new torrent (try for up to 5 seconds)
        torrent_hash = None
        for i in range(5):
            time.sleep(1) # Wait 1 second between checks
            
            # Get the most recently added torrent
            recent_torrents = qb.torrents_info(sort='added_on', reverse=True, limit=1)
            
            if recent_torrents:
                added_on = recent_torrents[0].get('added_on', 0)
                now = time.time()
                
                # Debug logging
                logger.info(f"Attempt {i+1}: Recent torrent added_on={added_on}, now={now}, diff={now-added_on}")
                
                if now - added_on < 20: # 20 seconds buffer
                    torrent_hash = recent_torrents[0].get('hash')
                    logger.info(f"Found hash for new torrent: {torrent_hash}")
                    break
        
        logger.info(f"Added torrent to download client: {title}")
        return {"success": True, "message": f"Torrent added: {title}", "hash": torrent_hash}
        
    except Exception as e:
        logger.error(f"Error adding torrent: {e}")
        return {"success": False, "message": str(e)}

@app.post("/api/test_rss_feed")
def test_rss_feed_endpoint(payload: dict):
    """Test RSS feed URL"""
    from logic import test_rss_feed
    
    url = payload.get('url')
    if not url:
        return {"success": False, "message": "Missing RSS URL"}
    
    success, message, feed_info = test_rss_feed(url)
    return {"success": success, "message": message, "feed_info": feed_info}

@app.post("/api/rss/fetch")
def fetch_rss_movies_endpoint():
    """Fetch movies from configured RSS feeds"""
    from logic import fetch_rss_movies
    
    result = fetch_rss_movies(limit=30)
    return result

@app.get("/api/rss/status")
def get_rss_status_endpoint():
    """Get RSS refresh status - next feed to refresh and countdown"""
    from logic import get_rss_refresh_status
    
    status = get_rss_refresh_status()
    return status

@app.post("/api/clear-rss-movies")
def clear_rss_movies():
    """Delete all RSS movies from the database"""
    from database import Movie
    
    try:
        # Delete movies with state='rss' or status='rss_new'
        query = Movie.delete().where(
            (Movie.state == 'rss') | 
            (Movie.status == 'rss_new')
        )
        count = query.execute()
        
        return {"success": True, "message": f"Deleted {count} RSS movies"}
    except Exception as e:
        logger.error(f"Error clearing RSS movies: {e}")
        return {"success": False, "message": str(e)}


@app.get("/api/ignored-movies")
def get_ignored_movies():
    """Get list of all ignored movies"""
    from database import Movie
    
    try:
        ignored_movies = Movie.select().where(Movie.ignored == True)
        movies_list = []
        for movie in ignored_movies:
            movies_list.append({
                'hash': movie.torrent_hash,
                'title': movie.title,
                'year': movie.year,
                'poster_url': movie.poster_path if movie.poster_path else None
            })
        return {"success": True, "movies": movies_list}
    except Exception as e:
        logger.error(f"Error getting ignored movies: {e}")
        return {"success": False, "message": str(e), "movies": []}

@app.get("/api/watchlist")
def get_watchlist_endpoint():
    """Get list of all watchlist movies"""
    from logic import get_watchlist_movies
    
    try:
        movies = get_watchlist_movies()
        return {"success": True, "movies": movies}
    except Exception as e:
        logger.error(f"Error getting watchlist movies: {e}")
        return {"success": False, "message": str(e), "movies": []}

@app.delete("/api/watchlist/{torrent_hash}")
def remove_watchlist_endpoint(torrent_hash: str):
    """Remove a movie from watchlist"""
    from logic import remove_from_watchlist
    
    try:
        success = remove_from_watchlist(torrent_hash)
        if success:
            return {"success": True, "message": "Removed from watchlist"}
        else:
            return {"success": False, "message": "Movie not found"}
    except Exception as e:
        logger.error(f"Error removing from watchlist: {e}")
        return {"success": False, "message": str(e)}


@app.post("/api/unignore-movie")
def unignore_movie(data: dict):
    """Remove a single movie from the ignored list"""
    from database import Movie
    
    try:
        torrent_hash = data.get('hash')
        if not torrent_hash:
            return {"success": False, "message": "No hash provided"}
        
        movie = Movie.get_or_none(Movie.torrent_hash == torrent_hash)
        if not movie:
            return {"success": False, "message": "Movie not found"}
        
        if not movie.ignored:
            return {"success": False, "message": "Movie is not ignored"}
        
        movie.ignored = False
        movie.save()
        
        return {"success": True, "message": f"'{movie.title}' removed from ignored list"}
    except Exception as e:
        logger.error(f"Error unignoring movie: {e}")
        return {"success": False, "message": str(e)}

@app.post("/api/reset-ignored")
def reset_ignored_movies():
    """Reset ignored status for all movies, making them visible again"""
    from database import Movie
    
    try:
        query = Movie.update(ignored=False).where(Movie.ignored == True)
        count = query.execute()
        return {"success": True, "message": f"Reset {count} ignored movies to visible"}
    except Exception as e:
        logger.error(f"Error resetting ignored movies: {e}")
        return {"success": False, "message": str(e)}

# Serve Frontend
import os
static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
