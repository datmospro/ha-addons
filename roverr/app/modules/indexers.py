import os
import re
import time
import requests
import unicodedata
from .config import logger, load_settings
from .mover import clean_torrent_name
from .tmdb import get_movie_titles_in_languages
from .client import get_qb_client

_PROWLARR_STATS_CACHE = None
PROWLARR_CACHE_TTL = 300  # 5 minutes in seconds

def get_prowlarr_stats(indexer_config):
    """
    Consulta Prowlarr para obtener trackers configurados y sus idiomas.
    Args:
        indexer_config: Dict con 'url' y 'api_key' del indexer
    Returns:
        Dict con estad├¡sticas: {
            'success': bool,
            'tracker_count': int,
            'languages': list,
            'trackers': list,
            'message': str (en caso de error)
        }
    """
    try:
        url = indexer_config.get('url', '').rstrip('/')
        api_key = indexer_config.get('api_key', '')
        
        if not url or not api_key:
            return {
                'success': False,
                'message': 'Missing URL or API key'
            }
            
        # Check cache early
        cache_key = url
        if cache_key in _PROWLARR_STATS_CACHE:
            timestamp, cached_stats = _PROWLARR_STATS_CACHE[cache_key]
            if time.time() - timestamp < PROWLARR_CACHE_TTL:
                logger.debug(f"­ƒùä´©Å Prowlarr stats cache hit for {url}")
                return cached_stats
        
        # Detectar si la URL es de Prowlarr (formato: http://host:port/N/api)
        # Remover la parte "/api" y el n├║mero de indexer si existe
        base_url = url
        if '/api' in url:
            parts = url.split('/api')[0]
            # Remover n├║mero de indexer si existe (ej: /1/api -> quitar /1)
            base_url = re.sub(r'/\d+$', '', parts)
        
        # API de Prowlarr para listar indexers
        indexers_url = f"{base_url}/api/v1/indexer"
        headers = {"X-Api-Key": api_key}
        
        logger.info(f"Querying Prowlarr stats at: {indexers_url}")
        response = requests.get(indexers_url, headers=headers, timeout=10)
        
        if response.status_code != 200:
            logger.error(f"Prowlarr returned status {response.status_code}")
            return {
                'success': False,
                'message': f'Prowlarr returned status {response.status_code}'
            }
        
        indexers = response.json()
        
        # Extraer idiomas ├║nicos y contar trackers activos
        languages = set()
        tracker_count = 0
        tracker_details = []
        
        for idx in indexers:
            # Solo contar trackers habilitados
            is_enabled = idx.get('enable', True)
            if is_enabled:
                tracker_count += 1
                
                # Extraer idioma
                lang = idx.get('language')
                if lang:
                    languages.add(lang)
                
                # Guardar detalles del tracker
                tracker_details.append({
                    'name': idx.get('name', 'Unknown'),
                    'language': lang if lang else 'unknown',
                    'enabled': is_enabled
                })
        
        logger.info(f"Found {tracker_count} active trackers with languages: {languages}")
        
        result = {
            'success': True,
            'tracker_count': tracker_count,
            'languages': sorted(list(languages)),
            'trackers': tracker_details
        }
        
        # Save to cache
        _PROWLARR_STATS_CACHE[cache_key] = (time.time(), result)
        
        return result
        
    except requests.exceptions.Timeout:
        logger.error("Timeout connecting to Prowlarr")
        return {
            'success': False,
            'message': 'Timeout connecting to Prowlarr'
        }
    except requests.exceptions.RequestException as e:
        logger.error(f"Request error connecting to Prowlarr: {e}")
        return {
            'success': False,
            'message': f'Connection error: {str(e)}'
        }
    except Exception as e:
        logger.error(f"Error getting Prowlarr stats: {e}")
        return {
            'success': False,
            'message': str(e)
        }

