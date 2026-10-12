import os
import time
import json
import threading
import copy
import logging
import shutil
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

"""Filesystem-only copy inspection, also embedded in the standalone receptor."""
import hashlib
import json
import os
import re
from datetime import datetime, timezone


def file_info(path):
    try:
        stat = os.stat(path)
    except FileNotFoundError:
        return {'path': path, 'exists': False, 'size': None,
                'modified': None, 'mtime_ns': None}
    if not os.path.isfile(path):
        raise ValueError(f'Expected a file: {path}')
    return {'path': path, 'exists': True, 'size': stat.st_size,
            'modified': datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            'mtime_ns': stat.st_mtime_ns}


def inspect_files(source, destination, folder_name):
    if not os.path.exists(source):
        raise FileNotFoundError(f'Source not found: {source}')
    if not folder_name or os.path.basename(folder_name) != folder_name or folder_name in ('.', '..'):
        raise ValueError('Invalid destination folder name')
    if os.path.isfile(source):
        sources = [source]
    elif os.path.isdir(source):
        sources = sorted(os.path.join(root, name)
                         for root, _, files in os.walk(source) for name in files
                         if os.path.splitext(name)[1].lower() in ('.mkv', '.mp4', '.avi'))
    else:
        raise ValueError('Invalid source path')
    if not sources:
        raise ValueError('No video files found in source')
    entries = []
    seen = set()
    for path in sources:
        target = os.path.join(destination, folder_name + os.path.splitext(path)[1])
        target_real = os.path.realpath(target)
        dest_real = os.path.realpath(destination)
        if os.path.commonpath([target_real, dest_real]) != dest_real:
            raise ValueError('Destination file escapes destination directory')
        if os.path.normcase(target_real) == os.path.normcase(os.path.realpath(path)):
            raise ValueError('Source and destination refer to the same file')
        if os.path.normcase(target_real) in seen:
            raise ValueError('Multiple source files would use the same destination filename')
        seen.add(os.path.normcase(target_real))
        src, dst = file_info(path), file_info(target)
        difference = dst['size'] - src['size'] if dst['exists'] else None
        entries.append({'source': src, 'destination': dst,
                        'difference_bytes': difference,
                        'same_size': dst['exists'] and difference == 0})
    fingerprint = hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()
    return {'source_path': source, 'destination_path': destination,
            'folder_name': folder_name, 'files': entries,
            'conflict': any(row['destination']['exists'] for row in entries),
            'all_destinations_exist': all(row['destination']['exists'] for row in entries),
            'fingerprint': fingerprint}


"""Verified staged transfers shared with the standalone Windows receptor."""
import hashlib
import json
import os

BLOCK_SIZE = 1024 * 1024


def source_identity(path):
    if os.path.islink(path) or not os.path.isfile(path):
        raise ValueError('El origen debe ser un archivo normal')
    stat = os.stat(path)
    return {'path': os.path.normcase(os.path.realpath(path)), 'size': stat.st_size,
            'mtime_ns': stat.st_mtime_ns, 'ctime_ns': stat.st_ctime_ns}


def remove_resume_metadata(temporary):
    for path in (temporary + '.json', temporary + '.json.tmp'):
        if os.path.lexists(path):
            if os.path.islink(path):
                raise ValueError('Los metadatos temporales no pueden ser un enlace')
            os.remove(path)


