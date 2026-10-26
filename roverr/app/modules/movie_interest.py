"""Small cached TMDB snapshot; signals describe reach, never film quality."""
import math
import threading
import time
import requests

_cache = {}
_lock = threading.Lock()
TTL = 21600


def number(value, integer=False):
    try:
        value = float(value)
        if not math.isfinite(value) or value < 0:
            return None
        return int(value) if integer else value
    except (TypeError, ValueError, OverflowError):
        return None


def get_interest(tmdb_id, api_key):
    try:
        movie_id = int(tmdb_id)
    except (TypeError, ValueError):
        return {'status': 'unidentified'}
    if movie_id <= 0:
        return {'status': 'unidentified'}
    if not api_key:
        return {'status': 'unavailable'}
    with _lock:
        previous = _cache.get(movie_id)
        if previous and time.time() - previous[0] < previous[2]:
            return dict(previous[1])
        try:
            response = requests.get(f'https://api.themoviedb.org/3/movie/{movie_id}',
                                    params={'api_key': api_key}, timeout=(3, 6))
            response.raise_for_status()
            data = response.json()
            if data.get('id') != movie_id:
                raise ValueError('Unexpected movie identity')
            result = {'status': 'ok', 'tmdb_id': movie_id,
                      'popularity': number(data.get('popularity')),
                      'votes': number(data.get('vote_count'), True),
                      'vote_average': number(data.get('vote_average')),
                      'budget': number(data.get('budget'), True) or None,
                      'revenue': number(data.get('revenue'), True) or None,
                      'updated_at': int(time.time())}
            ttl = TTL
        except (requests.RequestException, ValueError, TypeError, AttributeError):
            result = dict(previous[1], status='cached') if previous and previous[1].get('popularity') is not None else {'status': 'unavailable', 'tmdb_id': movie_id}
            ttl = 60
        if len(_cache) >= 256 and movie_id not in _cache:
            del _cache[next(iter(_cache))]
        _cache[movie_id] = (time.time(), result, ttl)
        return dict(result)


_worker_lock = threading.Lock()
_worker_running = False
_retry_after = {}


def save_interest(movie_id, data):
    from datetime import datetime
    from database import Movie
    if data.get('status') != 'ok' or data.get('popularity') is None:
        return False
    changes = {'tmdb_popularity': data['popularity'], 'interest_updated_at': datetime.fromtimestamp(data.get('updated_at') or time.time())}
    if data.get('votes') is not None:
        changes['vote_count'] = data['votes']
    if data.get('vote_average') is not None:
        changes['vote_average'] = data['vote_average']
    Movie.update(**changes).where(Movie.tmdb_id == movie_id).execute()
    return True


def _update_movies(ids, api_key):
    global _worker_running
    from .config import trigger_movies_update_callback, logger
    changed = False
    try:
        for movie_id in ids:
            try:
                data = get_interest(movie_id, api_key)
                changed = save_interest(movie_id, data) or changed
                _retry_after[movie_id] = (data.get('updated_at', time.time()) + TTL) if data.get('status') == 'ok' else time.time() + 60
            except Exception:
                _retry_after[movie_id] = time.time() + 60
                logger.warning('No se pudo actualizar el interés de una película; se reintentará')
    finally:
        with _worker_lock:
            _worker_running = False
        if changed:
            trigger_movies_update_callback()


def schedule_interest_updates(movies, api_key):
    """Warm and persist dashboard data without waiting for movie details."""
    global _worker_running
    if not api_key:
        return
    now = time.time()
    ids = []
    for movie in movies:
        movie_id = movie.get('tmdb_id')
        updated = movie.get('interest_updated_at')
        if not movie_id or (updated and now - updated < TTL) or _retry_after.get(movie_id, 0) > now:
            continue
        if movie_id not in ids:
            ids.append(movie_id)
        if len(ids) == 20:
            break
    if not ids:
        return
    with _worker_lock:
        if _worker_running:
            return
        _worker_running = True
    threading.Thread(target=_update_movies, args=(ids, api_key), daemon=True).start()
