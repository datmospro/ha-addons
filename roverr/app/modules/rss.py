import os
import re
import time
import asyncio
import hashlib
import requests
from datetime import datetime
from database import Movie
from .config import logger, load_settings, get_language, trigger_movies_update_callback
from .client import get_qb_client, check_torrent_size_available
from .mover import clean_torrent_name
from .tmdb import fetch_complete_movie_metadata, download_image
from .indexers import auto_download_movie
from .notifications import send_telegram_notification

# Global state for RSS
RSS_LAST_FETCH = {} # {feed_url: timestamp} - Track last fetch time for each RSS feed

def test_rss_feed(url):
    """
    Tests an RSS feed by fetching and parsing it.
    Returns (success, message, feed_info)
    """
    import feedparser
    
    try:
        logger.info(f"Testing RSS feed: {url}")
        
        # Fetch and parse RSS feed
        feed = feedparser.parse(url)
        
        # Check for errors
        if feed.bozo:
            # Feed has errors but might still be parseable
            error = feed.get('bozo_exception', 'Unknown parsing error')
            logger.warning(f"RSS feed has parsing issues: {error}")
        
        # Check if we got any entries
        if not feed.entries:
            return False, "RSS feed is empty or invalid", None
        
        # Extract feed info
        feed_info = {
            'title': feed.feed.get('title', 'Unknown'),
            'description': feed.feed.get('description', ''),
            'entries_count': len(feed.entries),
            'latest_entry': feed.entries[0].get('title', 'N/A') if feed.entries else 'N/A'
        }
        
        logger.info(f"RSS feed valid: {feed_info['title']} ({feed_info['entries_count']} entries)")
        return True, f"RSS feed valid: {feed_info['entries_count']} entries found", feed_info
        
    except Exception as e:
        logger.error(f"RSS feed test error: {e}")
        return False, f"Error testing RSS feed: {str(e)}", None

def is_movie_ignored(title, year, tmdb_id, ignored_movies):
    def normalize(t):
        if not t: return ""
        return "".join(re.sub(r'[^\w\s]', '', t.lower()).split())
        
    norm_title = normalize(title)
    
    for m in ignored_movies:
        if tmdb_id and m.tmdb_id:
            if int(tmdb_id) == int(m.tmdb_id):
                return True
                
        norm_db_title = normalize(m.title)
        norm_db_torrent = normalize(m.torrent_name)
        
        title_matches = (norm_title == norm_db_title or (norm_db_torrent and norm_title == norm_db_torrent))
        
        year_matches = True
        if year and m.year:
            year_matches = str(year) == str(m.year)
            
        if title_matches and year_matches:
            return True
            
    return False

def get_watchlist_movie(title, year, tmdb_id, watchlist_movies):
    def normalize(t):
        if not t: return ""
        return "".join(re.sub(r'[^\w\s]', '', t.lower()).split())
        
    norm_title = normalize(title)
    
    for m in watchlist_movies:
        if tmdb_id and m.tmdb_id:
            if int(tmdb_id) == int(m.tmdb_id):
                return m
                
        norm_db_title = normalize(m.title)
        norm_db_torrent = normalize(m.torrent_name)
        
        title_matches = (norm_title == norm_db_title or (norm_db_torrent and norm_title == norm_db_torrent))
        
        year_matches = True
        if year and m.year:
            year_matches = str(year) == str(m.year)
            
        if title_matches and year_matches:
            return m
            
    return None

def is_duplicate_movie(title, year, tmdb_id, existing_movies):
    def normalize(t):
        if not t: return ""
        return "".join(re.sub(r'[^\w\s]', '', t.lower()).split())
        
    norm_title = normalize(title)
    
    for m in existing_movies:
        if tmdb_id and m.tmdb_id:
            if int(tmdb_id) == int(m.tmdb_id):
                return True
                
        norm_db_title = normalize(m.title)
        norm_db_torrent = normalize(m.torrent_name)
        
        title_matches = (norm_title == norm_db_title or (norm_db_torrent and norm_title == norm_db_torrent))
        
        year_matches = True
        if year and m.year:
            year_matches = str(year) == str(m.year)
            
        if title_matches and year_matches:
            return True
            
    return False

