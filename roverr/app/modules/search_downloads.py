"""Manual download admission and explicit restoration of ignored movies."""
import base64
import re
import time
from urllib.parse import parse_qs, urlparse

from database import Movie
from .automation import normalize_title
from .mover import clean_torrent_name


def magnet_hash(url):
    for value in parse_qs(urlparse(url or '').query).get('xt', []):
        if value.lower().startswith('urn:btih:'):
            value = value.rsplit(':', 1)[-1]
            if re.fullmatch(r'[a-fA-F0-9]{40}', value):
                return value.lower()
            if re.fullmatch(r'[a-zA-Z2-7]{32}', value):
                return base64.b32decode(value.upper()).hex()
    return None


def ignored_matches(title='', year=None, tmdb_id=None, original_title='', torrent_hash=None):
    titles = {normalize_title(value) for value in (title, original_title) if value}
    matches = []
    for movie in Movie.select().where(Movie.ignored == True):
        if torrent_hash and movie.torrent_hash.lower() == torrent_hash.lower():
            matches.append(movie)
            continue
        if tmdb_id and movie.tmdb_id:
            if str(tmdb_id) == str(movie.tmdb_id):
                matches.append(movie)
            continue
        # Unidentified records need an exact title AND a known matching year.
        parsed_title, parsed_year = clean_torrent_name(movie.torrent_name or '')
        movie_titles = {normalize_title(value) for value in (movie.title, parsed_title) if value}
        if year and str(year) == str(movie.year or parsed_year) and titles & movie_titles:
            matches.append(movie)
    return matches


def annotate_ignored(results):
    for result in results:
        matches = ignored_matches(result.get('title'), result.get('year'),
                                  result.get('tmdb_id'), result.get('original_title', ''))
        result['ignored'] = bool(matches)
    return results


def download_requested(payload, qb, auto_copy, manual_tag):
    url = payload.get('url')
    release = payload.get('title') or ''
    parsed_title, parsed_year = clean_torrent_name(release)
    identity = dict(title=payload.get('movie_title') or parsed_title,
                    year=payload.get('movie_year') or parsed_year,
                    tmdb_id=payload.get('tmdb_id'),
                    original_title=payload.get('original_title') or '')
    expected = magnet_hash(url)
    restore = payload.get('restore_ignored') is True

    def blocked():
        return {'success':False, 'status':'ignored', 'ignored':True,
                'message':'Esta película está en la lista de ignorados. Pulsa Restaurar y descargar para continuar.'}

    matches = ignored_matches(**identity, torrent_hash=expected)
    if matches and not restore:
        return blocked()

    qb.auth_log_in()
    before = list(qb.torrents_info())
    def release_key(name):
        return normalize_title(re.sub(r'\.(mkv|mp4|avi|torrent)$', '', name or '', flags=re.I))

    def requested(torrents):
        if expected:
            # With an infohash, a title match alone must never identify another release.
            return next((t for t in torrents if t['hash'].lower() == expected), None)
        same = [t for t in torrents if release_key(t['name']) == release_key(release)]
        return same[0] if len(same) == 1 else None

    torrent = requested(before)
    if torrent:
        matches = ignored_matches(**identity, torrent_hash=torrent['hash'])
        if matches and not restore:
            return blocked()
        if auto_copy:
            qb.torrents_add_tags(torrent_hashes=torrent['hash'], tags=manual_tag)
    else:
        result = qb.torrents_add(urls=url, **({'tags':manual_tag} if auto_copy else {}))
        if isinstance(result, str) and result.strip().lower().startswith('fail'):
            return {'success':False, 'message':'qBittorrent ha rechazado el torrent. No se ha cambiado la lista de ignorados.'}

    # Only restore after qBittorrent has accepted the request. Keep all history,
    # metadata and independent copy pause/conflict decisions intact.
    restored = 0
    if restore and matches:
        with Movie._meta.database.atomic():
            restored = Movie.update(ignored=False, ignored_at=None).where(
                Movie.torrent_hash.in_([m.torrent_hash for m in matches]), Movie.ignored == True).execute()

    if not torrent:
        for _ in range(5):
            time.sleep(1)
            torrent = requested(list(qb.torrents_info()))
            if torrent:
                break

    if torrent:
        late_matches = ignored_matches(**identity, torrent_hash=torrent['hash'])
        if late_matches:
            if not restore:
                return blocked()
            with Movie._meta.database.atomic():
                restored += Movie.update(ignored=False, ignored_at=None).where(
                    Movie.torrent_hash.in_([m.torrent_hash for m in late_matches]), Movie.ignored == True).execute()

    message = f'Película restaurada. Torrent añadido: {release}' if restored else f'Torrent añadido: {release}'
    if not torrent:
        message += '. Pendiente de confirmación del cliente; aparecerá cuando se detecte el torrent.'
    return {'success':True, 'message':message, 'hash':torrent['hash'] if torrent else None,
            'restored':restored, 'pending_confirmation':not bool(torrent)}