def prepare_resume(source, temporary, final, task_id, check_cancelled):
    """Reuse only an owned temporary whose entire prefix matches the source."""
    check_cancelled()
    expected = {'version': 1, 'source': source_identity(source),
                'destination': os.path.normcase(os.path.realpath(final)), 'task_id': task_id}
    metadata = temporary + '.json'
    for path in (temporary, metadata, metadata + '.tmp'):
        if os.path.islink(path):
            raise ValueError('El archivo temporal no puede ser un enlace')
    offset = 0
    if os.path.exists(temporary):
        valid = False
        try:
            with open(metadata, encoding='utf-8') as stream:
                valid = json.load(stream) == expected
            offset = os.path.getsize(temporary)
            valid = valid and offset <= expected['source']['size']
            if valid:
                with open(source, 'rb') as original, open(temporary, 'rb') as partial:
                    remaining = offset
                    while remaining:
                        check_cancelled()
                        length = min(BLOCK_SIZE, remaining)
                        if original.read(length) != partial.read(length):
                            valid = False
                            break
                        remaining -= length
                valid = valid and source_identity(source) == expected['source']
        except InterruptedError:
            raise
        except (OSError, ValueError, TypeError):
            valid = False
        if not valid:
            check_cancelled()
            os.remove(temporary)
            offset = 0
    check_cancelled()
    with open(metadata + '.tmp', 'w', encoding='utf-8') as stream:
        json.dump(expected, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(metadata + '.tmp', metadata)
    return offset, expected['source']


def verify_copy(source, temporary, identity, check_cancelled):
    """Read both complete files and compare SHA-256 before publication."""
    check_cancelled()
    if source_identity(source) != identity or os.path.getsize(temporary) != identity['size']:
        raise ValueError('El origen cambió o la copia está incompleta; no se publicará el archivo')
    output_before = os.stat(temporary)
    hashes = [hashlib.sha256(), hashlib.sha256()]
    with open(source, 'rb') as original, open(temporary, 'rb') as output:
        while True:
            check_cancelled()
            first, second = original.read(BLOCK_SIZE), output.read(BLOCK_SIZE)
            hashes[0].update(first)
            hashes[1].update(second)
            if not first and not second:
                break
    output_after = os.stat(temporary)
    if (hashes[0].digest() != hashes[1].digest() or source_identity(source) != identity
            or (output_before.st_size, output_before.st_mtime_ns) != (output_after.st_size, output_after.st_mtime_ns)):
        raise ValueError('La verificación SHA-256 falló; se conserva el destino original')
    check_cancelled()
    return hashes[0].hexdigest()


# Configuration
BIND_HOST = '0.0.0.0'
BIND_PORT = 8095
MAX_SPEED_MBPS = 0  # 0 for unlimited, adjust to throttle copy

# Path Mapping is now handled entirely on the Roverr (Home Assistant) side.
# This script will receive the correct Windows paths directly.

# Logging setup
if not logging.getLogger().handlers:
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler("roverr_receptor.log", mode="a", encoding="utf-8")
        ]
    )
logger = logging.getLogger("RoverrReceptor")

# State tracking for active copies
# Structure: { task_id (torrent_hash): {'status': 'copying|done|error', 'percent': 0-100, 'speed': float_mbps, 'error_msg': ''} }
TASKS = {}
STOP_FLAGS = set()
PAUSE_FLAGS = set()
TASKS_LOCK = threading.Lock()