def fetch_rss_movies(limit=30):
    """
    Fetch movies from all RSS feeds and add them to the database
    """
    logger.info("=" * 80)
    logger.info("­ƒôí [RSS] RSS FETCH STARTED")
    logger.info("=" * 80)
    
    settings = load_settings()
    feeds = settings.get('rss_feeds', [])
    api_key = settings.get('tmdb_api_key')
    
    ignored_movies = list(Movie.select().where(Movie.ignored == True))
    watchlist_movies = list(Movie.select().where(Movie.watchlist == True))
    existing_movies = list(Movie.select().where(
        (Movie.ignored == False) & 
        ((Movie.watchlist == False) | (Movie.watchlist.is_null()))
    ))
    
    if not feeds:
        logger.warning("ÔÜá´©Å  [RSS] No RSS feeds configured")
        return {"success": False, "message": "No RSS feeds configured"}
        
    # Create map for easy config lookup
    feed_map = {f.get('name'): f for f in feeds}
    
    import feedparser
    all_entries = []
    
    # 1. Fetch from all feeds
    logger.info(f"­ƒôÑ [RSS] Fetching from {len(feeds)} configured feed(s)")
    for feed_config in feeds:
        url = feed_config.get('url')
        feed_name = feed_config.get('name', 'Unknown')
        if not url: continue
        
        try:
            logger.debug(f"­ƒöº [RSS] Fetching feed: {feed_name}")
            feed = feedparser.parse(url)
            
            for entry in feed.entries:
                # Extract basic info
                title = entry.get('title', 'Unknown')
                link = entry.get('link', '')
                
                # Extract TMDB ID from description if available
                tmdb_id = None
                description = entry.get('description', '') or entry.get('summary', '')
                if description:
                    # Look for TMDB Link: <a href="https://anon.to?https://www.themoviedb.org/movie/23168">23168</a>
                    import re
                    tmdb_match = re.search(r'themoviedb\.org/movie/(\d+)', description)
                    if tmdb_match:
                        tmdb_id = tmdb_match.group(1)
                        logger.debug(f"Extracted TMDB ID {tmdb_id} from RSS entry: {title}")
                
                # Parse date
                published = None
                if hasattr(entry, 'published_parsed'):
                    published = datetime.fromtimestamp(time.mktime(entry.published_parsed))
                elif hasattr(entry, 'updated_parsed'):
                    published = datetime.fromtimestamp(time.mktime(entry.updated_parsed))
                else:
                    published = datetime.now()
                
                all_entries.append({
                    'title': title,
                    'link': link,
                    'published': published,
                    'feed_name': feed_config.get('name', 'Unknown'),
                    'tmdb_id': tmdb_id  # Include TMDB ID if found
                })
                
        except Exception as e:
            logger.error(f"Error fetching feed {url}: {e}")
            
    # 2. Deduplicate and Sort
    # Sort by date desc
    all_entries.sort(key=lambda x: x['published'], reverse=True)
    
    unique_entries = []
    seen_titles = set()
    
    for entry in all_entries:
        # Clean title to improve deduplication
        clean_title, year = clean_torrent_name(entry['title'])
        key = f"{clean_title}_{year}" if year else clean_title
        
        if key not in seen_titles:
            seen_titles.add(key)
            unique_entries.append(entry)
            
        if len(unique_entries) >= limit:
            break
            
    # 3. Add to Database
    logger.info(f"Processing {len(unique_entries)} unique entries from RSS feeds (limit: {limit})")
    added_count = 0
    added_movies = []
    
    for entry in unique_entries:
        try:
            # Generate a unique pseudo-hash for RSS items
            # Use MD5 of (title + year + timestamp) to ensure uniqueness
            
            # If TMDB ID is available, fetch exact title and year from TMDB
            title = None
            year = None
            if entry.get('tmdb_id'):
                try:
                    tmdb_url = f"https://api.themoviedb.org/3/movie/{entry['tmdb_id']}"
                    params = {"api_key": api_key, "language": get_language()}
                    res = requests.get(tmdb_url, params=params, timeout=5)
                    if res.status_code == 200:
                        tmdb_data = res.json()
                        title = tmdb_data.get('title')
                        year = tmdb_data.get('release_date', '')[:4] if tmdb_data.get('release_date') else None
                        logger.info(f"Using TMDB ID {entry['tmdb_id']} ÔåÆ Exact match: '{title}' ({year})")
                except Exception as e:
                    logger.warning(f"Failed to fetch TMDB data for ID {entry['tmdb_id']}: {e}")
            
            # Fallback to parsing title from RSS entry if TMDB failed or not available
            if not title:
                title, year = clean_torrent_name(entry['title'])
            
            unique_string = f"{title}_{year}_{entry['published'].isoformat()}_{entry['link']}"
            pseudo_hash = hashlib.md5(unique_string.encode()).hexdigest()
            logger.info(f"Generated pseudo_hash for RSS: '{title}' ({year}) -> {pseudo_hash[:8]}... from link: {entry['link'][:50]}...")
            
            # Check if exists by hash first (exact same RSS entry)
            if Movie.select().where(Movie.torrent_hash == pseudo_hash).exists():
                logger.info(f"RSS movie '{title}' ({year}) already exists with exact hash {pseudo_hash[:8]}..., skipping")
                continue

            # Year filtering check (only for RSS entry)
            feed_config = feed_map.get(entry['feed_name'])
            min_year = feed_config.get('min_year') if feed_config else None
            if min_year:
                try:
                    min_year_val = int(min_year)
                    if year and int(year) < min_year_val:
                        logger.info(f"Skipping RSS movie '{title}' ({year}) as it is older than minimum year filter {min_year_val}. Auto-ignoring in DB.")
                        # Save in DB as ignored to avoid duplicate checks in future
                        Movie.create(
                            torrent_hash=pseudo_hash,
                            title=title,
                            year=year,
                            ignored=True,
                            ignored_at=datetime.now(),
                            state='rss',
                            status='new',
                            torrent_name=entry['title'],
                            overview=f"Auto-ignored: released before {min_year_val}"
                        )
                        continue
                except ValueError:
                    pass
            
            # First check if movie is ignored (skip completely - no RSS entry, no auto-download)
            if is_movie_ignored(title, year, entry.get('tmdb_id'), ignored_movies):
                logger.info(f"Movie '{title}' ({year}) is in ignored list. Skipping RSS entry.")
                continue
            
            # CHECK IF MOVIE IS IN WATCHLIST
            watchlist_movie = get_watchlist_movie(title, year, entry.get('tmdb_id'), watchlist_movies)
            if watchlist_movie:
                # Movie is in watchlist - check expiration and size
                if watchlist_movie.watchlist_expiry and datetime.now() > watchlist_movie.watchlist_expiry:
                    # Watchlist expired - move to dashboard as "New" (no auto-download)
                    logger.info(f"Watchlist expired for '{title}' ({year}). Adding to dashboard as New.")
                    watchlist_movie.watchlist = False
                    watchlist_movie.watchlist_expiry = None
                    watchlist_movie.save()
                    # Continue to add to dashboard below (will NOT auto-download due to flag cleared)
                else:
                    # Still in watchlist - check if size is now acceptable
                    logger.info(f"Movie '{title}' ({year}) is in watchlist. Checking for acceptable size...")
                    
                    # Get feed config for size preferences
                    feed_config = feed_map.get(entry['feed_name'])
                    if feed_config:
                        preferred_size = int(feed_config.get('preferred_size', 0))
                        max_size = int(feed_config.get('max_size', 0))
                        
                        # Check if torrent with acceptable size exists
                        size_found = check_torrent_size_available(title, year, preferred_size, max_size)
                        
                        if size_found:
                            # Size is acceptable now - remove from watchlist and proceed with auto-download
                            logger.info(f"Acceptable size found for '{title}' ({year}). Removing from watchlist, proceeding with auto-download.")
                            watchlist_movie.watchlist = False
                            watchlist_movie.watchlist_expiry = None
                            watchlist_movie.save()
                            # Falls through to auto-download section below
                        else:
                            # Size still not acceptable - keep in watchlist
                            logger.info(f"Size not acceptable for '{title}' ({year}). Keeping in watchlist.")
                            continue
                    else:
                        # No feed config - keep in watchlist
                        logger.info(f"No feed config for watchlist movie '{title}'. Keeping in watchlist.")
                        continue
                
            # CRITICAL FIX: Check if movie already exists in dashboard by title+year (not ignored, not watchlist)
            # This prevents duplicate entries for the same movie in different qualities/formats
            if is_duplicate_movie(title, year, entry.get('tmdb_id'), existing_movies):
                logger.info(f"Movie '{title}' ({year}) already exists in dashboard. Skipping duplicate RSS entry.")
                continue
            
            # CHECK FOR AUTO-DOWNLOAD (only for new, non-ignored movies)
            feed_config = feed_map.get(entry['feed_name'])
            if feed_config and feed_config.get('auto_add'):
                preferred_size = int(feed_config.get('preferred_size', 0))
                max_size = int(feed_config.get('max_size', 0))
                feed_label = feed_config.get('label', '')
                
                # First check if torrent already exists in torrent client
                # If it does, DON'T auto-download but DO add to dashboard as RSS entry
                try:
                    qb = get_qb_client(settings)
                    qb.auth_log_in()
                    existing_torrents = qb.torrents_info()
                    
                    # Check if any torrent matches this movie (by title/year)
                    torrent_exists = False
                    for t in existing_torrents:
                        t_title, t_year = clean_torrent_name(t['name'])
                        if t_title.lower() == title.lower() and (not year or str(t_year) == str(year)):
                            logger.info(f"Movie '{title}' ({year}) already exists in torrent client. Skipping duplicate RSS entry.")
                            torrent_exists = True
                            break
                    
                    if torrent_exists:
                        # Skip this entry entirely - no auto-download, no RSS entry
                        continue
                    
                    # Torrent doesn't exist, proceed with auto-download
                    logger.info(f"Auto-download enabled for {title} from feed '{entry['feed_name']}' with label '{feed_label}'")
                    
                    # Get TMDB ID from entry for intelligent multi-language search
                    entry_tmdb_id = entry.get('tmdb_id')
                    if entry_tmdb_id:
                        logger.info(f"Using TMDB ID {entry_tmdb_id} for intelligent multi-language search")
                    
                    torrent_hash, torrent_name, download_reason = auto_download_movie(
                        title, year, preferred_size, max_size, 
                        label=feed_label, 
                        tmdb_id=entry_tmdb_id
                    )
                    if torrent_hash:
                        logger.info(f"Successfully auto-downloaded {title} from RSS. Adding to DB with real hash.")
                        
                        # Fetch Metadata (same as non-auto-download path)
                        metadata = None
                        if api_key:
                            metadata = fetch_complete_movie_metadata(title, year, api_key, tmdb_id=entry_tmdb_id)
                        
                        poster_local = None
                        backdrop_local = None
                        
                        if metadata:
                            # Download Images using torrent hash (not pseudo-hash)
                            if metadata.get('poster_path'):
                                poster_url = f"https://image.tmdb.org/t/p/w500{metadata.get('poster_path')}"
                                poster_local = download_image(poster_url, f"{torrent_hash}_poster.jpg")
                                
                            if metadata.get('backdrop_path'):
                                backdrop_url = f"https://image.tmdb.org/t/p/w1280{metadata.get('backdrop_path')}"
                                backdrop_local = download_image(backdrop_url, f"{torrent_hash}_backdrop.jpg")
                        
                        # Create DB Entry with REAL torrent hash
                        try:
                            Movie.create(
                                torrent_hash=torrent_hash,
                                title=metadata.get('title', title) if metadata else title,
                                year=metadata.get('year', year) if metadata else year,
                                poster_path=poster_local,
                                backdrop_path=backdrop_local,
                                overview=metadata.get('overview') if metadata else "Auto-downloaded from RSS",
                                runtime=metadata.get('runtime') if metadata else 0,
                                genres=metadata.get('genres') if metadata else None,
                                state='downloading',  # Mark as downloading (not 'rss')
                                progress=0.0,
                                size=0,
                                status='new',
                                cast=metadata.get('cast') if metadata else None,
                                crew=metadata.get('crew') if metadata else None,
                                vote_average=metadata.get('vote_average') if metadata else 0,
                                vote_count=metadata.get('vote_count') if metadata else 0,
                                imdb_id=metadata.get('imdb_id') if metadata else None,
                                imdb_rating=metadata.get('imdb_rating') if metadata else None,
                                imdb_votes=metadata.get('imdb_votes') if metadata else None,
                                tmdb_id=int(entry_tmdb_id) if entry_tmdb_id else None,  # Save TMDB ID for intelligent search
                                country_code=metadata.get('country_code') if metadata else None,  # Save country code for flag display
                                metadata_updated_at=datetime.now(),
                                torrent_name=torrent_name
                            )
                            logger.info(f"Created DB entry for auto-downloaded movie: {title} ({year})")
                            
                            # Notify Telegram: New Movie Found (RSS Auto-Download)
                            settings = load_settings()
                            if settings.get('telegram_notify_on_new_movie', True):
                                movie_title = metadata.get('title', title) if metadata else title
                                movie_year = metadata.get('year', year) if metadata else year
                                send_telegram_notification(f"­ƒåò <b>New Movie Found</b>\n\n­ƒÄ¼ {movie_title} ({movie_year})\n­ƒôÑ Auto-downloaded from RSS.")
                            
                        except Exception as create_error:
                            # Handle race condition: sync_movies may have already created this entry
                            if "UNIQUE constraint failed" in str(create_error):
                                logger.info(f"Movie '{title}' ({year}) already added to DB by sync_movies (race condition). Updating with RSS metadata.")
                                
                                # Update the existing entry with proper metadata
                                try:
                                    existing_movie = Movie.get(Movie.torrent_hash == torrent_hash)
                                    
                                    # Update all metadata fields
                                    existing_movie.title = metadata.get('title', title) if metadata else title
                                    existing_movie.year = metadata.get('year', year) if metadata else year
                                    existing_movie.poster_path = poster_local
                                    existing_movie.backdrop_path = backdrop_local
                                    existing_movie.overview = metadata.get('overview') if metadata else "Auto-downloaded from RSS"
                                    existing_movie.runtime = metadata.get('runtime') if metadata else 0
                                    existing_movie.genres = metadata.get('genres') if metadata else None
                                    existing_movie.cast = metadata.get('cast') if metadata else None
                                    existing_movie.crew = metadata.get('crew') if metadata else None
                                    existing_movie.vote_average = metadata.get('vote_average') if metadata else 0
                                    existing_movie.vote_count = metadata.get('vote_count') if metadata else 0
                                    existing_movie.imdb_id = metadata.get('imdb_id') if metadata else None
                                    existing_movie.imdb_rating = metadata.get('imdb_rating') if metadata else None
                                    existing_movie.imdb_votes = metadata.get('imdb_votes') if metadata else None
                                    existing_movie.tmdb_id = int(entry_tmdb_id) if entry_tmdb_id else None  # Save TMDB ID
                                    existing_movie.metadata_updated_at = datetime.now()
                                    existing_movie.torrent_name = torrent_name
                                    
                                    # Override status to 'new' - this was just auto-downloaded from RSS
                                    # Fixes race condition where sync_movies assigns incorrect 'pending' status
                                    existing_movie.status = 'new'
                                    
                                    existing_movie.save()
                                    logger.info(f"Successfully updated existing movie '{title}' ({year}) with RSS metadata")
                                    
                                except Exception as update_error:
                                    logger.error(f"Failed to update existing movie '{title}' with RSS metadata: {update_error}")
                            else:
                                logger.error(f"Error creating DB entry for '{title}': {create_error}")
                        
                        added_count += 1
                        continue  # Skip the normal RSS entry creation path

                    else:
                        # Auto-download failed - create RSS entry with reason
                        logger.info(f"Auto-download failed for {title}: {download_reason}. Creating RSS entry.")
                        
                        # Fetch Metadata for the failed entry
                        metadata = None
                        if api_key:
                            metadata = fetch_complete_movie_metadata(title, year, api_key, tmdb_id=entry_tmdb_id)
                        
                        poster_local = None
                        backdrop_local = None
                        
                        if metadata:
                            if metadata.get('poster_path'):
                                poster_url = f"https://image.tmdb.org/t/p/w500{metadata.get('poster_path')}"
                                poster_local = download_image(poster_url, f"{pseudo_hash}_poster.jpg")
                            if metadata.get('backdrop_path'):
                                backdrop_url = f"https://image.tmdb.org/t/p/w1280{metadata.get('backdrop_path')}"
                                backdrop_local = download_image(backdrop_url, f"{pseudo_hash}_backdrop.jpg")
                        else:
                            poster_local = 'posters/placeholder_unidentified.png'
                        
                        Movie.create(
                            torrent_hash=pseudo_hash,
                            title=metadata.get('title', title) if metadata else title,
                            year=metadata.get('year', year) if metadata else year,
                            poster_path=poster_local,
                            backdrop_path=backdrop_local,
                            overview=metadata.get('overview') if metadata else "Imported from RSS",
                            runtime=metadata.get('runtime') if metadata else 0,
                            genres=metadata.get('genres') if metadata else None,
                            state='rss',
                            progress=0.0,
                            size=0,
                            status='new',
                            status_reason=download_reason,  # Save the reason for failure
                            cast=metadata.get('cast') if metadata else None,
                            crew=metadata.get('crew') if metadata else None,
                            vote_average=metadata.get('vote_average') if metadata else 0,
                            vote_count=metadata.get('vote_count') if metadata else 0,
                            imdb_id=metadata.get('imdb_id') if metadata else None,
                            imdb_rating=metadata.get('imdb_rating') if metadata else None,
                            imdb_votes=metadata.get('imdb_votes') if metadata else None,
                            tmdb_id=int(entry_tmdb_id) if entry_tmdb_id else None,
                            metadata_updated_at=datetime.now(),
                            torrent_name=entry['title']
                        )
                        
                        if settings.get('telegram_notify_on_new_movie', True):
                            movie_title = metadata.get('title', title) if metadata else title
                            movie_year = metadata.get('year', year) if metadata else year
                            send_telegram_notification(f"­ƒåò <b>New Movie Found</b>\n\n­ƒÄ¼ {movie_title} ({movie_year})\nÔÜá´©Å {download_reason}")
                        
                        added_count += 1
                        added_movies.append(entry['title'])
                        continue

                except Exception as e:
                    # Catch errors from torrent client check or auto_download_movie (NOT from Movie.create)
                    logger.error(f"Error in auto-download process: {e}")
                    # Continue to next entry instead of falling through to RSS entry creation
                    continue
            
            logger.info(f"Adding RSS movie: {entry['title']}")
            
            # Fetch Metadata
            title, year = clean_torrent_name(entry['title'])
            metadata = None
            if api_key:
                metadata = fetch_complete_movie_metadata(title, year, api_key)
            
            poster_local = None
            backdrop_local = None
            
            if metadata:
                # Download Images
                if metadata.get('poster_path'):
                    poster_url = f"https://image.tmdb.org/t/p/w500{metadata.get('poster_path')}"
                    poster_local = download_image(poster_url, f"{pseudo_hash}_poster.jpg")
                    
                if metadata.get('backdrop_path'):
                    backdrop_url = f"https://image.tmdb.org/t/p/w1280{metadata.get('backdrop_path')}"
                    backdrop_local = download_image(backdrop_url, f"{pseudo_hash}_backdrop.jpg")
            else:
                # TMDB not found - use placeholder
                logger.warning(f"TMDB metadata not found for '{title}' ({year}), using placeholder")
                poster_local = 'posters/placeholder_unidentified.png'
            
            # Create DB Entry (for feeds without auto_add)
            Movie.create(
                torrent_hash=pseudo_hash,
                title=metadata.get('title', title) if metadata else title,
                year=metadata.get('year', year) if metadata else year,
                poster_path=poster_local,
                backdrop_path=backdrop_local,
                overview=metadata.get('overview') if metadata else "Imported from RSS",
                runtime=metadata.get('runtime') if metadata else 0,
                genres=metadata.get('genres') if metadata else None,
                state='rss',
                progress=0.0,
                size=0,
                status='new', # Changed from 'rss_new' to 'new' per user request
                status_reason="Auto-download disabled for this feed",  # Reason for 'new' status
                cast=metadata.get('cast') if metadata else None,
                crew=metadata.get('crew') if metadata else None,
                vote_average=metadata.get('vote_average') if metadata else 0,
                vote_count=metadata.get('vote_count') if metadata else 0,
                imdb_id=metadata.get('imdb_id') if metadata else None,
                imdb_rating=metadata.get('imdb_rating') if metadata else None,
                imdb_votes=metadata.get('imdb_votes') if metadata else None,
                tmdb_id=int(entry.get('tmdb_id')) if entry.get('tmdb_id') else None,  # Save TMDB ID for intelligent search
                metadata_updated_at=datetime.now(),
                torrent_name=entry['title'] # Store original title
            )
            
            # Notify Telegram: New Movie Found (RSS - Not Auto-Downloaded)
            if settings.get('telegram_notify_on_new_movie', True):
                movie_title = metadata.get('title', title) if metadata else title
                movie_year = metadata.get('year', year) if metadata else year
                send_telegram_notification(f"­ƒåò <b>New Movie Found</b>\n\n­ƒÄ¼ {movie_title} ({movie_year})\n­ƒôÑ Added from RSS.")
            
            added_count += 1
            added_movies.append(entry['title'])
            
        except Exception as e:
            logger.error(f"Error adding RSS movie {entry['title']}: {e}")
            
    if added_count > 0:
        trigger_movies_update_callback()
            
    return {
        "success": True, 
        "added": added_count, 
        "movies": added_movies,
        "message": f"Added {added_count} new movies from RSS"
    }

