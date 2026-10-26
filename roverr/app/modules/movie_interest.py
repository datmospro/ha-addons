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