class CopyTaskHandler(threading.Thread):
    def __init__(self, task_id, source_path, dest_dir, folder_name, overwrite=False, fingerprint=None, stage_all=False, attempt_id=None):
        super().__init__()
        self.task_id = task_id
        self.source_path = source_path
        self.dest_dir = dest_dir
        self.folder_name = folder_name
        self.staging = overwrite or stage_all
        self.overwrite = overwrite
        self.fingerprint = fingerprint
        self.replacements = []
        self.created_files = set()
        self.chunk_size = 1024 * 1024  # 1MB chunks
        
        with TASKS_LOCK:
            TASKS[self.task_id] = {
                'status': 'copying',
                'percent': 0.0,
                'speed': 0.0,
                'error_msg': '', 'attempt_id': attempt_id
            }

    def update_state(self, status, percent=None, speed=None, error_msg=''):
        with TASKS_LOCK:
            if self.task_id in TASKS:
                if status: TASKS[self.task_id]['status'] = status
                if percent is not None: TASKS[self.task_id]['percent'] = percent
                if speed is not None: TASKS[self.task_id]['speed'] = speed
                if error_msg: TASKS[self.task_id]['error_msg'] = error_msg

    def checkpoint(self):
        if self.task_id in STOP_FLAGS:
            raise InterruptedError('Copy stopped by user')
        started = time.monotonic()
        waited = False
        previous = None
        while self.task_id in PAUSE_FLAGS:
            if self.task_id in STOP_FLAGS:
                raise InterruptedError('Copy stopped by user')
            with TASKS_LOCK:
                if not waited:
                    previous = TASKS[self.task_id].get('phase')
                TASKS[self.task_id].update(phase='paused', speed=0)
            waited = True
            time.sleep(.1)
        if self.task_id in STOP_FLAGS:
            raise InterruptedError('Copy stopped by user')
        if waited:
            with TASKS_LOCK:
                TASKS[self.task_id]['phase'] = previous
        return time.monotonic()-started if waited else 0

    def _copy_file(self, src_file, dst_file):
        """Copies a single file with progress and speed tracking"""
        paused_seconds = [0]
        def cancelled():
            paused_seconds[0] += self.checkpoint()
        cancelled()
        os.makedirs(os.path.dirname(dst_file), exist_ok=True)
        identity = source_identity(src_file)
        copied = 0
        mode = 'xb'
        with TASKS_LOCK:
            TASKS[self.task_id].update(phase='validating_resume')
        if self.staging:
            final = dst_file
            dst_file = dst_file + '.roverr-' + self.task_id + '.part'
            self.created_files.update((dst_file, dst_file + '.json', dst_file + '.json.tmp'))
            copied, identity = prepare_resume(src_file, dst_file, final, self.task_id, cancelled)
            mode = 'r+b' if os.path.exists(dst_file) else 'xb'
            self.replacements.append((dst_file, final))
        file_size = identity['size']
        initial_offset = copied
        with TASKS_LOCK:
            TASKS[self.task_id].update(phase='copying', resumed_bytes=initial_offset, file_size=file_size, copied_bytes=copied, percent=round(copied/file_size*100,1) if file_size else 0)
        pause_baseline = paused_seconds[0]
        start_time = time.time()
        last_update = start_time
        
        os.makedirs(os.path.dirname(dst_file), exist_ok=True)

        if self.task_id in STOP_FLAGS:
            raise InterruptedError('Copy stopped by user')
        with open(src_file, 'rb') as fsrc, open(dst_file, mode) as fdst:
            fsrc.seek(initial_offset)
            fdst.seek(initial_offset)
            self.created_files.add(dst_file)
            while True:
                cancelled()
                # Check for cancellation
                if self.task_id in STOP_FLAGS:
                    logger.info(f"Task {self.task_id} aborted by user.")
                    raise InterruptedError("Copy aborted by stop command.")

                chunk = fsrc.read(self.chunk_size)
                if not chunk:
                    break
                
                fdst.write(chunk)
                copied += len(chunk)
                with TASKS_LOCK:
                    TASKS[self.task_id].update(file_size=file_size, copied_bytes=copied, percent=round(copied/file_size*100,1) if file_size else 100)

                current_time = time.time()
                elapsed = current_time - start_time - (paused_seconds[0] - pause_baseline)
                
                if current_time - last_update > 0.5 or copied == file_size:
                    percent = round((copied / file_size) * 100, 1) if file_size > 0 else 100.0
                    speed = round(((copied - initial_offset) / 1024 / 1024) / elapsed, 2) if elapsed > 0 else 0.0
                    
                    with TASKS_LOCK:
                        TASKS[self.task_id].update(file_size=file_size, copied_bytes=copied)
                    self.update_state(status=None, percent=percent, speed=speed)
                    last_update = current_time
                    
                # Basic throttling if needed
                if MAX_SPEED_MBPS > 0:
                    expected_time = ((copied - initial_offset) / 1024 / 1024) / MAX_SPEED_MBPS
                    if expected_time > elapsed:
                        deadline = time.monotonic() + expected_time - elapsed
                        while time.monotonic() < deadline:
                            cancelled()
                            time.sleep(min(.1, max(0, deadline - time.monotonic())))
            fdst.flush()
            os.fsync(fdst.fileno())
        with TASKS_LOCK:
            TASKS[self.task_id].update(phase='verifying', speed=0, file_size=file_size, copied_bytes=copied)
        digest = verify_copy(src_file, dst_file, identity, cancelled)
        with TASKS_LOCK:
            TASKS[self.task_id].setdefault('sha256', {})[os.path.basename(dst_file)] = digest
        return True

    def run(self):
        logger.info(f"Starting copy task {self.task_id}. Src: {self.source_path} -> Dst: {self.dest_dir}")
        try:
            if not os.path.exists(self.source_path):
                raise FileNotFoundError(f"Source not found: {self.source_path}")

            comparison = inspect_files(self.source_path, self.dest_dir, self.folder_name)
            if self.fingerprint and comparison['fingerprint'] != self.fingerprint:
                raise ValueError('Files changed before copy started; compare again')
            if comparison['conflict'] and not self.overwrite:
                raise FileExistsError('Destination already exists; compare before copying')
            os.makedirs(self.dest_dir, exist_ok=True)
            if self.staging:
                for row in comparison['files']:
                    temporary = row['destination']['path'] + '.roverr-' + self.task_id + '.part'
                    self.created_files.update((temporary, temporary + '.json', temporary + '.json.tmp'))

            if os.path.isfile(self.source_path):
                # It's a single file
                ext = os.path.splitext(self.source_path)[1]
                # Try to use the movie title structure, or fallback to original name
                if self.folder_name:
                    new_name = f"{self.folder_name}{ext}"
                else:
                    new_name = os.path.basename(self.source_path)
                
                dest_file = os.path.join(self.dest_dir, new_name)
                
                if os.path.exists(dest_file) and not self.overwrite:
                    logger.info(f"File already exists (skipping): {dest_file}")
                    # You could append a timestamp or overwrite based on needs. We overwrite or skip.
                    # For safety, let's just abort if it exists to match Roverr logic.
                    raise FileExistsError(f"Destination file already exists: {dest_file}")
                
                self._copy_file(self.source_path, dest_file)
                
            elif os.path.isdir(self.source_path):
                # It's a directory, extract the largest video file or specific extensions
                video_extensions = {'.mkv', '.mp4', '.avi'}
                found = False

                for root, dirs, files in os.walk(self.source_path):
                    for file in files:
                        if os.path.splitext(file)[1].lower() in video_extensions:
                            src_file = os.path.join(root, file)
                            ext = os.path.splitext(file)[1]
                            if self.folder_name:
                                new_name = f"{self.folder_name}{ext}"
                            else:
                                new_name = file
                                
                            dest_file = os.path.join(self.dest_dir, new_name)
                            
                            if not os.path.exists(dest_file) or self.overwrite:
                                logger.info(f"Copying video file {src_file} -> {dest_file}")
                                self._copy_file(src_file, dest_file)
                                found = True
                            else:
                                logger.warning(f"File {dest_file} already exists.")
                                found = True # Mark as found but skipped
                                
                if not found:
                    raise FileNotFoundError("No valid video files (.mkv, .mp4, .avi) found in the directory.")
                    
            else:
                raise ValueError("Source path is neither a file nor a directory.")

            self.checkpoint()
            if self.staging:
                current = inspect_files(self.source_path, self.dest_dir, self.folder_name)
                if self.fingerprint and current['fingerprint'] != self.fingerprint:
                    raise ValueError('Files changed during copy; original destination preserved')
                with TASKS_LOCK:
                    if self.task_id in STOP_FLAGS:
                        raise InterruptedError('Copy stopped by user')
                    for temporary, final in self.replacements:
                        os.replace(temporary, final)
                        remove_resume_metadata(temporary)
                        self.created_files.discard(temporary)
            # Success
            logger.info(f"Task {self.task_id} completed successfully.")
            with TASKS_LOCK:
                TASKS[self.task_id].update(verified=True, phase='done')
            self.update_state('done', percent=100.0, speed=0.0)

        except InterruptedError as e:
            try:
                for path in self.created_files:
                    if os.path.isfile(path):
                        os.remove(path)
                if os.path.isdir(self.dest_dir) and not os.listdir(self.dest_dir):
                    os.rmdir(self.dest_dir)
                self.update_state('cancelled', speed=0.0)
            except Exception as cleanup_error:
                self.update_state('error', error_msg=f"Cleanup failed: {cleanup_error}")
            
        except Exception as e:
            logger.error(f"Task {self.task_id} failed: {e}", exc_info=True)
            # Invalid data or changed paths must not be reused. I/O errors may be retried.
            if isinstance(e, ValueError):
                for path in self.created_files:
                    if os.path.isfile(path):
                        os.remove(path)
            self.update_state('error', error_msg=str(e))
            
        finally:
            PAUSE_FLAGS.discard(self.task_id)
            if self.task_id in STOP_FLAGS:
                STOP_FLAGS.remove(self.task_id)

