import os
import json
import logging

LOG_LEVELS = {
    "Basic": logging.WARNING,
    "Standard": logging.INFO,
    "Verbose": logging.DEBUG
}

def get_log_level():
    """Get log level from Home Assistant options"""
    try:
        options_file = "/data/options.json"
        if os.path.exists(options_file):
            with open(options_file, 'r') as f:
                options = json.load(f)
                level_name = options.get('log_level', 'Standard')
                return LOG_LEVELS.get(level_name, logging.INFO)
    except Exception:
        pass
    return logging.INFO  # Default fallback

# Configurar logging con nivel dinámico
logging.basicConfig(
    level=get_log_level(),
    format='%(levelname)s:%(name)s:%(message)s'
)
logger = logging.getLogger("Roverr")

# Callback for notifying main app when movies change
ON_MOVIES_UPDATE_CALLBACK = None

def register_movies_update_callback(callback):
    global ON_MOVIES_UPDATE_CALLBACK
    ON_MOVIES_UPDATE_CALLBACK = callback
    logger.info("Registered movies update callback")

def trigger_movies_update_callback():
    global ON_MOVIES_UPDATE_CALLBACK
    if ON_MOVIES_UPDATE_CALLBACK:
        try:
            import asyncio
            if asyncio.iscoroutinefunction(ON_MOVIES_UPDATE_CALLBACK):
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(ON_MOVIES_UPDATE_CALLBACK())
                except RuntimeError:
                    # Run it in a new thread if no event loop is running in this thread
                    asyncio.run(ON_MOVIES_UPDATE_CALLBACK())
            else:
                ON_MOVIES_UPDATE_CALLBACK()
        except Exception as e:
            logger.error(f"Error executing movies update callback: {e}")

# Constants
MANUAL_SEARCH_TAG = "manual-search-autocopy"
SETTINGS_FILE = "/data/settings.json"
DEFAULT_SETTINGS = {
    "qb_host": "localhost",
    "qb_port": 8080,
    "qb_user": "admin",
    "qb_pass": "adminpass",
    "local_source_path": "",
    "local_dest_path": "",
    "tmdb_api_key": "",
    "copy_speed_limit": 10,
    "auto_copy_manual_search": False,
    "indexers": [],
    "rss_feeds": [],
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    "telegram_notify_on_new_movie": True,
    "telegram_notify_on_download_complete": True,
    "telegram_notify_on_move": True,
    "language": "es-ES",  # Default to Spanish for backwards compatibility
    "backdrop_blur": 35,
    "backdrop_opacity": 18,
    "min_year": ""
}

def load_settings():
    if not os.path.exists(SETTINGS_FILE):
        save_settings(DEFAULT_SETTINGS)
        return DEFAULT_SETTINGS
    try:
        with open(SETTINGS_FILE, 'r') as f:
            settings = json.load(f)
            # Merge with defaults to ensure all keys exist
            for key, val in DEFAULT_SETTINGS.items():
                if key not in settings:
                    settings[key] = val
            return settings
    except:
        return DEFAULT_SETTINGS

def get_language():
    """
    Get configured language for TMDB API and other services.
    Returns the language code (e.g., 'es-ES', 'en-US') from settings.
    Defaults to 'es-ES' for backwards compatibility.
    """
    settings = load_settings()
    return settings.get('language', 'es-ES')

def save_settings(settings):
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(settings, f, indent=4)

