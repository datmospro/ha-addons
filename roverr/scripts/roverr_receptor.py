import os
import time
import json
import threading
import logging
import shutil
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Configuration
BIND_HOST = '0.0.0.0'
BIND_PORT = 8095
MAX_SPEED_MBPS = 0  # 0 for unlimited, adjust to throttle copy

# Logging setup
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
TASKS_LOCK = threading.Lock()

class CopyTaskHandler(threading.Thread):
    def __init__(self, task_id, source_path, dest_dir, folder_name):
        super().__init__()
        self.task_id = task_id
        self.source_path = source_path
        self.dest_dir = dest_dir
        self.folder_name = folder_name
        self.chunk_size = 1024 * 1024  # 1MB chunks
        
        with TASKS_LOCK:
            TASKS[self.task_id] = {
                'status': 'copying',
                'percent': 0.0,
                'speed': 0.0,
                'error_msg': ''
            }

    def update_state(self, status, percent=None, speed=None, error_msg=''):
        with TASKS_LOCK:
            if self.task_id in TASKS:
                if status: TASKS[self.task_id]['status'] = status
                if percent is not None: TASKS[self.task_id]['percent'] = percent
                if speed is not None: TASKS[self.task_id]['speed'] = speed
                if error_msg: TASKS[self.task_id]['error_msg'] = error_msg

    def _copy_file(self, src_file, dst_file):
        """Copies a single file with progress and speed tracking"""
        file_size = os.path.getsize(src_file)
        if file_size == 0:
            with open(dst_file, 'wb') as f:
                pass
            return True

        copied = 0
        start_time = time.time()
        last_update = start_time
        
        os.makedirs(os.path.dirname(dst_file), exist_ok=True)

        with open(src_file, 'rb') as fsrc, open(dst_file, 'wb') as fdst:
            while True:
                # Check for cancellation
                if self.task_id in STOP_FLAGS:
                    logger.info(f"Task {self.task_id} aborted by user.")
                    raise InterruptedError("Copy aborted by stop command.")

                chunk = fsrc.read(self.chunk_size)
                if not chunk:
                    break
                
                fdst.write(chunk)
                copied += len(chunk)

                current_time = time.time()
                elapsed = current_time - start_time
                
                if current_time - last_update > 0.5 or copied == file_size:
                    percent = round((copied / file_size) * 100, 1) if file_size > 0 else 100.0
                    speed = round((copied / 1024 / 1024) / elapsed, 2) if elapsed > 0 else 0.0
                    
                    self.update_state(status=None, percent=percent, speed=speed)
                    last_update = current_time
                    
                # Basic throttling if needed
                if MAX_SPEED_MBPS > 0:
                    expected_time = (copied / 1024 / 1024) / MAX_SPEED_MBPS
                    if expected_time > elapsed:
                        time.sleep(expected_time - elapsed)
        return True

    def run(self):
        logger.info(f"Starting copy task {self.task_id}. Src: {self.source_path} -> Dst: {self.dest_dir}")
        try:
            if not os.path.exists(self.source_path):
                raise FileNotFoundError(f"Source not found: {self.source_path}")

            os.makedirs(self.dest_dir, exist_ok=True)

            if os.path.isfile(self.source_path):
                # It's a single file
                ext = os.path.splitext(self.source_path)[1]
                # Try to use the movie title structure, or fallback to original name
                if self.folder_name:
                    new_name = f"{self.folder_name}{ext}"
                else:
                    new_name = os.path.basename(self.source_path)
                
                dest_file = os.path.join(self.dest_dir, new_name)
                
                if os.path.exists(dest_file):
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
                            
                            if not os.path.exists(dest_file):
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

            # Success
            logger.info(f"Task {self.task_id} completed successfully.")
            self.update_state('done', percent=100.0, speed=0.0)

        except InterruptedError as e:
            # Cleanup happen on abort
            self.update_state('error', error_msg=str(e))
            
        except Exception as e:
            logger.error(f"Task {self.task_id} failed: {e}", exc_info=True)
            self.update_state('error', error_msg=str(e))
            
        finally:
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
        if parsed.path == '/ping':
            self._send_json(200, {'status': 'ok', 'message': 'Roverr Receptor is online.'})
            return

        # Status endpoint: /status/<task_id>
        if parsed.path.startswith('/status/'):
            task_id = parsed.path.split('/')[-1]
            with TASKS_LOCK:
                task_info = TASKS.get(task_id)
            
            if task_info:
                self._send_json(200, task_info)
            else:
                self._send_json(404, {'error': 'Task ID not found.'})
            return
            
        self._send_json(404, {'error': 'Route not found.'})

    def do_POST(self):
        parsed = urlparse(self.path)
        
        if parsed.path == '/copy':
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
            source_path = data.get('source_path')
            dest_dir = data.get('dest_dir')
            folder_name = data.get('folder_name', '') # Explicit name format 'Title (Year)'
            
            if not all([task_id, source_path, dest_dir]):
                self._send_json(400, {'error': 'Missing required fields: task_id, source_path, dest_dir'})
                return
                
            # Prevent double-starting
            with TASKS_LOCK:
                if task_id in TASKS and TASKS[task_id]['status'] == 'copying':
                    self._send_json(409, {'error': 'Task is already running.'})
                    return
                # Clean old flags if retrying
                if task_id in STOP_FLAGS:
                    STOP_FLAGS.remove(task_id)

            # Start background thread
            thread = CopyTaskHandler(task_id, source_path, dest_dir, folder_name)
            thread.start()
            
            self._send_json(202, {'status': 'accepted', 'message': f'Copy task {task_id} started.'})
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
