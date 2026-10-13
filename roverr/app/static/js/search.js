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

    searchResults.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Buscando películas…</div>';

    const data = await searchTMDB(query);

    if (data.success && data.results) {
        renderTMDBResults(data.results);
    } else {
        searchResults.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--error);">${escapeHtml(data.message || 'No se pudo completar la búsqueda')}</div>`;
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
                <p style="font-size: 1.1rem;">No se encontraron películas</p>
            </div>
        `;
        return;
    }

    const resultsHTML = results.map((movie,index) => `
        <div class="content-card" style="padding: 0; overflow: hidden; cursor: pointer; transition: all 0.3s ease; border-radius: 12px;" 
             data-movie-index="${index}" role="button" tabindex="0"
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
                ${movie.ignored ? '<span class="search-ignored-label">Ignorada</span>' : ''}
                <h4 style="margin: 0 0 0.5rem 0; font-size: 1.1rem; font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.6em;">
                    ${escapeHtml(movie.title)}
                </h4>
                <div style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem;">
                    ${movie.year ? `<span style="display: flex; align-items: center; gap: 0.3rem;"><i class="fa-solid fa-calendar" style="font-size: 0.75rem;"></i>${movie.year}</span>` : '<span>Año desconocido</span>'}
                </div>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0 0 1rem 0; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; min-height: 3.75em;">
                    ${escapeHtml(movie.overview || 'Sin descripción disponible.')}
                </p>
                <button class="btn primary" style="width: 100%; border-radius: 8px; font-weight: 600;" 
                        >
                    <i class="fa-solid fa-download"></i> Buscar torrents
                </button>
            </div>
        </div>
    `).join('');

    searchResults.innerHTML = resultsHTML;
    searchResults.querySelectorAll('[data-movie-index]').forEach(card=> {
        const movie=results[Number(card.dataset.movieIndex)];
        const search=()=>window.searchIndexersForMovie(movie.title,movie.original_title || '',movie.year,movie.tmdb_id);
        card.addEventListener('click',search);
        card.addEventListener('keydown',event=> {if(event.target===card && ['Enter',' '].includes(event.key)){event.preventDefault();search();}});
    });
}

/**
 * Busca en indexers para una película específica
 * Líneas 429-461 de app.js
 */
let currentSearchController = null;

window.searchIndexersForMovie = async function (title, originalTitle, year, tmdbId) {
    // Abort any existing search
    if (currentSearchController) {
        currentSearchController.abort();
    }
    
    currentSearchController = new AbortController();
    const { signal } = currentSearchController;

    searchResults.innerHTML = `
        <div style="grid-column: 1 / -1; max-width: 1200px; margin: 0 auto; width: 100%; text-align: center; padding: 4rem 2rem;">
            <i class="fa-solid fa-spinner fa-spin" style="font-size: 2.5rem; color: var(--primary); margin-bottom: 1.5rem;"></i>
            <p style="font-size: 1.25rem; color: var(--text); margin-bottom: 1.5rem;">Buscando torrents para "${escapeHtml(title)}"…</p>
            <button id="cancel-indexer-search-btn" class="btn danger" style="padding: 0.6rem 1.2rem; border-radius: 8px; font-weight: 600;">
                <i class="fa-solid fa-circle-xmark"></i> Cancelar búsqueda
            </button>
        </div>
    `;

    // Attach listener for the Cancel button
    document.getElementById('cancel-indexer-search-btn')?.addEventListener('click', () => {
        if (currentSearchController) {
            currentSearchController.abort();
            currentSearchController = null;
            showToast('Búsqueda cancelada', 'info');
            location.reload(); // Returns cleanly to TMDB search view
        }
    });

    try {
        const queries = [];
        if (title) queries.push(year ? `${title} ${year}` : title);
        if (originalTitle && originalTitle !== title) {
            queries.push(year ? `${originalTitle} ${year}` : originalTitle);
        }

        const query = queries.join(' | ');
        const movie={movie_title:title,movie_year:year,original_title:originalTitle,tmdb_id:tmdbId};
        const data = await searchIndexers(query, tmdbId, signal, movie);

        if (data.aborted) {
            return;
        }

        currentSearchController = null;

        if (data.success && data.results) {
            renderIndexerResults(data.results, title, year, {...movie,ignored:data.ignored});
        } else {
            searchResults.innerHTML = `
                <div style="grid-column: 1 / -1; max-width: 1200px; margin: 0 auto; width: 100%;">
                    <button class="btn secondary" onclick="location.reload()" style="margin-bottom: 2rem;">
                        <i class="fa-solid fa-arrow-left"></i> Volver a buscar
                    </button>
                    <div style="text-align: center; padding: 4rem 2rem; color: var(--error);">
                        <i class="fa-solid fa-circle-exclamation" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                        <p style="font-size: 1.1rem;">${data.message || 'No se encontraron torrents'}</p>
                    </div>
                </div>
            `;
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            return;
        }
        currentSearchController = null;
        console.error('Indexer search error:', e);
        searchResults.innerHTML = `
            <div style="grid-column: 1 / -1; max-width: 1200px; margin: 0 auto; width: 100%;">
                <button class="btn secondary" onclick="location.reload()" style="margin-bottom: 2rem;">
                    <i class="fa-solid fa-arrow-left"></i> Volver a buscar
                </button>
                <div style="text-align: center; padding: 4rem 2rem; color: var(--error);">
                    <i class="fa-solid fa-circle-exclamation" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                    <p style="font-size: 1.1rem;">Error al buscar torrents</p>
                </div>
            </div>
        `;
    }
};

/**
 * Renderiza resultados de indexers
 * Líneas 463-514 de app.js
 */
function renderIndexerResults(results, movieTitle, movieYear, movie = {}) {
    if (!results || results.length === 0) {
        searchResults.innerHTML = `
            <div style="grid-column: 1 / -1; max-width: 1200px; margin: 0 auto; width: 100%;">
                <button class="btn secondary" onclick="location.reload()" style="margin-bottom: 2rem;">
                    <i class="fa-solid fa-arrow-left"></i> Volver a buscar
                </button>
                <div style="text-align: center; padding: 4rem 2rem; color: var(--text-muted);">
                    <i class="fa-solid fa-circle-xmark" style="font-size: 3rem; opacity: 0.3; margin-bottom: 1rem;"></i>
                    <p style="font-size: 1.1rem;">No se encontraron torrents para "${escapeHtml(movieTitle)}"</p>
                </div>
            </div>
        `;
        return;
    }

    const resultsHTML = `
        <div style="grid-column: 1 / -1; max-width: 1200px; margin: 0 auto; width: 100%;">
            <button class="btn secondary" onclick="location.reload()" style="margin-bottom: 2rem;">
                <i class="fa-solid fa-arrow-left"></i> Volver a buscar
            </button>
            <div style="margin-bottom: 2rem;">
                <h3 style="margin-bottom: 0.5rem; font-size: 1.5rem;">Torrents para "${escapeHtml(movieTitle)}"${movieYear ? ` (${movieYear})` : ''}</h3>
                <p style="color: var(--text-muted); font-size: 0.95rem;"><i class="fa-solid fa-circle-check" style="color: var(--success);"></i> ${results.length} resultados encontrados</p>
            </div>
            ${movie.ignored || results.some(result=>result.ignored) ? ignoredNotice() : ''}
            <div style="display: grid; gap: 1rem;">
                ${results.map(result => `
                    <div class="content-card" style="padding: 1.25rem; transition: all 0.2s ease;">
                        <div class="search-release-row" style="display: flex; justify-content: space-between; align-items: start; gap: 1.5rem;">
                            <div style="flex: 1; min-width: 0;">
                                <h4 style="margin: 0 0 0.75rem 0; font-size: 1.1rem; font-weight: 600; line-height: 1.4;">${escapeHtml(result.title || 'Sin título')}</h4>
                                <div style="display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.9rem; color: var(--text-muted);">
                                    ${result.indexer ? `<span style="display: flex; align-items: center; gap: 0.3rem;"><i class="fa-solid fa-server" style="font-size: 0.8rem;"></i>${escapeHtml(result.indexer)}</span>` : ''}
                                    ${result.size ? `<span style="display: flex; align-items: center; gap: 0.3rem;"><i class="fa-solid fa-hard-drive" style="font-size: 0.8rem;"></i>${formatBytes(result.size)}</span>` : ''}
                                    ${result.year ? `<span style="display: flex; align-items: center; gap: 0.3rem;"><i class="fa-solid fa-calendar" style="font-size: 0.8rem;"></i>${result.year}</span>` : ''}
                                    ${result.seeders !== undefined ? `<span style="display: flex; align-items: center; gap: 0.3rem; color: var(--success);"><i class="fa-solid fa-arrow-up" style="font-size: 0.8rem;"></i>${result.seeders}</span>` : ''}
                                    ${result.leechers !== undefined ? `<span style="display: flex; align-items: center; gap: 0.3rem; color: var(--warning);"><i class="fa-solid fa-arrow-down" style="font-size: 0.8rem;"></i>${result.leechers}</span>` : ''}
                                </div>
                            </div>
                            <button class="btn primary download-torrent-btn" data-url="${escapeHtml(result.download_url)}" data-title="${escapeHtml(result.title)}" data-ignored="${Boolean(movie.ignored || result.ignored)}" style="white-space: nowrap; flex-shrink: 0;">
                                <i class="fa-solid fa-download"></i> ${movie.ignored || result.ignored ? 'Restaurar y descargar' : 'Descargar'}
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    searchResults.innerHTML = resultsHTML;

    // Attach event listeners to download buttons
    attachDownloadListeners(movie);
}

/**
 * Adjunta event listeners a botones de descarga
 */
function attachDownloadListeners(movie) {
    searchResults.querySelectorAll('.download-torrent-btn').forEach(btn => {
        btn.addEventListener('click', async function () {
            const url = this.dataset.url;
            const title = this.dataset.title;
            await downloadTorrent(url, title, this, {...movie,restore_ignored:this.dataset.ignored==='true'});
        });
    });
}

/**
 * Descarga un torrent
 * Líneas 524-582 de app.js
 */
function ignoredNotice() {
    return '<div class="search-ignored-banner" role="status"><strong>Esta película está en la lista de ignorados.</strong> Si eliges «Restaurar y descargar», se quitará de esa lista y volverá al panel. La copia automática seguirá tu configuración.</div>';
}

async function downloadTorrent(url, title, btnElement, movie) {
    const originalContent = btnElement.innerHTML;
    btnElement.disabled = true;
    btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Añadiendo…';

    const data = await addTorrent(url, title, movie);

    if (data.success) {
        showToast(data.message || 'Torrent añadido al cliente de descargas', 'success');

        btnElement.innerHTML = '<i class="fa-solid fa-check"></i> Añadida';
        btnElement.classList.remove('primary');
        btnElement.classList.add('success');

        // Navigate to movie details if we have a hash
        if (data.hash) {
            showRedirectOverlay();
            setTimeout(async () => {
                const { showMovieDetails, fetchMovies } = await import('./movies.js');
                await fetchMovies(true);
                showMovieDetails(data.hash);
                removeRedirectOverlay();
            }, 2500);
        } else {
            setTimeout(async () => {
                const { fetchMovies } = await import('./movies.js');
                await fetchMovies(true);
                switchView('dashboard');
            }, 1000);
        }
    } else if (data.status === 'ignored') {
        if (!searchResults.querySelector('.search-ignored-banner')) searchResults.insertAdjacentHTML('afterbegin',ignoredNotice());
        btnElement.dataset.ignored='true';
        btnElement.disabled=false;
        btnElement.innerHTML='<i class="fa-solid fa-download"></i> Restaurar y descargar';
        showToast(data.message,'info');
    } else {
        showToast(data.message || 'No se pudo añadir el torrent', 'error');
        btnElement.disabled = false;
        btnElement.innerHTML = originalContent;
    }
}