def test_indexer_connection(url, api_key):
    """
    Tests the connection to a Torznab indexer by fetching its capabilities.
    """
    def check_response(resp):
        if resp.status_code == 200:
            content_type = resp.headers.get('Content-Type', '')
            if 'application/xml' in content_type or 'text/xml' in content_type or resp.text.strip().startswith('<?xml'):
                return True, "Connection successful"
            else:
                # Show snippet of what we received
                preview = resp.text[:100].replace('\n', ' ').replace('\r', '')
                return False, f"Connected, but response is not valid XML. Received: {preview}..."
        elif resp.status_code == 401:
            return False, "Unauthorized: Invalid API Key"
        else:
            return False, f"Connection failed: Status {resp.status_code}"

    try:
        # Clean URL
        url = url.rstrip('/')
        params = {'t': 'caps', 'apikey': api_key}
        
        logger.info(f"Testing indexer connection: {url}")
        response = requests.get(url, params=params, timeout=10)
        
        success, message = check_response(response)
        
        if success:
            return True, message
            
        # If failed and URL doesn't end with /api, try appending /api
        if not success and not url.endswith('/api'):
            alt_url = f"{url}/api"
            logger.info(f"Retrying with appended /api: {alt_url}")
            alt_response = requests.get(alt_url, params=params, timeout=10)
            alt_success, alt_message = check_response(alt_response)
            
            if alt_success:
                return True, "Connection successful (URL auto-corrected to end with /api)"
            else:
                # If retry also failed, return the retry's error as it's likely the more 'correct' URL
                return False, f"Retry ({alt_url}) failed: {alt_message}"
                
        return False, message
            
    except requests.exceptions.RequestException as e:
        logger.error(f"Indexer connection error: {e}")
        return False, f"Connection error: {str(e)}"
    except Exception as e:
        logger.error(f"Unexpected error testing indexer: {e}")
        return False, f"Unexpected error: {str(e)}"

def calculate_title_similarity(title1, title2):
    """
    Calcula la similitud entre dos t├¡tulos de pel├¡culas (0.0 a 1.0).
    Normaliza los t├¡tulos eliminando puntuaci├│n y convirtiendo a min├║sculas.
    
    Args:
        title1: Primer t├¡tulo
        title2: Segundo t├¡tulo
    
    Returns:
        float: Similitud entre 0.0 (completamente diferente) y 1.0 (id├®ntico)
    """
    from difflib import SequenceMatcher
    
    def normalize(text):
        # Eliminar puntuaci├│n y convertir a min├║sculas
        import re
        text = re.sub(r'[^\w\s]', '', text.lower())
        # Eliminar a├▒os
        text = re.sub(r'\b\d{4}\b', '', text)
        # Eliminar palabras comunes de calidad/release
        text = re.sub(r'\b(bluray|bdrip|webrip|hdtv|1080p|720p|480p|x264|x265|hevc|aac|ac3|dd5|dts)\b', '', text, flags=re.IGNORECASE)
        return text.strip()
    
    norm1 = normalize(title1)
    norm2 = normalize(title2)
    
    if not norm1 or not norm2:
        return 0.0
    
    return SequenceMatcher(None, norm1, norm2).ratio()


def is_word_match(search_term, result_title):
    """
    Verifica si el t├®rmino de b├║squeda aparece como palabra completa en el t├¡tulo del resultado.
    Esto previene que "Eli" coincida con "pel├¡cula" o "rebeli├│n".
    
    Args:
        search_term: T├®rmino buscado (ej: "Eli")
        result_title: T├¡tulo del resultado del indexer
    
    Returns:
        bool: True si el t├®rmino aparece como palabra completa
    """
    import re
    # Buscar el t├®rmino como palabra completa (con l├¡mites de palabra \b)
    pattern = r'\b' + re.escape(search_term) + r'\b'
    return bool(re.search(pattern, result_title, re.IGNORECASE))


