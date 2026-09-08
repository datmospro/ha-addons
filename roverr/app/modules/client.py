import os
from datetime import datetime
import qbittorrentapi
from database import Movie
from .config import logger, load_settings, trigger_movies_update_callback

# Global torrent client connection status
_torrent_client_status = {
    "connected": True,
    "last_error": None,
    "error_type": None,
    "host": None,
    "port": None,
    "last_checked": None
}

def get_torrent_client_status():
    global _torrent_client_status
    return dict(_torrent_client_status)

def update_torrent_client_status(success: bool, error: Exception = None, settings: dict = None):
    global _torrent_client_status
    now_iso = datetime.now().isoformat()
    if settings is None:
        try:
            settings = load_settings()
        except Exception:
            settings = {}
    host = settings.get('qb_host', 'localhost')
    port = settings.get('qb_port', 8080)
    
    prev_connected = _torrent_client_status.get("connected", True)
    
    if success:
        _torrent_client_status = {
            "connected": True,
            "last_error": None,
            "error_type": None,
            "host": host,
            "port": port,
            "last_checked": now_iso
        }
        if not prev_connected:
            logger.info("Ô£à [TORRENT CLIENT] Connection to qBittorrent restored!")
            trigger_movies_update_callback()
    else:
        err_str = str(error) if error else "Error desconocido"
        is_refused = "Connection refused" in err_str or "111" in err_str or "refused" in err_str.lower()
        is_timeout = "timeout" in err_str.lower() or "timed out" in err_str.lower()
        
        if is_refused:
            err_type = "connection_refused"
            friendly_msg = f"Conexi├│n rechazada al conectar a qBittorrent ({host}:{port}). Aseg├║rate de que qBittorrent est├® abierto y con la Web UI activa."
        elif is_timeout:
            err_type = "timeout"
            friendly_msg = f"Tiempo de espera agotado al conectar a qBittorrent ({host}:{port}). Comprueba la IP o el cortafuegos."
        else:
            err_type = "connection_error"
            friendly_msg = f"Error al conectar con qBittorrent ({host}:{port}): {err_str}"
            
        _torrent_client_status = {
            "connected": False,
            "last_error": friendly_msg,
            "error_type": err_type,
            "raw_error": err_str,
            "host": host,
            "port": port,
            "last_checked": now_iso
        }
        if prev_connected:
            logger.warning(f"ÔÜá´©Å [TORRENT CLIENT] Connection lost: {friendly_msg}")
            trigger_movies_update_callback()

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

def get_qb_client(settings):
    return qbittorrentapi.Client(
        host=settings.get('qb_host'),
        port=settings.get('qb_port'),
        username=settings.get('qb_user'),
        password=settings.get('qb_pass')
    )

from .mover import get_copy_progress, sanitize_path_component

def process_torrents(config_ignored=None):
    # We ignore the passed config now, use settings.json
    settings = load_settings()
    logger.info("Starting torrent check (Scheduler)...")
    
    try:
        qb = get_qb_client(settings)
        qb.auth_log_in()
        update_torrent_client_status(True, settings=settings)
    except Exception as e:
        update_torrent_client_status(False, error=e, settings=settings)
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
        update_torrent_client_status(True, settings=settings)
        
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
        update_torrent_client_status(False, error=e, settings=settings)
        logger.error(f"Error getting torrents: {e}")
        return []