def get_rss_refresh_status():
    """
    Returns information about the next RSS feed refresh.
    Returns: {
        "next_feed_name": str,
        "next_feed_url": str,
        "countdown_seconds": int,
        "has_feeds": bool
    }
    """
    settings = load_settings()
    rss_feeds = settings.get('rss_feeds', [])
    
    # Filter enabled feeds
    enabled_feeds = [f for f in rss_feeds if f.get('enabled', True)]
    
    if not enabled_feeds:
        return {
            "has_feeds": False,
            "next_feed_name": None,
            "next_feed_url": None,
            "countdown_seconds": 0
        }
    
    now = time.time()
    next_feed = None
    min_time_to_refresh = float('inf')
    
    for feed in enabled_feeds:
        url = feed.get('url')
        interval = feed.get('refresh_interval', 300)
        
        # Get last fetch time (initialized by scheduler on startup)
        last_fetch = RSS_LAST_FETCH.get(url, now)
        
        # Calculate next refresh time
        next_refresh_time = last_fetch + interval
        time_to_refresh = next_refresh_time - now
        
        # If it's time to refresh (or past due), set countdown to 0
        if time_to_refresh < 0:
            time_to_refresh = 0
        
        # Track the feed with the soonest refresh
        if time_to_refresh < min_time_to_refresh:
            min_time_to_refresh = time_to_refresh
            next_feed = feed
    
    if next_feed:
        return {
            "has_feeds": True,
            "next_feed_name": next_feed.get('name', 'Unknown'),
            "next_feed_url": next_feed.get('url'),
            "countdown_seconds": int(min_time_to_refresh)
        }
    
    return {
        "has_feeds": False,
        "next_feed_name": None,
        "next_feed_url": None,
        "countdown_seconds": 0
    }

