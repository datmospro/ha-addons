/**
 * Módulo Search para Roverr
 * Gestiona búsquedas en TMDB y en indexers
 * Extraído de app.js - líneas 335-627
 */

import { searchTMDB, searchIndexers, addTorrent } from './api.js';
import { showToast, escapeHtml, formatBytes, showRedirectOverlay, removeRedirectOverlay } from './ui.js';
import { switchView } from './navigation.js';

// Referencias DOM
let searchInput;
let searchBtn;
let searchResults;

/**
 * Inicializa el módulo de búsqueda
 * Líneas 335-358 de app.js
 */
export function initSearch() {
    searchInput = document.getElementById('search-input');
    searchBtn = document.getElementById('search-btn');
    searchResults = document.getElementById('search-results');

    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }

    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleSearch();
            }
        });
    }
}

/**
 * Maneja la búsqueda en TMDB
 * Líneas 360-377 de app.js
 */
async function handleSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    searchResults.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Searching TMDB...</div>';

    const data = await searchTMDB(query);

    if (data.success && data.results) {
        renderTMDBResults(data.results);
    } else {
        searchResults.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--error);">${data.message || 'Search failed'}</div>`;
    }
}

/**
 * Renderiza resultados de TMDB
 * Líneas 379-427 de app.js
 */
function renderTMDBResults(results) {
    if (!results || results.length === 0) {
        searchResults.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 2rem; color: var(--text-muted);">
                <i class="fa-solid fa-film" style="font-size: 3rem; opacity: 0.3; margin-bottom: 1rem;"></i>
                <p style="font-size: 1.1rem;">No results found</p>
            </div>
        `;
        return;
    }

    const resultsHTML = results.map(movie => `
        <div class="content-card" style="padding: 0; overflow: hidden; cursor: pointer; transition: all 0.3s ease; border-radius: 12px;" 
             onclick="searchIndexersForMovie('${escapeHtml(movie.title)}', '${escapeHtml(movie.original_title || '')}', '${movie.year || ''}', ${movie.tmdb_id})"
             onmouseenter="this.style.transform='translateY(-8px)'; this.style.boxShadow='0 12px 24px rgba(0,0,0,0.3)'"
             onmouseleave="this.style.transform='translateY(0)'; this.style.boxShadow=''">
            <div style="position: relative; width: 100%; padding-top: 150%; overflow: hidden; background: var(--bg-secondary);">
                ${movie.poster ? `
                    <img src="${movie.poster}" alt="${escapeHtml(movie.title)}" 
                         style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;">
                ` : `
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg) 100%);">
                        <i class="fa-solid fa-film" style="font-size: 4rem; color: var(--text-muted); opacity: 0.3;"></i>
                    </div>
                `}
                ${movie.vote_average ? `
                    <div style="position: absolute; top: 0.75rem; right: 0.75rem; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); padding: 0.4rem 0.7rem; border-radius: 8px; display: flex; align-items: center; gap: 0.3rem; font-size: 0.9rem; font-weight: 600;">
                        <i class="fa-solid fa-star" style="color: #ffd700; font-size: 0.85rem;"></i>
                        <span>${movie.vote_average.toFixed(1)}</span>
                    </div>
                ` : ''}
            </div>
            <div style="padding: 1.25rem;">
                <h4 style="margin: 0 0 0.5rem 0; font-size: 1.1rem; font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.6em;">
                    ${escapeHtml(movie.title)}
                </h4>
                <div style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem;">
                    ${movie.year ? `<span style="display: flex; align-items: center; gap: 0.3rem;"><i class="fa-solid fa-calendar" style="font-size: 0.75rem;"></i>${movie.year}</span>` : '<span>Year unknown</span>'}
                </div>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0 0 1rem 0; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; min-height: 3.75em;">
                    ${movie.overview || 'No description available.'}
                </p>
                <button class="btn primary" style="width: 100%; border-radius: 8px; font-weight: 600;" 
                        onclick="event.stopPropagation(); searchIndexersForMovie('${escapeHtml(movie.title)}', '${escapeHtml(movie.original_title || '')}', '${movie.year || ''}', ${movie.tmdb_id})">
                    <i class="fa-solid fa-download"></i> Search Torrents
                </button>
            </div>
        </div>
    `).join('');

    searchResults.innerHTML = resultsHTML;
}

/**
 * Busca en indexers para una película específica
 * Líneas 429-461 de app.js
 */
window.searchIndexersForMovie = async function (title, originalTitle, year, tmdbId) {
    searchResults.innerHTML = `
        <div style="grid-column: 1 / -1; max-width: 1200px; margin: 0 auto; width: 100%; text-align: center; padding: 4rem 2rem;">
            <i class="fa-solid fa-spinner fa-spin" style="font-size: 2rem; color: var(--primary); margin-bottom: 1rem;"></i>
            <p style="font-size: 1.1rem; color: var(--text);">Searching indexers for "${title}"...</p>
        </div>
    `;

    try {
        const queries = [];
        if (title) queries.push(year ? `${title} ${year}` : title);
        if (originalTitle && originalTitle !== title) {
            queries.push(year ? `${originalTitle} ${year}` : originalTitle);
        }

        const query = queries.join(' | ');
        const data = await searchIndexers(query);

        if (data.success && data.results) {
            renderIndexerResults(data.results, title, year);
        } else {
            searchResults.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--error);">${data.message || 'No torrents found'}</div>`;
        }
    } catch (e) {
        console.error('Indexer search error:', e);
        searchResults.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--error);">Error searching indexers</div>';
    }
};

