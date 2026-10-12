"""Reconcile RSS placeholders and admit completed downloads independently of UI."""
import re
import unicodedata
from database import Movie, MoveHistory
from .mover import clean_torrent_name, manual_move, get_copy_progress
from .config import MANUAL_SEARCH_TAG, logger


def normalize_title(title):
    title = unicodedata.normalize('NFKD', str(title or '').casefold())
    return ''.join(char for char in title if char.isalnum())


def same_movie(first, second):
    if first.tmdb_id and second.tmdb_id:
        return first.tmdb_id == second.tmdb_id
    if not first.year or not second.year or str(first.year) != str(second.year):
        return False
    def titles(movie):
        values = [movie.title]
        if movie.torrent_name:
            values.append(clean_torrent_name(movie.torrent_name)[0])
        return {normalize_title(value) for value in values if value}
    return bool(titles(first) & titles(second))


def reconcile_rss_movies(torrents):
    active = {torrent['hash'] for torrent in torrents}
    real_movies = list(Movie.select().where(Movie.torrent_hash.in_(active))) if active else []
    placeholders = list(Movie.select().where((Movie.state == 'rss') & (Movie.ignored == False)))
    for placeholder in placeholders:
        matches = [movie for movie in real_movies if not movie.ignored and same_movie(placeholder, movie)]
        if len(matches) != 1:
            continue
        real = matches[0]
        with Movie._meta.database.atomic():
            # Preserve user choices; remove only the synthetic RSS record.
            changes = {}
            if placeholder.rss_feed_name and not real.rss_feed_name:
                changes['rss_feed_name'] = placeholder.rss_feed_name
            if placeholder.auto_copy_requested:
                changes['auto_copy_requested'] = True
            if placeholder.copy_paused and placeholder.copy_pause_reason == 'manual':
                changes.update(copy_paused=True, copy_pause_reason='manual')
            if placeholder.watchlist and real.status not in ('moved', 'moved_manually'):
                changes.update(watchlist=True, watchlist_expiry=placeholder.watchlist_expiry)
            if changes:
                Movie.update(**changes).where(Movie.id == real.id).execute()
            placeholder.delete_instance()
        logger.info(f"Linked RSS placeholder '{placeholder.title}' to torrent {real.torrent_hash}")


def auto_copy_allowed(torrent, movie, settings):
    tags = {tag.strip() for tag in re.split(r'[,;]', torrent.get('tags') or '') if tag.strip()}
    category = torrent.get('category') or ''
    feeds = settings.get('rss_feeds', [])
    if movie.rss_feed_name:
        return any(feed.get('name') == movie.rss_feed_name and feed.get('enabled', True)
                   and feed.get('auto_copy', False) for feed in feeds)
    if any(feed.get('enabled', True) and feed.get('auto_copy', False)
           and feed.get('label') and (feed['label'] in tags or feed['label'] == category)
           for feed in feeds):
        return True
    return settings.get('auto_copy_manual_search', False) and MANUAL_SEARCH_TAG in tags


def queue_completed_movies(torrents, settings):
    for torrent in torrents:
        if torrent.get('progress', 0) < 1:
            continue
        movie = Movie.get_or_none(Movie.torrent_hash == torrent['hash'])
        if not movie or movie.ignored or movie.status != 'pending':
            continue
        history = MoveHistory.select().where(MoveHistory.torrent_name == torrent['name']).order_by(MoveHistory.timestamp.desc()).first()
        if not auto_copy_allowed(torrent, movie, settings):
            Movie.update(status_reason='La copia automática no está habilitada para este torrent').where(Movie.id == movie.id).execute()
            continue
        if movie.copy_paused:
            # Older versions recorded recovery holds without distinguishing
            # them from cancellation. Recover eligible pending work only when
            # there is neither an explicit hold nor a cancelled/error history.
            if movie.copy_pause_reason is None and history is None:
                Movie.update(copy_paused=False).where(Movie.id == movie.id).execute()
            else:
                reason = 'Copia detenida manualmente; pulsa Copy para iniciarla' if movie.copy_pause_reason == 'manual' or (history and history.status == 'cancelled') else 'Copia bloqueada; pulsa Copy para revisar el destino'
                Movie.update(status_reason=reason).where(Movie.id == movie.id).execute()
                continue
        result = manual_move(torrent['hash'], automatic=True)
        if result.get('success'):
            changes = {'status_reason': None}
            progress = get_copy_progress().get(torrent['hash'])
            if progress and progress.get('status') in ('queued', 'copying'):
                changes['status'] = progress['status']
            Movie.update(**changes).where(Movie.id == movie.id).execute()
        elif result.get('status') == 'conflict':
            Movie.update(status_reason='El destino ya existe; pulsa Copy para comparar y decidir').where(Movie.id == movie.id).execute()
        else:
            Movie.update(status_reason=result.get('message', 'No se pudo iniciar la copia automática')).where(Movie.id == movie.id).execute()
            logger.warning(f"Automatic copy not admitted for '{movie.title}': {result.get('message')}")