def filter_search_results(results, search_query, min_similarity=0.4, year=None):
    """
    Filtra resultados de b├║squeda para eliminar coincidencias falsas.
    
    Para t├¡tulos cortos (<=4 caracteres), aplica validaci├│n estricta de palabra completa.
    Para todos, aplica fuzzy matching para eliminar t├¡tulos muy diferentes.
    
    Args:
        results: Lista de resultados de search_indexers
        search_query: Query original de b├║squeda (puede contener m├║ltiples t├¡tulos separados por |)
        min_similarity: Umbral m├¡nimo de similitud (0.0 a 1.0)
        year: A├▒o de la pel├¡cula para aplicar boost de similitud
    
    Returns:
        Lista filtrada de resultados con campo '_similarity' a├▒adido
    """
    if not results:
        return []
    
    # Extraer t├¡tulos base del query (separados por |)
    base_queries = [q.strip() for q in search_query.split('|') if q.strip()]
    
    # CRITICAL FIX: Remove years from base_queries for length checking
    # Years like "2012" were triggering strict word matching for ALL queries
    # We remove them for the short-title check, but keep them for similarity matching
    base_queries_no_year = []
    for q in base_queries:
        # Remove year patterns (4-digit numbers)
        q_no_year = re.sub(r'\b\d{4}\b', '', q).strip()
        if q_no_year:  # Only add if something remains after removing year
            base_queries_no_year.append(q_no_year)
    
    # Use queries without years for short-title detection
    queries_for_length_check = base_queries_no_year if base_queries_no_year else base_queries
    
    logger.debug(f"Filter: Original queries: {base_queries}")
    logger.debug(f"Filter: Queries for length check (years removed): {queries_for_length_check}")
    
    filtered = []
    rejected_count = 0
    
    for result in results:
        result_title = result.get('title', '')
        if not result_title:
            continue
        
        best_similarity = 0.0
        matched_query = None
        is_strict_match = False
        
        for base_query in base_queries:
            # Ô£à IMPROVED: If the result title contains the exact query as a word, calculate similarity
            query_no_year = re.sub(r'\b\d{4}\b', '', base_query).strip()
            if query_no_year and is_word_match(query_no_year, result_title):
                # Exact word match found - calculate actual similarity
                similarity = calculate_title_similarity(base_query, result_title)
                
                # Ô£à SIMPLIFIED: Extract year from base_query and check if result contains it
                year_match = re.search(r'\b(\d{4})\b', base_query)
                if year_match:
                    query_year = year_match.group(1)
                    if query_year in result_title:
                        similarity += 0.2
                        logger.info(f"­ƒÄ» Year boost: '{result_title[:60]}' contains year {query_year}, similarity: {similarity:.3f}")
                
                if similarity > best_similarity:
                    best_similarity = similarity
                    matched_query = base_query
                    is_strict_match = True
                continue
            
            # For very short titles, verify complete word match
            # But use queries_for_length_check to determine if it's "short"
            is_short_query = len(query_no_year) <= 4 if query_no_year else len(base_query) <= 4
            
            if is_short_query:
                # Use the query without year for word matching
                if query_no_year and is_word_match(query_no_year, result_title):
                    is_strict_match = True
                    # Calculate similarity with the full query (including year)
                    similarity = calculate_title_similarity(base_query, result_title)
                    
                    # Ô£à SIMPLIFIED: Extract year from base_query
                    year_match = re.search(r'\b(\d{4})\b', base_query)
                    if year_match and year_match.group(1) in result_title:
                        similarity += 0.2
                        logger.info(f"­ƒÄ» Year boost (short): '{result_title[:60]}' contains year {year_match.group(1)}, similarity: {similarity:.3f}")
                    
                    if similarity > best_similarity:
                        best_similarity = similarity
                        matched_query = base_query
            else:
                # For normal titles, use fuzzy matching
                similarity = calculate_title_similarity(base_query, result_title)
                
                # Ô£à SIMPLIFIED: Extract year from base_query
                year_match = re.search(r'\b(\d{4})\b', base_query)
                if year_match and year_match.group(1) in result_title:
                    similarity += 0.2
                    logger.info(f"­ƒÄ» Year boost (normal): '{result_title[:60]}' contains year {year_match.group(1)}, similarity: {similarity:.3f}")
                
                if similarity > best_similarity:
                    best_similarity = similarity
                    matched_query = base_query
        
        # Decide if we accept the result
        accept = False
        
        # Check if ANY query (without year) is short
        has_short_query = any(len(q) <= 4 for q in queries_for_length_check)
        
        if has_short_query:
            # For short queries, REQUIRE complete word match
            if is_strict_match and best_similarity >= min_similarity:
                accept = True
        else:
            # For normal titles, only similarity
            if best_similarity >= min_similarity:
                accept = True
        
        # Also accept if the title starts with any query (without year)
        for query in queries_for_length_check:
            if result_title.lower().startswith(query.lower()):
                accept = True
                # Ô£à FIXED: Don't overwrite year-boosted similarity, use max
                best_similarity = max(best_similarity, 0.8)
                break
        
        
        if accept:
            # Ô£à FINAL YEAR BOOST/PENALTY: Apply based on year match
            # Extract years from search_query (the multi-language query with years)
            query_years = set(re.findall(r'\b(19|20)\d{2}\b', search_query))
            result_years = set(re.findall(r'\b(19|20)\d{2}\b', result_title))
            
            if query_years:
                if query_years & result_years:
                    # Year match - apply boost if not already at 1.0
                    matching_year = list(query_years & result_years)[0]
                    if best_similarity < 1.0 and abs(best_similarity - 0.8) < 0.01:
                        best_similarity += 0.2
                        logger.info(f"­ƒÄ» Final year boost: '{result_title[:60]}' contains year {matching_year}, similarity: {best_similarity:.3f}")
                elif result_years:
                    # Result has a DIFFERENT year - apply penalty
                    wrong_year = list(result_years)[0]
                    query_year = list(query_years)[0]
                    best_similarity -= 0.15
                    logger.info(f"­ƒôë Year penalty: '{result_title[:60]}' has year {wrong_year} (expected {query_year}), similarity: {best_similarity:.3f}")
            
            result['_similarity'] = best_similarity
            result['_matched_query'] = matched_query
            filtered.append(result)
            
            # NOTE: Early exit removed - it was causing size filtering issues
            # by stopping before processing smaller valid torrents
        else:
            rejected_count += 1
            logger.debug(f"Filter: REJECTED '{result_title}' (similarity: {best_similarity:.2f}, matched: {matched_query})")
    
    # Sort by similarity (most similar first)
    filtered.sort(key=lambda x: x.get('_similarity', 0), reverse=True)
    
    logger.info(f"Filtered results: {len(results)} ÔåÆ {len(filtered)} (removed {len(results) - len(filtered)} false positives)")
    
    return filtered

