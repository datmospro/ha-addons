import os
import re
import time
import shutil
import threading
import unicodedata
import requests
from copy_conflicts import inspect_files
from database import MoveHistory, Movie
from .config import logger, load_settings, trigger_movies_update_callback
from .notifications import send_telegram_notification

# Global State for Mover
COPY_PROGRESS = {} # {hash: {percent: float, speed: float, status: str}}
STOP_FLAGS = set() # Set of hashes to stop
RESERVED_SPACE = {} # {dest_path: reserved_bytes} - Track space reserved by active copies
COPY_LOCK = threading.RLock()
COPY_SLOT = threading.Semaphore(1)
COPY_OUTPUTS = {} # Only files created by the active task may be removed.
COPY_REPLACEMENTS = {} # hash -> [(temporary file, final destination)]
COPY_DIRECTORIES = {}
SPACE_LOCK = threading.Lock() # Thread-safe access to RESERVED_SPACE

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

def get_copy_progress():
    return COPY_PROGRESS

def stop_copy(torrent_hash):
    """Persist a manual hold before signalling an active or queued transfer."""
    from .tmdb import SYNC_LOCK
    with SYNC_LOCK, COPY_LOCK:
        movie = Movie.get_or_none(Movie.torrent_hash == torrent_hash)
        if movie:
            Movie.update(copy_paused=True).where(Movie.torrent_hash == torrent_hash).execute()
        active = torrent_hash in COPY_PROGRESS
        if active:
            STOP_FLAGS.add(torrent_hash)
        return bool(movie or active)

def check_copy_cancelled(torrent_hash):
    if torrent_hash in STOP_FLAGS:
        raise InterruptedError("Copy stopped by user")

def cleanup_copy_outputs(torrent_hash):
    """Delete task-owned files, then its directory only if empty."""
    for path in COPY_OUTPUTS.get(torrent_hash, set()):
        if os.path.isfile(path):
            os.remove(path)
    directory = COPY_DIRECTORIES.get(torrent_hash)
    if directory and os.path.isdir(directory) and not os.listdir(directory):
        os.rmdir(directory)

def copy_with_progress(src, dst, torrent_hash, speed_limit_mbps=0, overwrite=False):
    if overwrite:
        final_destination = dst
        dst = dst + '.roverr-' + torrent_hash + '.part'
        # A leftover temporary file belongs to a previous attempt for this hash.
        if os.path.isfile(dst):
            os.remove(dst)
        COPY_REPLACEMENTS.setdefault(torrent_hash, []).append((dst, final_destination))
    global COPY_PROGRESS, STOP_FLAGS
    
    check_copy_cancelled(torrent_hash)
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
        with open(src, 'rb') as fsrc, open(dst, 'xb') as fdst:
            COPY_OUTPUTS.setdefault(torrent_hash, set()).add(dst)
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
                percent = (copied / file_size) * 100 if file_size else 100
                
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
                        deadline = time.monotonic() + sleep_time
                        while time.monotonic() < deadline:
                            check_copy_cancelled(torrent_hash)
                            time.sleep(min(0.1, max(0, deadline - time.monotonic())))
                        
        check_copy_cancelled(torrent_hash)
        COPY_PROGRESS[torrent_hash] = {
            'percent': 100, 'speed': 0, 'status': 'copying'
        }
            
    except InterruptedError:
        # The operation owns cleanup; propagate cancellation so no success
        # history, notification or later file copy is emitted.
        raise

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

from .client import get_qb_client