class ReceptorServer(BaseHTTPRequestHandler):
    
    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        # Allow cross-origin if Roverr webui calls it directly (though backend logic.py will call it)
        self.send_header('Access-Control-Allow-Origin', '*') 
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_GET(self):
        parsed = urlparse(self.path)
        
        # Healthcheck endpoint (Roverr logic ping)
        if parsed.path == '/' or parsed.path == '/ping':
            self._send_json(200, {
                'version': '4.5.13',
                'queue_pause': True,
                'service': 'Roverr Receptor', 
                'status': 'ok', 
                'message': 'Roverr Receptor is online.'
            })
            return

        # Status endpoint: /status/<task_id>
        if parsed.path.startswith('/status/'):
            task_id = parsed.path.split('/')[-1]
            with TASKS_LOCK:
                task_info = copy.deepcopy(TASKS.get(task_id))
            
            if task_info:
                self._send_json(200, task_info)
            else:
                self._send_json(404, {'error': 'Task ID not found.'})
            return
            
        self._send_json(404, {'error': 'Route not found.'})

    def do_POST(self):
        parsed = urlparse(self.path)
        
        if parsed.path in ('/copy', '/inspect'):
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self._send_json(400, {'error': 'Empty request body.'})
                return
                
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'Invalid JSON.'})
                return
                
            task_id = data.get('task_id')
            source_path = data.get('source_path') or data.get('source')
            dest_dir = data.get('dest_dir') or data.get('destination')
            folder_name = data.get('folder_name', '') # Explicit name format 'Title (Year)'
            
            if not all([source_path, dest_dir]) or (parsed.path == '/copy' and not task_id):
                self._send_json(400, {'error': 'Missing required fields: task_id, source(source_path), destination(dest_dir)'})
                return

            if parsed.path == '/copy' and (not isinstance(task_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', task_id)):
                self._send_json(400, {'error': 'Invalid task ID'})
                return
                
            try:
                comparison = inspect_files(source_path, dest_dir, folder_name)
            except (ValueError, OSError) as error:
                self._send_json(400, {'error': str(error)})
                return
            if parsed.path == '/inspect':
                comparison['verified_resume'] = True
                comparison['queue_pause'] = True
                self._send_json(200, comparison)
                return
            overwrite = data.get('overwrite', False) is True
            fingerprint = data.get('fingerprint')
            staged = data.get('stage_all', False) is True
            if ((overwrite or staged) and not fingerprint) or (fingerprint and comparison['fingerprint'] != fingerprint) or (comparison['conflict'] and (not overwrite or not fingerprint)):
                self._send_json(409, {'status': 'conflict', 'comparison': comparison})
                return

            logger.info(f"Received mapped copy request: {source_path} -> {dest_dir}")
                
            # Prevent double-starting
            with TASKS_LOCK:
                if task_id in TASKS and TASKS[task_id]['status'] == 'copying':
                    self._send_json(409, {'error': 'Task is already running.'})
                    return
                # Clean old flags if retrying
                if task_id in STOP_FLAGS:
                    STOP_FLAGS.remove(task_id)

            # Start background thread
            thread = CopyTaskHandler(task_id, source_path, dest_dir, folder_name, overwrite, fingerprint, staged, data.get("attempt_id"))
            if data.get('paused') is True:
                PAUSE_FLAGS.add(task_id)
            thread.start()
            
            self._send_json(202, {'status': 'accepted', 'message': f'Copy task {task_id} started.'})
            return

        if parsed.path.startswith('/pause/') or parsed.path.startswith('/resume/'):
            task_id = parsed.path.split('/')[-1]
            with TASKS_LOCK:
                if TASKS.get(task_id, {}).get('status') != 'copying':
                    self._send_json(404, {'error': 'La tarea no está activa'})
                    return
                if parsed.path.startswith('/pause/'):
                    PAUSE_FLAGS.add(task_id)
                else:
                    PAUSE_FLAGS.discard(task_id)
            self._send_json(200, {'status': 'accepted'})
            return

        if parsed.path == '/cleanup':
            try:
                length = int(self.headers.get('Content-Length', 0))
                data = json.loads(self.rfile.read(length).decode('utf-8'))
                task_id = data.get('task_id')
                destination = data.get('destination')
                files = data.get('files')
                if not isinstance(task_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', task_id):
                    raise ValueError('Identificador de tarea no válido')
                if not isinstance(destination, str) or not destination or not isinstance(files, list):
                    raise ValueError('Faltan las rutas de limpieza')
                base = os.path.realpath(destination)
                owned = []
                for final in files:
                    if not isinstance(final, str):
                        raise ValueError('Ruta de destino no válida')
                    temporary = final + '.roverr-' + task_id + '.part'
                    for path in (temporary, temporary + '.json', temporary + '.json.tmp'):
                        resolved = os.path.realpath(path)
                        if os.path.commonpath([base, resolved]) != base or resolved == base or os.path.islink(path):
                            raise ValueError('La limpieza sale de la carpeta de destino')
                        owned.append(path)
                with TASKS_LOCK:
                    if TASKS.get(task_id, {}).get('status') == 'copying':
                        self._send_json(409, {'error': 'La copia sigue activa; primero hay que detenerla'})
                        return
                    removed = False
                    for path in owned:
                        if os.path.isfile(path):
                            os.remove(path)
                            removed = True
                    if removed and os.path.isdir(destination) and not os.listdir(destination):
                        os.rmdir(destination)
                self._send_json(200, {'status': 'cancelled'})
            except (ValueError, OSError, TypeError) as error:
                self._send_json(400, {'error': str(error)})
            return

        # Stop endpoint: /stop/<task_id>
        if parsed.path.startswith('/stop/'):
            task_id = parsed.path.split('/')[-1]
            with TASKS_LOCK:
                if task_id in TASKS and TASKS[task_id]['status'] == 'copying':
                    STOP_FLAGS.add(task_id)
                    self._send_json(200, {'status': 'stopping', 'message': 'Stop signal sent.'})
                else:
                    self._send_json(404, {'error': 'Task not running or not found.'})
            return

        self._send_json(404, {'error': 'Route not found.'})

def run_server():
    server_address = (BIND_HOST, BIND_PORT)
    try:
        httpd = HTTPServer(server_address, ReceptorServer)
        logger.info(f"Roverr Receptor running at http://{BIND_HOST}:{BIND_PORT} ...")
        httpd.serve_forever()
    except Exception as e:
        logger.critical(f"Server failed: {e}")

if __name__ == '__main__':
    run_server()
