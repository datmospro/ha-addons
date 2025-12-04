/**
 * Módulo de API para Roverr
 * Centraliza todas las llamadas al backend
 * Extraído de app.js - funciones dispersas de fetch
 */

import { API_BASE } from './config.js';
import { showToast } from './ui.js';

// === GET REQUESTS ===

/**
 * Gets the list of torrents from torrent client
 * Líneas 96-104 de app.js
 */
export async function getTorrents() {
    try {
        const res = await fetch(`${API_BASE}/torrents?t=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error("Error fetching torrents:", e);
        return [];
    }
}

/**
 * Obtiene la configuración de la aplicación
 * Líneas 672-680 de app.js
 */
export async function getSettings() {
    try {
        const res = await fetch(`${API_BASE}/settings?t=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error("Error fetching settings:", e);
        return {};
    }
}

/**
 * Obtiene la lista de películas
 * Líneas 1056-1237 de app.js
 */
export async function getMovies() {
    try {
        const res = await fetch(`${API_BASE}/movies?t=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // Handle new response format
        return {
            movies: Array.isArray(data) ? data : (data.movies || []),
            ignored_series: data.ignored_series || []
        };
    } catch (e) {
        console.error("Error fetching movies:", e);
        return { movies: [], ignored_series: [] };
    }
}

/**
 * Obtiene detalles de una película específica
 * Líneas 1245-1247 de app.js
 */
export async function getMovieDetails(hash) {
    try {
        const res = await fetch(`${API_BASE}/movie/${hash}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error("Error fetching movie details:", e);
        return { error: 'Error loading movie details' };
    }
}

/**
 * Obtiene el estado de RSS
 * Líneas 1035-1037 de app.js
 */
export async function getRSSStatus() {
    try {
        const res = await fetch(`${API_BASE}/rss/status?t=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error("Error fetching RSS status:", e);
        return {};
    }
}

// === POST REQUESTS ===

/**
 * Trigger manual check
 * Líneas 106-114 de app.js
 */
export async function triggerCheck() {
    try {
        const res = await fetch(`${API_BASE}/trigger`, { method: 'POST' });
        return await res.json();
    } catch (e) {
        console.error("Error triggering check:", e);
        return { success: false };
    }
}

/**
 * Fetch RSS feeds
 * Líneas 116-139 de app.js
 */
export async function fetchRSS() {
    try {
        const res = await fetch(`${API_BASE}/rss/fetch`, { method: 'POST' });
        return await res.json();
    } catch (e) {
        console.error("Error fetching RSS:", e);
        return { success: false, message: 'Error fetching RSS movies' };
    }
}

/**
 * Mueve un torrent manualmente
 * Líneas 264-291 de app.js
 */
export async function moveManually(hash) {
    try {
        const res = await fetch(`${API_BASE}/move/${hash}`, { method: 'POST' });
        return await res.json();
    } catch (e) {
        console.error("Error moving torrent:", e);
        return { success: false, message: 'Error starting move' };
    }
}

/**
 * Detiene la copia de un torrent
 * Líneas 293-307 de app.js
 */
export async function stopCopy(hash) {
    try {
        const res = await fetch(`${API_BASE}/stop/${hash}`, { method: 'POST' });
        return await res.json();
    } catch (e) {
        console.error("Error stopping copy:", e);
        return { success: false, message: 'Error stopping copy' };
    }
}

/**
 * Marca un torrent como movido manualmente
 * Líneas 309-331 de app.js
 */
export async function markAsMoved(hash) {
    try {
        const res = await fetch(`${API_BASE}/mark/${hash}`, { method: 'POST' });
        return await res.json();
    } catch (e) {
        console.error("Error marking as moved:", e);
        return { success: false, message: 'Error marking as moved' };
    }
}

/**
 * Adds a torrent to torrent client
 * Líneas 524-582 de app.js
 */
export async function addTorrent(url, title) {
    try {
        const res = await fetch(`${API_BASE}/add_torrent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, title })
        });
        return await res.json();
    } catch (e) {
        console.error("Error adding torrent:", e);
        return { success: false, message: 'Error adding torrent to download client' };
    }
}

/**
 * Guarda la configuración
 * Líneas 951-986 de app.js
 */
export async function saveSettings(settingsData) {
    try {
        const res = await fetch(`${API_BASE}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settingsData)
        });
        const data = await res.json();

        if (data.success) {
            showToast('Settings saved successfully', 'success');
        } else {
            showToast('Error saving settings', 'error');
        }

        return data;
    } catch (e) {
        console.error("Error saving settings:", e);
        showToast('Error saving settings', 'error');
        return { success: false };
    }
}

/**
 * Prueba un indexer
 * Líneas 764-797 de app.js
 */
export async function testIndexer(url, apiKey) {
    try {
        const res = await fetch(`${API_BASE}/test_indexer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, api_key: apiKey })
        });
        return await res.json();
    } catch (e) {
        console.error("Error testing indexer:", e);
        return { success: false, message: 'Error testing connection' };
    }
}