def copy_paths(torrent, settings):
    item = os.path.basename(torrent.content_path.replace('\\', '/').rstrip('/'))
    match = re.search(r"(.+?)\s*\((\d{4})\)", item)
    if not match:
        raise ValueError("Torrent filename must contain 'Title (Year)'")
    folder = f"{sanitize_path_component(match[1].strip())} ({sanitize_path_component(match[2])})"
    source_base = settings.get('local_source_path')
    dest_base = settings.get('local_dest_path')
    if not source_base or not dest_base:
        raise ValueError('Source and destination paths are required')
    source = find_file_in_path(source_base, item)
    if not source:
        if not settings.get('receptor_enabled'):
            raise FileNotFoundError(f'Source not found: {item}')
        source = torrent.content_path
    destination = os.path.join(dest_base, folder)
    if os.path.commonpath([os.path.realpath(destination), os.path.realpath(dest_base)]) != os.path.realpath(dest_base):
        raise ValueError('Destination escapes library directory')
    if settings.get('receptor_enabled'):
        for line in settings.get('receptor_path_mapping', '').splitlines():
            if '=' not in line:
                continue
            linux, windows = (value.strip() for value in line.split('=', 1))
            for key, value in [('source', source), ('destination', destination)]:
                if linux and (value == linux or value.startswith(linux.rstrip('/') + '/')):
                    mapped = (windows + value[len(linux):]).replace('/', '\\')
                    if key == 'source':
                        source = mapped
                    else:
                        destination = mapped
    return source, destination, folder

def inspect_torrent_copy(torrent, settings):
    source, destination, folder = copy_paths(torrent, settings)
    if settings.get('receptor_enabled'):
        host, port = settings.get('receptor_host'), settings.get('receptor_port', 8095)
        response = requests.post(f'http://{host}:{port}/inspect', json={
            'source': source, 'destination': destination, 'folder_name': folder
        }, timeout=15)
        if response.status_code == 404:
            raise ValueError('Actualiza y reinicia el receptor del PC para comparar archivos (4.5.4)')
        if response.status_code != 200:
            try:
                message = response.json().get('error', 'Error al comparar los archivos en el receptor')
            except ValueError:
                message = 'El receptor no pudo comparar los archivos'
            raise ValueError(message)
        response.raise_for_status()
        info = response.json()
        if not isinstance(info.get('files'), list) or not info.get('fingerprint'):
            raise ValueError('El receptor no devolvió una comparación válida')
        info['location'] = f'Receptor {host}:{port}'
    else:
        info = inspect_files(source, destination, folder)
        info['location'] = 'Home Assistant'
    info['torrent_hash'] = torrent.hash
    info['torrent_name'] = torrent.name
    return info

def commit_copy_outputs(torrent, settings):
    replacements = COPY_REPLACEMENTS.get(torrent.hash, [])
    if not replacements:
        return
    current = inspect_torrent_copy(torrent, settings)
    if current['fingerprint'] != settings['_copy_fingerprint']:
        raise ValueError('Los archivos cambiaron durante la copia. Vuelve a comparar el destino.')
    with COPY_LOCK:
        check_copy_cancelled(torrent.hash)
        for temporary, final in replacements:
            os.replace(temporary, final)
            COPY_OUTPUTS.get(torrent.hash, set()).discard(temporary)