def search_indexers(query, settings, tmdb_id=None):
    """
    Searches all configured Prowlarr indexers for a query
    """
    import xml.etree.ElementTree as ET
    import re
    
    logger.info("=" * 80)
    logger.info(f"­ƒöì [SEARCH] INDEXER SEARCH STARTED - Query: '{query}'")
    logger.info("=" * 80)
    
    # Extract year from original query BEFORE multi-language conversion
    original_year = None
    year_match = re.search(r'\b(\d{4})\b', query)
    if year_match:
        original_year = year_match.group(1)
        logger.debug(f"Extracted year {original_year} from original query")
    
    indexers = settings.get('indexers', [])
    if not indexers:
        logger.warning("ÔÜá´©Å  [SEARCH] No indexers configured")
        return {"results": [], "total": 0}
    
    logger.info(f"­ƒôí [SEARCH] Searching {len(indexers)} configured indexer(s)")
    # INTELLIGENT MULTI-LANGUAGE SEARCH
    # If we have TMDB ID, detect indexer languages and search with appropriate titles
    if tmdb_id:
        logger.info(f"­ƒîì Using intelligent multi-language search for TMDB ID: {tmdb_id}")
        
        try:
            # 1. Get languages from all indexers
            indexer_languages = set()
            indexer_lang_map = {}  # Map indexer index to its language
            
            for idx, indexer in enumerate(indexers):
                stats = get_prowlarr_stats(indexer)
                if stats.get('success') and stats.get('languages'):
                    langs = stats['languages']
                    indexer_languages.update(langs)
                    # Store first language for this indexer
                    indexer_lang_map[idx] = langs[0] if langs else None
                    logger.info(f"Indexer '{indexer.get('name')}' supports languages: {langs}")
                else:
                    logger.warning(f"Could not detect language for indexer '{indexer.get('name')}', using fallback")
            
            # 2. Get titles in those languages from TMDB
            if indexer_languages:
                tmdb_api_key = settings.get('tmdb_api_key')
                titles_by_lang = get_movie_titles_in_languages(tmdb_id, indexer_languages, tmdb_api_key)
                
                if titles_by_lang:
                    logger.info(f"­ƒôÜ Fetched titles: {titles_by_lang}")
                    
                    # 3. Build query string with all language variants
                    unique_titles = list(set(titles_by_lang.values()))
                    
                    # Ô£à FIX: Also include original query title as fallback
                    # This ensures we search with user's title even if TMDB returns different
                    original_title_clean = original_query.split('|')[0].strip()
                    # Remove year if present
                    import re
                    original_title_clean = re.sub(r'\s+\d{4}$', '', original_title_clean).strip()
                    if original_title_clean and original_title_clean not in unique_titles:
                        unique_titles.insert(0, original_title_clean)  # Put user's query first
                        logger.info(f"­ƒôî Added user query title as priority: '{original_title_clean}'")
                    
                    # Ô£à FIXED: Append year to EACH title, not just at the end
                    if original_year:
                        unique_titles = [f"{title} {original_year}" for title in unique_titles]
                        logger.debug(f"Added year to each title: {unique_titles}")
                    
                    query = " | ".join(unique_titles)
                    logger.info(f"­ƒöì Multi-language search query: {query}")
                else:
                    logger.warning("Failed to fetch multi-language titles, falling back to text search")
            else:
                logger.warning("No indexer languages detected, falling back to text search")
                
        except Exception as e:
            logger.error(f"Error in intelligent search: {e}, falling back to text search")
    
    # Split by | to get multiple title variants (Spanish | English)
    base_queries = [q.strip() for q in query.split('|')]
    
    # Generate query variants to improve search results
    query_variants = []
    
    for base_query in base_queries:
        if not base_query:
            continue
            
        # Add original query
        query_variants.append(base_query)
        
        # IMPORTANT: Create variant without year
        # Many trackers don't include the year in torrent names
        query_no_year = re.sub(r'\b\d{4}\b', '', base_query).strip()
        if query_no_year and query_no_year != base_query and query_no_year not in query_variants:
            query_variants.append(query_no_year)
        
        # Variant 1: Remove punctuation (: ; , - etc.)
        clean_query = re.sub(r'[:;,\-\ÔÇô\ÔÇö]', ' ', base_query)
        clean_query = re.sub(r'\s+', ' ', clean_query).strip()
        if clean_query != base_query and clean_query not in query_variants:
            query_variants.append(clean_query)
        
        # Variant 2: Remove dots/periods (for titles like "Oh. What. Fun.")
        no_dots = base_query.replace('.', ' ')
        no_dots = re.sub(r'\s+', ' ', no_dots).strip()
        if no_dots != base_query and no_dots not in query_variants:
            query_variants.append(no_dots)
        
        # Variant 3: Remove common articles and prepositions at start
        article_removed = re.sub(r'^(El|La|Los|Las|The|A|An)\s+', '', base_query, flags=re.IGNORECASE).strip()
        if article_removed != base_query and article_removed not in query_variants:
            query_variants.append(article_removed)
        
        # Variant 4: Article removed + punctuation removed
        clean_no_article = re.sub(r'[:;,\-\ÔÇô\ÔÇö]', ' ', article_removed)
        clean_no_article = re.sub(r'\s+', ' ', clean_no_article).strip()
        if clean_no_article not in query_variants:
            query_variants.append(clean_no_article)
        
        # Variant 5: Article removed + dots removed
        no_dots_no_article = article_removed.replace('.', ' ')
        no_dots_no_article = re.sub(r'\s+', ' ', no_dots_no_article).strip()
        if no_dots_no_article not in query_variants:
            query_variants.append(no_dots_no_article)
        
        # Variant 6: Query without year + article removed
        if query_no_year:
            article_removed_no_year = re.sub(r'^(El|La|Los|Las|The|A|An)\s+', '', query_no_year, flags=re.IGNORECASE).strip()
            if article_removed_no_year and article_removed_no_year not in query_variants:
                query_variants.append(article_removed_no_year)

        # NEW Variant 7: Remove ALL articles and common prepositions (not just at start)
        # This helps when tracker uses different article/preposition placement
        # e.g., "Chainsaw Man - La pel├¡cula: El arco de Reze" ÔåÆ "Chainsaw Man pel├¡cula arco Reze"
        no_articles = re.sub(r'\b(el|la|los|las|de|del|un|una|unos|unas|the|a|an|of)\b', ' ', base_query, flags=re.IGNORECASE)
        no_articles = re.sub(r'[:;,\-\ÔÇô\ÔÇö]', ' ', no_articles)  # Also remove punctuation
        no_articles = re.sub(r'\s+', ' ', no_articles).strip()
        if no_articles and len(no_articles) > 3 and no_articles not in query_variants:
            query_variants.append(no_articles)
        
        # NEW Variant 8: Ultra-short - Extract only main keywords (words >= 4 chars)
        # Helps find torrents with very different naming conventions
        # e.g., "Chainsaw Man - La pel├¡cula: El arco de Reze" ÔåÆ "Chainsaw pel├¡cula arco Reze"
        words = re.findall(r'\b\w+\b', base_query)
        keywords = [w for w in words if len(w) >= 4 and not w.isdigit()]  # Skip short words and years
        if len(keywords) >= 2:  # Only if we have at least 2 keywords
            ultra_short = ' '.join(keywords)
            if ultra_short and ultra_short not in query_variants:
                query_variants.append(ultra_short)

    # Ô£à PHASE 2: Limit search variants to reduce API calls
    # Keep only the most useful variants (original + no year + 2 best alternates)
    MAX_VARIANTS = 4
    if len(query_variants) > MAX_VARIANTS:
        logger.debug(f"­ƒöä Reducing {len(query_variants)} variants to {MAX_VARIANTS} to save API calls")
        query_variants = query_variants[:MAX_VARIANTS]
    
    logger.info(f"Searching with {len(query_variants)} variants: {query_variants}")
    
    all_results = []
    seen_urls = set()  # To avoid duplicates by URL
    seen_items = set()  # To avoid duplicates by title+size
    
    for indexer in indexers:
        try:
            name = indexer.get('name', 'Unknown')
            url = indexer.get('url', '').rstrip('/')
            api_key = indexer.get('api_key', '')
            categories = indexer.get('categories', '2000')
            
            if not url or not api_key:
                logger.warning(f"Skipping indexer {name}: missing URL or API key")
                continue
            
            # Try each query variant
            for variant in query_variants:
                try:
                    # Torznab search params
                    params = {
                        't': 'movie',
                        'q': variant,
                        'apikey': api_key,
                        'cat': categories
                    }
                    
                    logger.info(f"Searching {name} for '{variant}'")
                    response = requests.get(url, params=params, timeout=15)
                    
                    if response.status_code != 200:
                        logger.error(f"Indexer {name} returned status {response.status_code}")
                        continue
                    
                    # Parse XML response
                    root = ET.fromstring(response.content)
                    
                    # Torznab uses RSS format with additional attributes
                    for item in root.findall('.//item'):
                        try:
                            title_elem = item.find('title')
                            link_elem = item.find('link')
                            size_elem = item.find('size')
                            
                            # Get download URL to check for duplicates
                            download_url = link_elem.text if link_elem is not None else ''
                            title_text = title_elem.text if title_elem is not None else 'Unknown'
                            size = int(size_elem.text) if size_elem is not None and size_elem.text else 0
                            
                            # Create unique identifier by title + size
                            item_signature = f"{title_text}_{size}"
                            
                            # Skip if we've already seen this URL or title+size combo
                            if download_url in seen_urls or item_signature in seen_items:
                                continue
                            
                            # Extract year from title if possible
                            year = None
                            
                            # Ô£à IMPROVED: Multiple patterns for year extraction
                            # Handles: (2023), [2023], .2023., space before + space/dot/end after
                            year_patterns = [
                                r'\((\d{4})\)',           # (2023)
                                r'\[(\d{4})\]',           # [2023]
                                r'\.(\d{4})\.',           # .2023.
                                r'\s(\d{4})(?:[\s\.]|$)', # space before, space/dot/end after
                            ]
                            for pattern in year_patterns:
                                match = re.search(pattern, title_text)
                                if match:
                                    year = match.group(1)
                                    break
                            
                            result = {
                                'title': title_text,
                                'year': year,
                                'size': size,
                                'download_url': download_url,
                                'indexer': name
                            }
                            
                            all_results.append(result)
                            seen_urls.add(download_url)
                            seen_items.add(item_signature)
                            
                        except Exception as e:
                            logger.error(f"Error parsing item from {name}: {e}")
                            continue
                    
                    logger.info(f"Found {len(root.findall('.//item'))} results from {name} with query '{variant}'")
                
                except Exception as e:
                    logger.error(f"ÔØî [SEARCH] Error searching {name} with variant '{variant}': {e}")
                    continue
                    
        except Exception as e:
            logger.error(f"ÔØî [SEARCH] Error searching indexer {name}: {e}")
            continue
    
    # FALLBACK TO ENGLISH IF NO RESULTS FOUND
    # If search in tracker's language returned 0 results and we have TMDB ID,
    # try searching with English title as fallback
    if len(all_results) == 0 and tmdb_id:
        logger.warning(f"No results found in tracker language(s). Trying English fallback...")
        
        try:
            # Fetch English title from TMDB
            tmdb_api_key = settings.get('tmdb_api_key')
            english_titles = get_movie_titles_in_languages(tmdb_id, ['en-US'], tmdb_api_key)
            
            if english_titles and 'en-US' in english_titles:
                english_title = english_titles['en-US']
                logger.info(f"­ƒç¼­ƒçº English fallback title: '{english_title}'")
                
                # Generate variants for English title
                english_variants = []
                english_variants.append(english_title)
                
                # Remove punctuation variant
                clean_english = re.sub(r'[:;,\-\ÔÇô\ÔÇö]', ' ', english_title)
                clean_english = re.sub(r'\s+', ' ', clean_english).strip()
                if clean_english != english_title:
                    english_variants.append(clean_english)
                
                # Remove dots variant
                no_dots_english = english_title.replace('.', ' ')
                no_dots_english = re.sub(r'\s+', ' ', no_dots_english).strip()
                if no_dots_english != english_title and no_dots_english not in english_variants:
                    english_variants.append(no_dots_english)
                
                logger.info(f"Searching with English variants: {english_variants}")
                
                # Search again with English title
                for indexer in indexers:
                    try:
                        name = indexer.get('name', 'Unknown')
                        url = indexer.get('url', '').rstrip('/')
                        api_key = indexer.get('api_key', '')
                        categories = indexer.get('categories', '2000')
                        
                        if not url or not api_key:
                            continue
                        
                        for variant in english_variants:
                            logger.debug(f"­ƒöº [English Fallback] Trying variant: '{variant}'") # Changed to debug
                            try:
                                params = {
                                    't': 'movie',
                                    'q': variant,
                                    'apikey': api_key,
                                    'cat': categories
                                }
                                
                                logger.debug(f"[English Fallback] Searching {name} for '{variant}'") # Changed to debug
                                response = requests.get(url, params=params, timeout=15)
                                
                                if response.status_code != 200:
                                    continue
                                
                                root = ET.fromstring(response.content)
                                
                                for item in root.findall('.//item'):
                                    try:
                                        title_elem = item.find('title')
                                        link_elem = item.find('link')
                                        size_elem = item.find('size')
                                        
                                        download_url = link_elem.text if link_elem is not None else ''
                                        title_text = title_elem.text if title_elem is not None else 'Unknown'
                                        size = int(size_elem.text) if size_elem is not None and size_elem.text else 0
                                        
                                        item_signature = f"{title_text}_{size}"
                                        
                                        if download_url in seen_urls or item_signature in seen_items:
                                            continue
                                        
                                        year = None
                                        # Ô£à IMPROVED: Multiple patterns for year extraction
                                        year_patterns = [
                                            r'\((\d{4})\)',           # (2023)
                                            r'\[(\d{4})\]',           # [2023]
                                            r'\.(\d{4})\.',           # .2023.
                                            r'\s(\d{4})(?:[\s\.]|$)', # space before, space/dot/end after
                                        ]
                                        for pattern in year_patterns:
                                            match = re.search(pattern, title_text)
                                            if match:
                                                year = match.group(1)
                                                break
                                        
                                        result = {
                                            'title': title_text,
                                            'download_url': download_url,
                                            'size': size,
                                            'indexer': name,
                                            'year': year
                                        }
                                        
                                        all_results.append(result)
                                        seen_urls.add(download_url)
                                        seen_items.add(item_signature)
                                        
                                    except Exception as item_err:
                                        logger.error(f"Error parsing item in English fallback: {item_err}")
                                        continue
                                
                                # Log results found with this variant
                                logger.info(f"Found {len([r for r in all_results if r['indexer'] == name])} results from {name} with English query '{variant}'")
                                
                            except Exception as variant_err:
                                logger.error(f"Error searching variant '{variant}': {variant_err}")
                                continue
                                
                    except Exception as indexer_err:
                        logger.error(f"Error in English fallback for {name}: {indexer_err}")
                        continue
                
                if all_results:
                    logger.info(f"Ô£à English fallback successful: found {len(all_results)} results")
                else:
                    logger.warning(f"ÔØî English fallback also returned 0 results")
            else:
                logger.warning("Could not fetch English title from TMDB for fallback")
                
        except Exception as fallback_err:
            logger.error(f"Error in English fallback: {fallback_err}")
    
    logger.info(f"Total raw search results before filtering: {len(all_results)}")
    
    # Extract year from query for similarity boost
    year_for_boost = None
    year_match = re.search(r'\b(\d{4})\b', query)
    if year_match:
        year_for_boost = year_match.group(1)
        logger.debug(f"Extracted year {year_for_boost} from query for similarity boost")
    
    # FILTER RESULTS TO REMOVE FALSE POSITIVES
    # This is critical for short titles like "Eli" which match "pel├¡cula", "rebeli├│n", etc.
    all_results = filter_search_results(all_results, query, min_similarity=0.4, year=year_for_boost)
    
    logger.info(f"Total filtered search results: {len(all_results)}")
    return all_results