/**
 * Prueba un feed RSS
 * Líneas 834-867 de app.js
 */
export async function testRSSFeed(url) {
    try {
        const res = await fetch(`${API_BASE}/test_rss_feed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        return await res.json();
    } catch (e) {
        console.error("Error testing RSS feed:", e);
        return { success: false, message: 'Error testing RSS feed' };
    }
}

/**
 * Prueba la conexión de Telegram
 */
export async function testTelegram(token, chatId) {
    try {
        const res = await fetch(`${API_BASE}/test_telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, chat_id: chatId })
        });
        return await res.json();
    } catch (e) {
        console.error("Error testing Telegram:", e);
        return { success: false, message: 'Error testing Telegram connection' };
    }
}

/**
 * Búsqueda en TMDB
 * Líneas 360-377 de app.js
 */
export async function searchTMDB(query) {
    try {
        const res = await fetch(`${API_BASE}/search_tmdb?q=${encodeURIComponent(query)}`);
        return await res.json();
    } catch (e) {
        console.error('Search error:', e);
        return { success: false, message: 'Error performing search' };
    }
}

/**
 * Búsqueda en indexers
 * Líneas 429-461 de app.js
 */
export async function searchIndexers(query, tmdbId = null) {
    try {
        let url = `${API_BASE}/search?q=${encodeURIComponent(query)}`;

        // Add TMDB ID for intelligent multi-language search
        if (tmdbId) {
            url += `&tmdb_id=${tmdbId}`;
        }

        const res = await fetch(url);
        return await res.json();
    } catch (e) {
        console.error('Indexer search error:', e);
        return { success: false, message: 'Error searching indexers' };
    }
}

/**
 * Identifica una película manualmente por TMDB ID
 * Líneas 1502-1524 de app.js
 */
export async function identifyMovie(hash, tmdbId) {
    try {
        const res = await fetch(`${API_BASE}/movie/${hash}/identify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tmdb_id: tmdbId })
        });
        return await res.json();
    } catch (e) {
        console.error("Error identifying movie:", e);
        return { success: false, message: 'Error identifying movie' };
    }
}

/**
 * Copia múltiples películas
 * Líneas 1748-1783 de app.js
 */
export async function batchCopyMovies(torrentHashes) {
    try {
        const res = await fetch(`${API_BASE}/movies/batch-copy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ torrent_hashes: torrentHashes })
        });
        return await res.json();
    } catch (e) {
        console.error('Error copying movies:', e);
        return { success: false, message: 'Error copying movies' };
    }
}

/**
 * Elimina múltiples películas
 * Líneas 1785-1838 de app.js
 */
export async function batchDeleteMovies(torrentHashes, options) {
    try {
        const res = await fetch(`${API_BASE}/movies/batch-delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                torrent_hashes: torrentHashes,
                delete_from_db: options.deleteFromDB,
                delete_from_destination: options.deleteFromDestination,
                ignore_movie: options.ignoreMovie,
                watchlist_movie: options.watchlistMovie || false,
                watchlist_days: options.watchlistDays || 7
            })
        });
        return await res.json();
    } catch (e) {
        console.error('Error deleting movies:', e);
        return { success: false, message: 'Error deleting movies' };
    }
}


/**
 * Obtiene la lista de películas ignoradas
 */
export async function getIgnoredMovies() {
    try {
        const res = await fetch(`${API_BASE}/ignored-movies`);
        return await res.json();
    } catch (e) {
        console.error("Error getting ignored movies:", e);
        return { success: false, message: 'Error getting ignored movies', movies: [] };
    }
}

/**
 * Elimina una película de la lista de ignoradas
 */
export async function unignoreMovie(hash) {
    try {
        const res = await fetch(`${API_BASE}/unignore-movie`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hash })
        });
        return await res.json();
    } catch (e) {
        console.error("Error unignoring movie:", e);
        return { success: false, message: 'Error unignoring movie' };
    }
}

/**
 * Resetea la lista de películas ignoradas
 */
export async function resetIgnoredMovies() {
    try {
        const res = await fetch(`${API_BASE}/reset-ignored`, { method: 'POST' });
        return await res.json();
    } catch (e) {
        console.error("Error resetting ignored list:", e);
        return { success: false, message: 'Error resetting ignored list' };
    }
}