def manual_move(torrent_hash, config_ignored=None, automatic=False, decision=None):
    """
    Manually triggers a move operation for a specific torrent
    """
    logger.info("=" * 80)
    logger.info(f"­ƒôª [MOVE] MANUAL MOVE STARTED - Hash: {torrent_hash[:8]}...")
    logger.info("=" * 80)
    
    settings = load_settings()
    try:
        qb = get_qb_client(settings)
        qb.auth_log_in()
        
        torrents = qb.torrents_info(torrent_hashes=torrent_hash)
        if not torrents:
            return {"success": False, "message": "Torrent not found"}
            
        torrent = torrents[0]
        
        if torrent.progress < 1:
            return {"success": False, "message": "Download is not complete"}
        with COPY_LOCK:
            if torrent_hash in COPY_PROGRESS:
                return {"success": True, "status": "started", "message": "Copy already queued or running"}
        inspection = inspect_torrent_copy(torrent, settings)
        action = (decision or {}).get('action')
        if action not in (None, 'overwrite', 'keep'):
            return {"success": False, "message": "Invalid copy decision"}
        stale = decision is not None and decision.get('fingerprint') != inspection['fingerprint']
        if stale or (inspection['conflict'] and action is None):
            if automatic:
                Movie.update(copy_paused=True).where(Movie.torrent_hash == torrent_hash).execute()
            return {"success": False, "status": "conflict", "comparison": inspection,
                    "message": "Los archivos han cambiado; revisa la comparación" if stale else "El archivo de destino ya existe"}
        if action == 'keep':
            if not inspection['all_destinations_exist']:
                return {"success": False, "message": "Faltan archivos de destino; no se puede marcar como copiada"}
            MoveHistory.create(torrent_name=torrent.name, status='manual',
                               message='Existing destination kept by user',
                               source_path=inspection['source_path'],
                               dest_path=os.path.join(settings['local_dest_path'], inspection['folder_name']))
            Movie.update(status='moved_manually', copy_paused=True).where(Movie.torrent_hash == torrent_hash).execute()
            trigger_movies_update_callback()
            return {"success": True, "status": "marked", "message": "Archivo conservado y película marcada como copiada"}
        settings = dict(settings, _overwrite=action == 'overwrite', _copy_fingerprint=inspection['fingerprint'])
        with COPY_LOCK:
            movie = Movie.get_or_none(Movie.torrent_hash == torrent_hash)
            if automatic and movie and movie.copy_paused:
                return {"success": False, "message": "Copy held for manual start"}
            if torrent_hash in COPY_PROGRESS:
                return {"success": True, "message": "Copy already queued or running"}
            if not automatic and movie:
                Movie.update(copy_paused=False).where(Movie.torrent_hash == torrent_hash).execute()
            STOP_FLAGS.discard(torrent_hash)
            COPY_PROGRESS[torrent_hash] = {'percent': 0, 'speed': 0, 'status': 'queued'}

        def _move_thread():
            try:
                with COPY_SLOT:
                    check_copy_cancelled(torrent_hash)
                    current = inspect_torrent_copy(torrent, settings)
                    if current['fingerprint'] != settings['_copy_fingerprint']:
                        Movie.update(copy_paused=True).where(Movie.torrent_hash == torrent_hash).execute()
                        MoveHistory.create(torrent_name=torrent.name, status='error',
                                           message='Destino cambiado mientras esperaba. Vuelve a copiar para comparar.',
                                           source_path=current['source_path'], dest_path=current['destination_path'])
                        return
                    COPY_PROGRESS[torrent_hash]['status'] = 'copying'
                    process_single_torrent(qb, torrent, settings)
            except InterruptedError:
                pass
            except Exception as e:
                logger.error(f"Error in background move thread: {e}")
            finally:
                Movie._meta.database.close()
                with COPY_LOCK:
                    COPY_PROGRESS.pop(torrent_hash, None)
                    STOP_FLAGS.discard(torrent_hash)
                    COPY_OUTPUTS.pop(torrent_hash, None)
                    COPY_DIRECTORIES.pop(torrent_hash, None)
                    COPY_REPLACEMENTS.pop(torrent_hash, None)
                trigger_movies_update_callback()

        threading.Thread(target=_move_thread, daemon=True).start()
        
        return {"success": True, "status": "started", "message": f"Started processing {torrent.name} in background"}
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
        logger.info(f"­ƒôü [COPY] COPY STARTED")
        logger.info(f"­ƒôü [COPY] Source: {os.path.basename(source_path)}")
        logger.info(f"­ƒôü [COPY] Destination: {os.path.basename(dest_dir)}")
        logger.info("=" * 80)
        
        logger.debug(f"­ƒöº [COPY] Full source path: {source_path}")
        logger.debug(f"­ƒöº [COPY] Full destination path: {dest_dir}")
        logger.debug(f"­ƒöº [COPY] Speed limit: {limit} MB/s")
        
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
                    "folder_name": folder_name,
                    "overwrite": settings.get('_overwrite', False),
                    "fingerprint": settings.get('_copy_fingerprint')
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
                        _poll_receptor_status(torrent, host, port, source_path, dest_dir, settings, title, year)
                        return
                    else:
                        error_msg = data.get("error_msg") or data.get("message") or data.get("error") or "Unknown Receptor Error"
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
        check_copy_cancelled(torrent.hash)
        COPY_DIRECTORIES[torrent.hash] = dest_dir
        os.makedirs(dest_dir, exist_ok=True)
        # If it's a file
        if os.path.isfile(source_path):
            logger.info(f"Source is a file: {source_path}")
            ext = os.path.splitext(item_name)[1]
            new_name = f"{folder_name}{ext}"
            dest_file = os.path.join(dest_dir, new_name)
            
            if not os.path.exists(dest_file) or settings.get('_overwrite', False):
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
                    copy_with_progress(source_path, dest_file, torrent.hash, limit, overwrite=settings.get('_overwrite', False))
                    check_copy_cancelled(torrent.hash)
                    commit_copy_outputs(torrent, settings)
                    MoveHistory.create(torrent_name=torrent.name, source_path=source_path, dest_path=dest_file, status='success')
                    trigger_movies_update_callback()
                    
                    # Notify Telegram: Moved
                    if settings.get('telegram_notify_on_move', True):
                        send_telegram_notification(f"­ƒÜÇ <b>Movie Moved to Library</b>\n\n­ƒÄ¼ {title} ({year})\n­ƒôé {dest_file}")

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
                            
                            if not os.path.exists(dest_file) or settings.get('_overwrite', False):
                                logger.info(f"Copying {src_file} to {dest_file}")
                                copy_with_progress(src_file, dest_file, torrent.hash, limit, overwrite=settings.get('_overwrite', False))
                                copied = True
                            else:
                                logger.info(f"File already exists: {dest_file}")
                                # Mark as skipped if at least one file exists?
                                # But we might have multiple files.
                                pass
                            
                check_copy_cancelled(torrent.hash)
                if copied:
                    commit_copy_outputs(torrent, settings)
                    MoveHistory.create(torrent_name=torrent.name, source_path=source_path, dest_path=dest_dir, status='success')
                    trigger_movies_update_callback()
                    
                    # Notify Telegram: Moved
                    if settings.get('telegram_notify_on_move', True):
                        send_telegram_notification(f"­ƒÜÇ <b>Movie Moved to Library</b>\n\n­ƒÄ¼ {title} ({year})\n­ƒôé {dest_dir}")

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
        try:
            cleanup_copy_outputs(torrent.hash)
        except Exception as cleanup_error:
            logger.error(f"Cancelled copy cleanup failed: {cleanup_error}")
            MoveHistory.create(torrent_name=torrent.name, status='error',
                               message=f"Cancelled copy cleanup failed: {cleanup_error}",
                               source_path=source_path, dest_path=dest_dir)
            trigger_movies_update_callback()
            return
        MoveHistory.create(torrent_name=torrent.name, status='cancelled',
                           message="Copy stopped by user", source_path=source_path, dest_path=dest_dir)
        trigger_movies_update_callback()
    except Exception as e:
        if settings.get('_overwrite'):
            cleanup_copy_outputs(torrent.hash)
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
    
    stop_sent = False
    while True:
        try:
            # Check for stop signal from Roverr UI
            if torrent.hash in STOP_FLAGS and not stop_sent:
                logger.info(f"Sending stop signal to Receptor for {torrent.hash}")
                response = requests.post(stop_url, timeout=5)
                if response.status_code != 404:
                    response.raise_for_status()
                stop_sent = True
                # Keep polling until the remote writer has closed its files
                # and finished cleanup before releasing the transfer slot.
                
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
                        send_telegram_notification(f"­ƒÜÇ <b>Movie Moved via Receptor</b>\n\n­ƒÄ¼ {title} ({year})\n­ƒôé {dest_dir}")
                        
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
                    
                elif status == "cancelled":
                    MoveHistory.create(torrent_name=torrent.name, source_path=source_path,
                                       dest_path=dest_dir, status='cancelled', message="Copy stopped by user")
                    trigger_movies_update_callback()
                    break
                elif status == "error":
                    # Receptor encountered an error
                    error_msg = data.get("error") or data.get("error_msg") or "Unknown receptor error"
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