async def rss_scheduler():
    """
    Background task that automatically fetches RSS feeds based on their refresh intervals.
    This runs continuously and checks every 10 seconds if any feed needs refreshing.
    """
    import asyncio
    
    logger.info("RSS Scheduler started")
    
    # Initialize RSS_LAST_FETCH for all feeds on first run (prevents immediate execution)
    settings = load_settings()
    rss_feeds = settings.get('rss_feeds', [])
    enabled_feeds = [f for f in rss_feeds if f.get('enabled', True)]
    
    current_time = time.time()
    for feed in enabled_feeds:
        url = feed.get('url')
        if url and url not in RSS_LAST_FETCH:
            # Initialize to current time so countdown starts from configured interval
            RSS_LAST_FETCH[url] = current_time
            logger.info(f"Initialized RSS timer for {feed.get('name', url)}")
    
    while True:
        try:
            settings = load_settings()
            rss_feeds = settings.get('rss_feeds', [])
            
            # Filter enabled feeds
            enabled_feeds = [f for f in rss_feeds if f.get('enabled', True)]
            
            if enabled_feeds:
                now = time.time()
                
                for feed in enabled_feeds:
                    url = feed.get('url')
                    interval = feed.get('refresh_interval', 300)
                    
                    # Get last fetch time (should exist from initialization, but fallback to now)
                    last_fetch = RSS_LAST_FETCH.get(url, now)
                    
                    # Check if it's time to refresh
                    if now - last_fetch >= interval:
                        logger.info(f"Auto-refreshing RSS feed: {feed.get('name', url)}")
                        
                        try:
                            # Call fetch_rss_movies (same as clicking "Fetch RSS" button)
                            result = fetch_rss_movies(limit=30)
                            
                            if result.get('success'):
                                logger.info(f"RSS auto-refresh successful: {result.get('message')}")
                            else:
                                logger.error(f"RSS auto-refresh failed: {result.get('message')}")
                            
                            # Update last fetch time
                            RSS_LAST_FETCH[url] = now
                            
                        except Exception as e:
                            logger.error(f"Error auto-refreshing RSS feed {url}: {e}")
            
            # Sleep for 10 seconds before checking again
            await asyncio.sleep(10)
            
        except Exception as e:
            logger.error(f"Error in RSS scheduler: {e}")
            await asyncio.sleep(10)