def select_best_torrent(results, preferred_size_mb, max_size_mb):
    """
    Selects the best torrent based on size criteria.
    - Filters out torrents larger than max_size_mb (if set).
    - Sorts remaining by closeness to preferred_size_mb.
    - Returns the best match or None.
    """
    if not results:
        return None
        
    valid_results = []
    
    # 1. Filter by Max Size
    for res in results:
        size_mb = res.get('size', 0) / 1024 / 1024 # Convert bytes to MB
        res['size_mb'] = size_mb # Store for easier access
        
        if max_size_mb > 0 and size_mb > max_size_mb:
            continue
            
        valid_results.append(res)
        
    if not valid_results:
        return None
        
    # 2. Sort by Similarity (if available) then by Preferred Size
    # Ô£à NEW: Prioritize similarity score from filter_false_positives
    has_similarity = any('_similarity' in r for r in valid_results)
    
    logger.debug(f"­ƒöì select_best_torrent: has_similarity={has_similarity}, total_results={len(valid_results)}")
    
    if has_similarity:
        # Log top 5 results with similarity scores before sorting
        logger.info("­ƒôè Top candidates before sorting:")
        for i, r in enumerate(valid_results[:5]):
            logger.info(f"  {i+1}. {r.get('title', 'Unknown')[:60]} - similarity: {r.get('_similarity', 0):.3f}, size: {r.get('size_mb', 0):.0f} MB")
        
        # Sort by similarity (highest first), then by size preference
        if preferred_size_mb > 0:
            valid_results.sort(
                key=lambda x: (
                    -x.get('_similarity', 0),  # Negative for descending (highest similarity first)
                    abs(x['size_mb'] - preferred_size_mb)  # Then by size preference
                )
            )
        else:
            # Just sort by similarity
            valid_results.sort(key=lambda x: x.get('_similarity', 0), reverse=True)
        
        # Log selected result
        selected = valid_results[0]
        logger.info(f"Ô£à Selected (by similarity): {selected.get('title', 'Unknown')[:60]} - similarity: {selected.get('_similarity', 0):.3f}")
    else:
        # Legacy behavior: sort by size only
        if preferred_size_mb > 0:
            valid_results.sort(key=lambda x: abs(x['size_mb'] - preferred_size_mb))
        logger.info(f"ÔÜá´©Å No similarity scores found, selected by size: {valid_results[0].get('title', 'Unknown')[:60]}")
        
    return valid_results[0]

