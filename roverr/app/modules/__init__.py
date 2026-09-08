"""
Roverr Modular Backend
Exposes domain modules and unified access to all business logic symbols.
"""

from .config import (
    LOG_LEVELS, get_log_level, logger,
    ON_MOVIES_UPDATE_CALLBACK, register_movies_update_callback, trigger_movies_update_callback,
    MANUAL_SEARCH_TAG, SETTINGS_FILE, DEFAULT_SETTINGS,
    load_settings, save_settings, get_language
)
from .notifications import (
    send_telegram_notification, test_telegram_connection
)
from .backup import (
    backup_database
)
from .mover import (
    COPY_PROGRESS, STOP_FLAGS, RESERVED_SPACE, SPACE_LOCK,
    clean_torrent_name, sanitize_filename, sanitize_path_component,
    get_disk_free_space, get_dir_size, check_and_reserve_disk_space, release_disk_space_reservation,
    find_file_in_path, get_copy_progress, stop_copy, copy_with_progress,
    _poll_receptor_status, test_receptor_connection,
    manual_move, mark_as_moved, process_single_torrent
)
from .client import (
    _torrent_client_status, get_torrent_client_status, update_torrent_client_status,
    check_torrent_size_available, get_qb_client, process_torrents, get_active_torrents
)
from .tmdb import (
    _TMDB_SEARCH_CACHE, TMDB_CACHE_TTL, _TITLE_CACHE,
    get_cached_tmdb_result, cache_tmdb_result,
    download_image, download_image_background,
    is_series, scrape_imdb_rating,
    fetch_complete_movie_metadata, get_provider_local_logo, detect_source_info,
    get_movie_videos, sync_movies,
    enrich_missing_metadata_background, re_download_poster_background,
    get_movie_data, identify_movie, delete_movie,
    add_to_watchlist, get_watchlist_movies, remove_from_watchlist,
    get_movie_details, get_movie_titles_in_languages
)
from .indexers import (
    _PROWLARR_STATS_CACHE, PROWLARR_CACHE_TTL,
    get_prowlarr_stats, test_indexer_connection,
    calculate_title_similarity, is_word_match, filter_search_results,
    search_indexers, select_best_torrent, auto_download_movie
)
from .rss import (
    RSS_LAST_FETCH, test_rss_feed, is_movie_ignored,
    get_watchlist_movie, is_duplicate_movie, fetch_rss_movies,
    get_rss_refresh_status, rss_scheduler
)

__all__ = [
    'LOG_LEVELS', 'get_log_level', 'logger',
    'ON_MOVIES_UPDATE_CALLBACK', 'register_movies_update_callback', 'trigger_movies_update_callback',
    'MANUAL_SEARCH_TAG', 'SETTINGS_FILE', 'DEFAULT_SETTINGS',
    'load_settings', 'save_settings', 'get_language',
    'send_telegram_notification', 'test_telegram_connection',
    'backup_database',
    'COPY_PROGRESS', 'STOP_FLAGS', 'RESERVED_SPACE', 'SPACE_LOCK',
    'clean_torrent_name', 'sanitize_filename', 'sanitize_path_component',
    'get_disk_free_space', 'get_dir_size', 'check_and_reserve_disk_space', 'release_disk_space_reservation',
    'find_file_in_path', 'get_copy_progress', 'stop_copy', 'copy_with_progress',
    '_poll_receptor_status', 'test_receptor_connection',
    'manual_move', 'mark_as_moved', 'process_single_torrent',
    '_torrent_client_status', 'get_torrent_client_status', 'update_torrent_client_status',
    'check_torrent_size_available', 'get_qb_client', 'process_torrents', 'get_active_torrents',
    '_TMDB_SEARCH_CACHE', 'TMDB_CACHE_TTL', '_TITLE_CACHE',
    'get_cached_tmdb_result', 'cache_tmdb_result',
    'download_image', 'download_image_background',
    'is_series', 'scrape_imdb_rating',
    'fetch_complete_movie_metadata', 'get_provider_local_logo', 'detect_source_info',
    'get_movie_videos', 'sync_movies',
    'enrich_missing_metadata_background', 're_download_poster_background',
    'get_movie_data', 'identify_movie', 'delete_movie',
    'add_to_watchlist', 'get_watchlist_movies', 'remove_from_watchlist',
    'get_movie_details', 'get_movie_titles_in_languages',
    '_PROWLARR_STATS_CACHE', 'PROWLARR_CACHE_TTL',
    'get_prowlarr_stats', 'test_indexer_connection',
    'calculate_title_similarity', 'is_word_match', 'filter_search_results',
    'search_indexers', 'select_best_torrent', 'auto_download_movie',
    'RSS_LAST_FETCH', 'test_rss_feed', 'is_movie_ignored',
    'get_watchlist_movie', 'is_duplicate_movie', 'fetch_rss_movies',
    'get_rss_refresh_status', 'rss_scheduler'
]
