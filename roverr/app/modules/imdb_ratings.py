"""IMDb's official daily non-commercial ratings, cached on disk.

No HTML scraping or third-party proxy. Only this public ratings file is fetched.
"""
import gzip
import os
from pathlib import Path
import re
import tempfile
import threading
import time

import requests

URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz'
CACHE_DIR = Path('/data') if Path('/data').exists() else Path(__file__).resolve().parents[1] / '.cache'
CACHE_FILE = CACHE_DIR / 'imdb-ratings.tsv.gz'
TTL = 86400
_lock = threading.Lock()
_last_attempt = 0
_values = {}
_stamp = None


def _refresh():
    global _last_attempt
    if CACHE_FILE.exists() and time.time() - CACHE_FILE.stat().st_mtime < TTL:
        return
    if time.time() - _last_attempt < 600:
        return
    _last_attempt = time.time()
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=CACHE_FILE.parent, suffix='.tmp', delete=False) as out:
            temporary = Path(out.name)
            with requests.get(URL, stream=True, timeout=(5, 30)) as response:
                response.raise_for_status()
                total = 0
                for chunk in response.iter_content(262144):
                    total += len(chunk)
                    if total > 64 * 1024 * 1024:
                        raise ValueError('IMDb dataset exceeds size limit')
                    out.write(chunk)
        # Consume the full gzip to validate its footer before replacing good data.
        with gzip.open(temporary, 'rt', encoding='utf-8') as data:
            if data.readline().strip() != 'tconst\taverageRating\tnumVotes':
                raise ValueError('Unexpected IMDb dataset schema')
            rows = 0
            for line in data:
                parts = line.rstrip('\n').split('\t')
                if len(parts) != 3:
                    raise ValueError('Invalid IMDb ratings row')
                rows += 1
            if not rows:
                raise ValueError('Empty IMDb dataset')
        os.replace(temporary, CACHE_FILE)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def get_rating(imdb_id):
    """Runs in a worker thread; an unavailable source never erases a saved rating."""
    global _stamp
    if not re.fullmatch(r'tt\d+', str(imdb_id or '')):
        return {'status': 'unidentified', 'rating': None, 'votes': None}
    with _lock:
        failed = False
        try:
            _refresh()
        except (OSError, ValueError, EOFError, requests.RequestException):
            failed = True
        if not CACHE_FILE.exists():
            return {'status': 'unavailable', 'rating': None, 'votes': None}
        stamp = CACHE_FILE.stat().st_mtime_ns
        if _stamp != stamp:
            _values.clear()
            _stamp = stamp
        if imdb_id not in _values:
            try:
                value = None
                with gzip.open(CACHE_FILE, 'rt', encoding='utf-8') as data:
                    next(data)
                    for line in data:
                        title, rating, votes = line.strip().split('\t')
                        if title == imdb_id:
                            if 0 < float(rating) <= 10 and int(votes) > 0:
                                value = (rating, votes)
                            break
                _values[imdb_id] = value
            except (OSError, ValueError, EOFError):
                return {'status': 'unavailable', 'rating': None, 'votes': None}
        value = _values[imdb_id]
        stale = failed or time.time() - CACHE_FILE.stat().st_mtime >= TTL
        return {'status': 'cached' if stale else 'ok' if value else 'unrated',
                'rating': value[0] if value else None, 'votes': value[1] if value else None}


def cached_rating(imdb_id):
    """Metadata enrichment must not wait for a complete dataset download."""
    if not _lock.acquire(blocking=False):
        return None, None
    try:
        value = _values.get(imdb_id)
        return value if value else (None, None)
    finally:
        _lock.release()