def auto_download_movie(title, year, preferred_size_gb, max_size_gb, label=None, tmdb_id=None):
    """
    Automatically searches for and downloads a movie torrent.
    Returns (torrent_hash, torrent_name, reason) - reason is None on success, error message on failure.
    """
    logger.info("=" * 80)
    logger.info(f"­ƒôÑ [DOWNLOAD] AUTO-DOWNLOAD STARTED - '{title}' ({year})")
    logger.info("=" * 80)
    logger.info(f"­ƒôÑ [DOWNLOAD] Size limits: {preferred_size_gb} GB (preferred) / {max_size_gb} GB (max)")
    
    settings = load_settings()
    
    # 1. Search (with intelligent multi-language if tmdb_id provided)
    query = f"{title} {year}" if year else title
    results = search_indexers(query, settings, tmdb_id=tmdb_id)
    
    if not results:
        logger.info(f"No search results found for: {query}")
        return None, None, "No torrents found"
        
    # 2. Select Best Torrent
    best_torrent = select_best_torrent(results, preferred_size_gb, max_size_gb)
    
    if not best_torrent:
        logger.info(f"No suitable torrent found for {title} within size limits (Max: {max_size_gb}MB)")
        return None, None, f"No torrent within size limits (max: {max_size_gb} MB)"
        
    logger.info(f"Selected torrent: {best_torrent['title']} ({int(best_torrent['size_mb'])} MB)")
    
    # 3. Add to torrent client
    try:
        qb = get_qb_client(settings)
        qb.auth_log_in()
        
        # Get torrents list BEFORE adding to compare
        torrents_before = {t['hash'] for t in qb.torrents_info()}
        
        # Add torrent with label/tag if provided
        if label:
            logger.info(f"Adding torrent with label: {label}")
            qb.torrents_add(urls=best_torrent['download_url'], tags=label)
        else:
            qb.torrents_add(urls=best_torrent['download_url'])
            
        # Give torrent client time to add the torrent (retry loop for reliability)
        import time
        max_retries = 6
        new_torrents = []
        
        for attempt in range(max_retries):
            time.sleep(1)  # Sleep 1 second between retries
            
            # Get the torrent hash by finding the NEW torrent that was just added
            torrents_after = qb.torrents_info()
            
            # Find torrents that weren't there before
            new_torrents = [t for t in torrents_after if t['hash'] not in torrents_before]
            
            if new_torrents:
                logger.info(f"New torrent detected after {attempt + 1} attempts")
                break
        
        if new_torrents:
            # If we have multiple new torrents, try to find the one matching our title/year
            matching_torrent = None
            for t in new_torrents:
                t_title, t_year = clean_torrent_name(t['name'])
                # Check if title matches (case insensitive) and year matches (if provided)
                title_matches = t_title.lower() == title.lower() or title.lower() in t_title.lower()
                year_matches = (not year) or (str(t_year) == str(year))
                
                if title_matches and year_matches:
                    matching_torrent = t
                    break
            
            # Use matching torrent if found, otherwise use the first new torrent
            selected = matching_torrent or new_torrents[0]
            logger.info(f"Added torrent to download client: {selected['name']} (hash: {selected['hash'][:8]}...)")
            return selected['hash'], selected['name'], None  # Success - no reason needed
        
        
        # ÔØî REMOVED UNSAFE FALLBACK: Do not use "most recent" torrent as it may be wrong
        # If we can't detect the new torrent, it's better to fail than to assign wrong hash
        logger.error(f"ÔØî Could not detect new torrent after {max_retries} retries for: {best_torrent['title']}")
        logger.error(f"ÔÜá´©Å This movie will NOT be added to the database to prevent data corruption")
        logger.error(f"­ƒÆí Possible causes: Torrent client slow to respond, network issues, or torrent already exists")
        return None, None, "Torrent client did not respond"
        
    except Exception as e:
        logger.error(f"Error adding torrent to download client: {e}")
        return None, None, f"Download client error: {str(e)}"