/**
 * Renderiza resultados de indexers
 * Líneas 463-514 de app.js
 */
function renderIndexerResults(results, movieTitle, movieYear) {
    if (!results || results.length === 0) {
        searchResults.innerHTML = `
            <div style="grid-column: 1 / -1; max-width: 1200px; margin: 0 auto; width: 100%;">
                <button class="btn secondary" onclick="location.reload()" style="margin-bottom: 2rem;">
                    <i class="fa-solid fa-arrow-left"></i> Back to Search
                </button>
                <div style="text-align: center; padding: 4rem 2rem; color: var(--text-muted);">
                    <i class="fa-solid fa-circle-xmark" style="font-size: 3rem; opacity: 0.3; margin-bottom: 1rem;"></i>
                    <p style="font-size: 1.1rem;">No torrents found for "${movieTitle}"</p>
                </div>
            </div>
        `;
        return;
    }

    const resultsHTML = `
        <div style="grid-column: 1 / -1; max-width: 1200px; margin: 0 auto; width: 100%;">
            <button class="btn secondary" onclick="location.reload()" style="margin-bottom: 2rem;">
                <i class="fa-solid fa-arrow-left"></i> Back to Search
            </button>
            <div style="margin-bottom: 2rem;">
                <h3 style="margin-bottom: 0.5rem; font-size: 1.5rem;">Torrents for "${movieTitle}"${movieYear ? ` (${movieYear})` : ''}</h3>
                <p style="color: var(--text-muted); font-size: 0.95rem;"><i class="fa-solid fa-circle-check" style="color: var(--success);"></i> ${results.length} result(s) found</p>
            </div>
            <div style="display: grid; gap: 1rem;">
                ${results.map(result => `
                    <div class="content-card" style="padding: 1.25rem; transition: all 0.2s ease;">
                        <div style="display: flex; justify-content: space-between; align-items: start; gap: 1.5rem;">
                            <div style="flex: 1; min-width: 0;">
                                <h4 style="margin: 0 0 0.75rem 0; font-size: 1.1rem; font-weight: 600; line-height: 1.4;">${result.title || 'Unknown'}</h4>
                                <div style="display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.9rem; color: var(--text-muted);">
                                    ${result.indexer ? `<span style="display: flex; align-items: center; gap: 0.3rem;"><i class="fa-solid fa-server" style="font-size: 0.8rem;"></i>${result.indexer}</span>` : ''}
                                    ${result.size ? `<span style="display: flex; align-items: center; gap: 0.3rem;"><i class="fa-solid fa-hard-drive" style="font-size: 0.8rem;"></i>${formatBytes(result.size)}</span>` : ''}
                                    ${result.year ? `<span style="display: flex; align-items: center; gap: 0.3rem;"><i class="fa-solid fa-calendar" style="font-size: 0.8rem;"></i>${result.year}</span>` : ''}
                                    ${result.seeders !== undefined ? `<span style="display: flex; align-items: center; gap: 0.3rem; color: var(--success);"><i class="fa-solid fa-arrow-up" style="font-size: 0.8rem;"></i>${result.seeders}</span>` : ''}
                                    ${result.leechers !== undefined ? `<span style="display: flex; align-items: center; gap: 0.3rem; color: var(--warning);"><i class="fa-solid fa-arrow-down" style="font-size: 0.8rem;"></i>${result.leechers}</span>` : ''}
                                </div>
                            </div>
                            <button class="btn primary download-torrent-btn" data-url="${escapeHtml(result.download_url)}" data-title="${escapeHtml(result.title)}" style="white-space: nowrap; flex-shrink: 0;">
                                <i class="fa-solid fa-download"></i> Download
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    searchResults.innerHTML = resultsHTML;

    // Attach event listeners to download buttons
    attachDownloadListeners();
}

/**
 * Adjunta event listeners a botones de descarga
 */
function attachDownloadListeners() {
    searchResults.querySelectorAll('.download-torrent-btn').forEach(btn => {
        btn.addEventListener('click', async function () {
            const url = this.dataset.url;
            const title = this.dataset.title;
            await downloadTorrent(url, title, this);
        });
    });
}

/**
 * Descarga un torrent
 * Líneas 524-582 de app.js
 */
async function downloadTorrent(url, title, btnElement) {
    const originalContent = btnElement.innerHTML;
    btnElement.disabled = true;
    btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Adding...';

    const data = await addTorrent(url, title);

    if (data.success) {
        showToast(data.message || 'Torrent added to download client', 'success');

        btnElement.innerHTML = '<i class="fa-solid fa-check"></i> Added';
        btnElement.classList.remove('primary');
        btnElement.classList.add('success');

        // Navigate to movie details if we have a hash
        if (data.hash) {
            showRedirectOverlay();
            setTimeout(async () => {
                const { showMovieDetails } = await import('./movies.js');
                showMovieDetails(data.hash);
                removeRedirectOverlay();
            }, 2500);
        } else {
            setTimeout(() => {
                switchView('dashboard');
            }, 1000);
        }
    } else {
        showToast(data.message || 'Failed to add torrent', 'error');
        btnElement.disabled = false;
        btnElement.innerHTML = originalContent;
    }
}
