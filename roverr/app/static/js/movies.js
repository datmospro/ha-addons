/**
 * Módulo de Películas para Roverr
 * Gestiona la vista de detalles de películas y multi-selección
 * Extraído de app.js - líneas 1056-1237, 1239-1567, 1587-1838
 */

import { state } from './state.js';
import {
    getMovies, getMovieDetails, identifyMovie as apiIdentifyMovie,
    batchCopyMovies, batchDeleteMovies, stopCopy as apiStopCopy,
    searchIndexers, addTorrent
} from './api.js';
import { showToast, formatBytes, getProgressClass, escapeHtml, openModal, closeModal } from './ui.js';
import { getStatusClass, getStatusIconAndLabel } from './templates.js';
import { switchView, getCurrentView } from './navigation.js';

/**
 * Converts ISO 3166-1 country code to flag image
 * Uses flagcdn.com for universal browser compatibility
 * @param {string} code - Two-letter country code (e.g., 'US', 'ES', 'FR')
 * @returns {string} - Flag image HTML or empty string if invalid
 */
function countryCodeToFlag(code) {
    if (!code || code.length !== 2) {
        return '';
    }
    const countryCode = code.toLowerCase();
    // Using flagcdn.com for 28px width flag images
    return `<img src="https://flagcdn.com/w40/${countryCode}.png" 
                 srcset="https://flagcdn.com/w80/${countryCode}.png 2x" 
                 width="28" 
                 alt="${code} flag" 
                 style="display: inline-block; vertical-align: middle; margin-right: 4px;">`;
}

/**
 * Gets country name from country code for tooltip
 * @param {string} code - Two-letter country code
 * @returns {string} - Country name or code if unknown
 */
function getCountryName(code) {
    const countries = {
        'US': 'United States', 'GB': 'United Kingdom', 'FR': 'France', 'DE': 'Germany',
        'ES': 'Spain', 'IT': 'Italy', 'JP': 'Japan', 'KR': 'South Korea', 'CN': 'China',
        'IN': 'India', 'CA': 'Canada', 'AU': 'Australia', 'MX': 'Mexico', 'BR': 'Brazil',
        'RU': 'Russia', 'AR': 'Argentina', 'NZ': 'New Zealand', 'SE': 'Sweden', 'NO': 'Norway',
        'DK': 'Denmark', 'FI': 'Finland', 'NL': 'Netherlands', 'BE': 'Belgium', 'CH': 'Switzerland',
        'AT': 'Austria', 'PL': 'Poland', 'CZ': 'Czech Republic', 'IE': 'Ireland', 'PT': 'Portugal',
        'GR': 'Greece', 'TR': 'Turkey', 'TH': 'Thailand', 'ID': 'Indonesia', 'PH': 'Philippines',
        'IL': 'Israel', 'SA': 'Saudi Arabia', 'EG': 'Egypt', 'ZA': 'South Africa', 'NG': 'Nigeria'
    };
    return countries[code] || code;
}

// Referencias DOM
let moviesGrid;
let selectionCounter;
let selectAllBtn;
let deselectAllBtn;
let copySelectedBtn;
let deleteSelectedBtn;
let deleteModal;

/**
 * Inicializa el módulo de películas
 */
export function initMovies() {
    moviesGrid = document.getElementById('movies-grid');
    selectionCounter = document.getElementById('selection-counter');
    selectAllBtn = document.getElementById('select-all-btn');
    deselectAllBtn = document.getElementById('deselect-all-btn');
    copySelectedBtn = document.getElementById('copy-selected-btn');
    deleteSelectedBtn = document.getElementById('delete-selected-btn');
    deleteModal = document.getElementById('delete-modal');

    setupMultiSelect();

    // Setup manual search modal close button
    const manualSearchModal = document.getElementById('manual-search-modal');
    const manualSearchCloseBtn = document.getElementById('manual-search-close-btn');

    if (manualSearchCloseBtn && manualSearchModal) {
        manualSearchCloseBtn.addEventListener('click', () => {
            manualSearchModal.classList.remove('active');
        });

        // Close on backdrop click
        manualSearchModal.addEventListener('click', (e) => {
            if (e.target === manualSearchModal) {
                manualSearchModal.classList.remove('active');
            }
        });
    }
}

/**
 * Carga y renderiza las películas
 * Líneas 1056-1237 de app.js
 */
export async function fetchMovies(isPolling = false) {
    if (!moviesGrid) return;

    if (!isPolling && moviesGrid.children.length === 0) {
        moviesGrid.innerHTML = '<div style="text-align: center; grid-column: 1/-1;">Loading movies...</div>';
    }

    const data = await getMovies();
    const movies = data.movies;
    const ignored = data.ignored_series;

    // Update Series Notification
    updateSeriesNotification(ignored);

    if (movies.length === 0) {
        moviesGrid.innerHTML = '<div style="text-align: center; grid-column: 1/-1;">No movies found.</div>';
        return;
    }

    // Check if grid has non-card children
    if (moviesGrid.querySelector(':not(.movie-card)')) {
        moviesGrid.innerHTML = '';
    }

    renderMovieCards(movies);
}

/**
 * Actualiza la notificación de series ignoradas
 */
function updateSeriesNotification(ignored) {
    const notificationArea = document.getElementById('series-notification');
    if (!notificationArea) return;

    if (ignored.length > 0) {
        notificationArea.innerHTML = `
            <div class="series-badge" title="Ignored Series:\n${ignored.join('\n')}">
                <i class="fa-solid fa-tv"></i> ${ignored.length} Series Ignored
            </div>
        `;
        notificationArea.style.display = 'block';
    } else {
        notificationArea.style.display = 'none';
    }
}

/**
 * Renderiza las tarjetas de películas
 */
function renderMovieCards(movies) {
    // Map existing cards
    const existingCards = new Map();
    moviesGrid.querySelectorAll('.movie-card').forEach(card => {
        existingCards.set(card.dataset.hash, card);
    });

    movies.forEach(movie => {
        let card = existingCards.get(movie.torrent_hash);
        const { icon: statusIcon, label: statusLabel } = getStatusIconAndLabel(movie.status);
        const statusClass = getStatusClass(movie.status);

        // Use poster_updated timestamp for cache-busting (only changes when poster updates)
        const cacheKey = movie.poster_updated || movie.torrent_hash.substring(0, 8);
        const posterSrc = movie.poster_url
            ? `${movie.poster_url}?v=${cacheKey}`
            : 'https://via.placeholder.com/300x450?text=No+Cover';

        if (card) {
            // Update existing card
            existingCards.delete(movie.torrent_hash);
            updateMovieCard(card, movie, posterSrc, statusClass, statusIcon, statusLabel);
        } else {
            // Create new card
            card = createMovieCard(movie, posterSrc, statusClass, statusIcon, statusLabel);
            moviesGrid.appendChild(card);
        }
    });

    // Remove stale cards
    existingCards.forEach(card => card.remove());

    // Update selection UI
    updateSelectionUI();
}

/**
 * Actualiza una tarjeta de película existente
 */
function updateMovieCard(card, movie, posterSrc, statusClass, statusIcon, statusLabel) {
    card.dataset.movie = JSON.stringify({
        torrent_hash: movie.torrent_hash,
        title: movie.title,
        status: movie.status
    });
    card.dataset.backdrop = movie.backdrop_url || '';

    const img = card.querySelector('img');
    if (img.getAttribute('src') !== posterSrc) img.src = posterSrc;

    const overlay = card.querySelector('.overlay-status');
    overlay.className = `overlay-status ${statusClass}`;
    overlay.innerHTML = `${statusIcon} ${statusLabel}`;
    // Update tooltip for 'new' status with reason
    if (movie.status === 'new' && movie.status_reason) {
        overlay.setAttribute('title', movie.status_reason);
    } else {
        overlay.removeAttribute('title');
    }

    const title = card.querySelector('.movie-title');
    if (title.textContent !== movie.title) title.textContent = movie.title;

    const meta = card.querySelector('.movie-meta');
    meta.innerHTML = `<span>${movie.year || 'N/A'}</span>${movie.size > 0 ? `<span>${formatBytes(movie.size)}</span>` : ''}`;

    const progressBar = card.querySelector('.progress-bar');
    if (movie.status === 'moved' || movie.status === 'skipped' || movie.status === 'error' || movie.status === 'receptor_offline') {
        progressBar.style.display = 'none';
    } else {
        progressBar.style.display = 'block';
        const fill = card.querySelector('.progress-bar .fill');
        fill.className = `fill ${movie.status === 'copying' ? 'copying' : getProgressClass(movie.state)}`;

        let progressPercent = movie.progress * 100;
        if (movie.status === 'copying' && movie.copy_progress) {
            progressPercent = movie.copy_progress.percent;
        }
        fill.style.width = `${progressPercent}%`;
    }
}

/**
 * Crea una nueva tarjeta de película
 */
function createMovieCard(movie, posterSrc, statusClass, statusIcon, statusLabel) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    card.dataset.hash = movie.torrent_hash;
    card.dataset.backdrop = movie.backdrop_url || '';
    card.dataset.movie = JSON.stringify({
        torrent_hash: movie.torrent_hash,
        title: movie.title,
        status: movie.status
    });

    card.innerHTML = `
        <input type="checkbox" class="movie-card-checkbox">
        <div class="poster-wrapper">
            <img src="${posterSrc}" alt="${escapeHtml(movie.title)}" loading="lazy">
            <div class="overlay-status ${statusClass}"${movie.status === 'new' && movie.status_reason ? ` title="${escapeHtml(movie.status_reason)}"` : ''}>
                ${statusIcon} ${statusLabel}
            </div>
        </div>
        <div class="movie-info">
            <div class="movie-title" title="${escapeHtml(movie.title)}">${escapeHtml(movie.title)}</div>
            <div class="movie-meta">
                <span>${movie.year || 'N/A'}</span>
                ${movie.size > 0 ? `<span>${formatBytes(movie.size)}</span>` : ''}
            </div>
        </div>
        </div>
        <div class="progress-bar" style="display: ${['moved', 'skipped', 'error', 'receptor_offline'].includes(movie.status) ? 'none' : 'block'}">
            <div class="fill ${movie.status === 'copying' ? 'copying' : getProgressClass(movie.state)}" 
                 style="width: ${(movie.status === 'copying' && movie.copy_progress) ? movie.copy_progress.percent : movie.progress * 100}%"></div>
        </div>
    `;

    // Event listeners
    card.addEventListener('click', (e) => {
        if (!e.target.classList.contains('movie-card-checkbox')) {
            showMovieDetails(movie.torrent_hash);
        }
    });

    const checkbox = card.querySelector('.movie-card-checkbox');
    checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMovieSelection(movie.torrent_hash, {
            torrent_hash: movie.torrent_hash,
            title: movie.title,
            status: movie.status
        }, e);
    });

    // Dashboard hover reactivity
    card.addEventListener('mouseenter', () => {
        const globalBackdrop = document.getElementById('global-backdrop');
        const backdropUrl = card.dataset.backdrop;
        if (globalBackdrop && backdropUrl && document.getElementById('view-dashboard').classList.contains('active')) {
            globalBackdrop.style.backgroundImage = `url('${backdropUrl}')`;
            globalBackdrop.style.opacity = '0.08'; // Very subtle ambient glow for dashboard
        }
    });

    card.addEventListener('mouseleave', () => {
        const globalBackdrop = document.getElementById('global-backdrop');
        if (globalBackdrop && document.getElementById('view-dashboard').classList.contains('active')) {
            globalBackdrop.style.opacity = '0';
            setTimeout(() => {
                if (globalBackdrop.style.opacity === '0') {
                    globalBackdrop.style.backgroundImage = 'none';
                }
            }, 800);
        }
    });

    return card;
}

/**
 * Muestra los detalles de una película
 * Líneas 1239-1438 de app.js
 */
export async function showMovieDetails(hash) {
    switchView('movie-details');
    const container = document.getElementById('movie-details-content');
    container.setAttribute('data-hash', hash);
    container.innerHTML = '<div style="text-align: center; padding: 2rem;">Loading details...</div>';

    const movie = await getMovieDetails(hash);

    if (movie.error) {
        container.innerHTML = `<div class="error-message">${movie.error}</div>`;
        return;
    }

    renderMovieDetails(container, movie, hash);

    // Only poll for states that can change
    const activeStates = ['downloading', 'copying', 'pending', 'new'];
    if (activeStates.includes(movie.status)) {
        startDetailsPolling(hash, movie.status);
    }
}

/**
 * Renderiza los detalles de una película
 */
function renderMovieDetails(container, movie, hash) {
    console.log('renderMovieDetails called with movie:', movie.title, 'country_code:', movie.country_code);
    const runtime = movie.runtime ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : 'N/A';
    const { icon: statusIcon, label: statusLabel } = getStatusIconAndLabel(movie.status);
    const statusClass = getStatusClass(movie.status);

    const castHTML = movie.cast && movie.cast.length > 0 ? movie.cast.map(person => `
        <div class="cast-card">
            <img src="${person.profile_path || 'https://via.placeholder.com/185x278?text=No+Photo'}" alt="${escapeHtml(person.name)}">
            <div class="cast-name">${escapeHtml(person.name)}</div>
            <div class="cast-character">como ${escapeHtml(person.character)}</div>
        </div>
    `).join('') : '<p>No cast information available.</p>';

    const crewHTML = movie.crew && movie.crew.length > 0 ? movie.crew.map(person => `
        <div class="cast-card">
            <img src="${person.profile_path || 'https://via.placeholder.com/185x278?text=No+Photo'}" alt="${escapeHtml(person.name)}">
            <div class="cast-name">${escapeHtml(person.name)}</div>
            <div class="cast-character">como ${escapeHtml(person.job)}</div>
        </div>
    `).join('') : '<p>No crew information available.</p>';

    // Update global cinematic backdrop
    const globalBackdrop = document.getElementById('global-backdrop');
    if (globalBackdrop) {
        if (movie.backdrop_url) {
            globalBackdrop.style.backgroundImage = `url('${movie.backdrop_url}')`;
            globalBackdrop.style.opacity = '0.18';
        } else {
            globalBackdrop.style.backgroundImage = 'none';
            globalBackdrop.style.opacity = '0';
        }
    }

    // Este es el mismo HTML que en app.js líneas 1312-1428
    container.innerHTML = `
        <div class="movie-sticky-header">
            <div class="header-top">
                <h2>Movie Details</h2>
                <button class="btn secondary back-to-dashboard"><i class="fa-solid fa-arrow-left"></i> Back</button>
            </div>
            <div class="movie-action-bar">
                ${movie.status !== 'moved' && movie.status !== 'copying' && movie.status !== 'receptor_offline' ?
            `<button class="btn primary move-now-btn" data-hash="${movie.torrent_hash}"><i class="fa-solid fa-play"></i> Move Now</button>` : ''}
                ${movie.status === 'copying' ?
            `<button class="btn danger stop-copy-btn" data-hash="${movie.torrent_hash}"><i class="fa-solid fa-stop"></i> Stop Copy</button>` : ''}
                ${movie.status === 'missing' || movie.status === 'receptor_offline' ?
            `<button class="btn warning retry-move-btn" data-hash="${hash}"><i class="fa-solid fa-rotate-right"></i> Retry Move</button>` : ''}
                <button class="btn secondary identify-btn" data-hash="${hash}"><i class="fa-solid fa-magnifying-glass"></i> Identify Manually</button>
                <button class="btn secondary manual-search-btn" data-hash="${hash}"><i class="fa-solid fa-globe"></i> Manual Search</button>
                <button class="btn danger delete-movie-btn" data-hash="${hash}"><i class="fa-solid fa-trash"></i> Remove from Dashboard</button>
            </div>
        </div>
        
        <div class="movie-details-layout">
            <div class="movie-poster-large">
                <img src="${movie.poster_url ? `${movie.poster_url}?v=${movie.poster_updated || 0}` : 'https://via.placeholder.com/500x750?text=No+Cover'}" alt="${escapeHtml(movie.title)}">
            </div>
            <div class="movie-info-panel">
                <h1>${escapeHtml(movie.title)} <span class="year">(${movie.year || 'N/A'})</span></h1>
                
                
                <div class="meta-row">
                    <span class="badge status ${statusClass}"${movie.status === 'new' && movie.status_reason ? ` title="${escapeHtml(movie.status_reason)}"` : ''}>${statusIcon} ${statusLabel}</span>
                    <span class="badge runtime"><i class="fa-regular fa-clock"></i> ${runtime}</span>
                    <span class="badge size"><i class="fa-solid fa-hard-drive"></i> ${movie.size > 0 ? formatBytes(movie.size) : 'N/A'}</span>
                    ${movie.country_code ? `<span class="badge country" title="${escapeHtml(getCountryName(movie.country_code))}"><span class="flag-emoji">${countryCodeToFlag(movie.country_code)}</span></span>` : ''}
                    <button class="badge trailer-badge" data-hash="${hash}" title="Trailer" aria-label="Play YouTube trailer"><i class="fa-brands fa-youtube"></i></button>
                </div>
                
                ${movie.status === 'copying' && movie.copy_progress ? `
                <div class="details-progress-container">
                    <div class="progress-info">
                        <span>Copying... ${movie.copy_progress.percent}%</span>
                        <span>${movie.copy_progress.speed} MB/s</span>
                    </div>
                    <div class="progress-bar large">
                        <div class="details-progress-fill copying" style="width: ${movie.copy_progress.percent}%"></div>
                    </div>
                </div>` : ''}
                
                ${movie.status === 'downloading' && movie.download_stats ? `
                <div class="details-progress-container">
                    <div class="progress-info">
                        <span>Downloading... ${movie.download_stats.progress.toFixed(1)}%</span>
                        <span>${movie.download_stats.speed} MB/s</span>
                    </div>
                    <div class="progress-bar large">
                        <div class="details-progress-fill downloading" style="width: ${movie.download_stats.progress}%"></div>
                    </div>
                </div>` : ''}
                
                <div class="ratings-section">
                    <h3>Ratings</h3>
                    <div class="ratings-grid">
                        <div class="rating-badge tmdb ${movie.tmdb_id ? 'clickable' : ''}" ${movie.tmdb_id ? `data-url="https://www.themoviedb.org/movie/${movie.tmdb_id}"` : ''} title="${movie.tmdb_id ? 'View on TMDB' : ''}">
                            <div class="rating-source">TMDB</div>
                            <div class="rating-value">${movie.vote_average ? movie.vote_average.toFixed(1) : 'N/A'}</div>
                            <div class="rating-count">${movie.vote_count ? `${movie.vote_count} votes` : ''}</div>
                        </div>
                        ${movie.imdb_id ? `
                        <div class="rating-badge imdb clickable" data-url="https://www.imdb.com/title/${movie.imdb_id}" title="View on IMDb">
                            <div class="rating-source">IMDb</div>
                            <div class="rating-value">${movie.imdb_rating || 'N/A'}</div>
                            <div class="rating-count">${movie.imdb_votes ? `${movie.imdb_votes} votes` : ''}</div>
                        </div>` : ''}
                    </div>
                </div>
                
                <div class="paths-box">
                    <div class="path-item">
                        <label>Current Location:</label>
                        ${movie.source_path && movie.source_path !== 'N/A' ? `<code>${escapeHtml(movie.source_path)}</code>` : '<span class="badge secondary" style="background: var(--bg-tertiary); color: var(--text-muted); border: 1px solid var(--border); font-size: 0.85rem; padding: 0.25rem 0.6rem; border-radius: 6px;">Not available</span>'}
                    </div>
                    <div class="path-item">
                        <label>Destination:</label>
                        ${movie.dest_path && movie.dest_path !== 'N/A' ? `<code>${escapeHtml(movie.dest_path)}</code>` : '<span class="badge secondary" style="background: var(--bg-tertiary); color: var(--text-muted); border: 1px solid var(--border); font-size: 0.85rem; padding: 0.25rem 0.6rem; border-radius: 6px;">Not available</span>'}
                    </div>
                </div>
                
                <div class="synopsis">
                    <h3>Synopsis</h3>
                    <p>${movie.overview || 'No synopsis available.'}</p>
                </div>
                
                <div class="cast-section">
                    <h3>Reparto</h3>
                    <div class="carousel-wrapper">
                        <button class="carousel-nav carousel-prev" data-carousel="cast" aria-label="Previous actors"><i class="fa-solid fa-chevron-left"></i></button>
                        <div class="cast-carousel">${castHTML}</div>
                        <button class="carousel-nav carousel-next" data-carousel="cast" aria-label="Next actors"><i class="fa-solid fa-chevron-right"></i></button>
                    </div>
                </div>
                
                <div class="crew-section">
                    <h3>Equipo</h3>
                    <div class="carousel-wrapper">
                        <button class="carousel-nav carousel-prev" data-carousel="crew" aria-label="Previous crew members"><i class="fa-solid fa-chevron-left"></i></button>
                        <div class="cast-carousel">${crewHTML}</div>
                        <button class="carousel-nav carousel-next" data-carousel="crew" aria-label="Next crew members"><i class="fa-solid fa-chevron-right"></i></button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Attach event listeners
    setupMovieDetailsListeners(hash);
}

/**
 * Configura los event listeners de la vista de detalles
 */
function setupMovieDetailsListeners(hash) {
    const container = document.getElementById('movie-details-content');

    const backBtn = container.querySelector('.back-to-dashboard');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            const globalBackdrop = document.getElementById('global-backdrop');
            if (globalBackdrop) {
                globalBackdrop.style.opacity = '0';
                setTimeout(() => {
                    if (globalBackdrop.style.opacity === '0') {
                        globalBackdrop.style.backgroundImage = 'none';
                    }
                }, 800);
            }
            switchView('dashboard');
        });
    }

    const moveBtn = container.querySelector('.move-now-btn');
    if (moveBtn) {
        moveBtn.addEventListener('click', async () => {
            // Import dynamically to avoid circular dependency
            const { manualMove } = await import('./dashboard.js');
            await manualMove(hash);
        });
    }

    const stopBtn = container.querySelector('.stop-copy-btn');
    if (stopBtn) {
        stopBtn.addEventListener('click', () => stopCopy(hash));
    }

    const retryBtn = container.querySelector('.retry-move-btn');
    if (retryBtn) {
        retryBtn.addEventListener('click', async () => {
            const { manualMove } = await import('./dashboard.js');
            await manualMove(hash);
        });
    }

    const identifyBtn = container.querySelector('.identify-btn');
    if (identifyBtn) {
        identifyBtn.addEventListener('click', () => identifyMovie(hash));
    }

    const deleteBtn = container.querySelector('.delete-movie-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => deleteMovie(hash));
    }

    const manualSearchBtn = container.querySelector('.manual-search-btn');
    if (manualSearchBtn) {
        manualSearchBtn.addEventListener('click', () => handleManualSearch(hash));
    }

    const trailerBtn = container.querySelector('.trailer-badge');
    if (trailerBtn) {
        trailerBtn.addEventListener('click', () => showTrailerModal(hash));
    }

    // Carousel navigation buttons
    const carouselNavButtons = container.querySelectorAll('.carousel-nav');
    carouselNavButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const isNext = btn.classList.contains('carousel-next');
            const carouselType = btn.dataset.carousel;

            // Find the carousel wrapper and the carousel itself
            const wrapper = btn.closest('.carousel-wrapper');
            const carousel = wrapper.querySelector('.cast-carousel');

            if (carousel) {
                const scrollAmount = 300; // Scroll 300px at a time
                const currentScroll = carousel.scrollLeft;
                const newScroll = isNext
                    ? currentScroll + scrollAmount
                    : currentScroll - scrollAmount;

                carousel.scrollTo({
                    left: newScroll,
                    behavior: 'smooth'
                });
            }
        });
    });

    // Clickable rating badges (TMDB/IMDB links)
    const ratingBadges = container.querySelectorAll('.rating-badge.clickable[data-url]');
    ratingBadges.forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const url = badge.dataset.url;
            if (url) {
                window.open(url, '_blank', 'noopener');
            }
        });
    });
}

// Polling para detalles
let detailsPollInterval = null;
let lastKnownStatus = null;

function startDetailsPolling(hash, initialStatus) {
    if (detailsPollInterval) clearInterval(detailsPollInterval);
    lastKnownStatus = initialStatus;

    detailsPollInterval = setInterval(async () => {
        const container = document.getElementById('movie-details-content');
        if (getCurrentView() !== 'movie-details' || !container || container.getAttribute('data-hash') !== hash) {
            stopDetailsPolling();
            return;
        }

        const movie = await getMovieDetails(hash);

        // Detect status changes
        if (lastKnownStatus !== movie.status) {
            console.log(`Status changed from ${lastKnownStatus} to ${movie.status}`);
            lastKnownStatus = movie.status;

            // Re-render entire view on status change to show/hide UI elements
            renderMovieDetails(container, movie, hash);

            // If status changed to a final state, stop polling (no more changes expected)
            const finalStates = ['moved', 'moved_manually', 'skipped', 'error', 'orphaned', 'missing', 'receptor_offline'];
            if (finalStates.includes(movie.status)) {
                console.log('Movie reached final state, stopping polling');
                stopDetailsPolling();
                return;
            }

            // Continue polling for other states
            return;
        }

        // No status change - only update progress bars if copying/downloading (smooth, no flicker)
        if (movie.status === 'copying' && movie.copy_progress) {
            updateProgressUI(movie.copy_progress, 'copying');
        } else if (movie.status === 'downloading' && movie.download_stats) {
            updateProgressUI(movie.download_stats, 'downloading');
        }
    }, 1000);
}

function stopDetailsPolling() {
    if (detailsPollInterval) {
        clearInterval(detailsPollInterval);
        detailsPollInterval = null;
        lastKnownStatus = null;
    }
}

function updateProgressUI(progress, type) {
    const container = document.querySelector('.details-progress-container');
    if (!container) return;

    const percentEl = container.querySelector('.progress-info span:first-child');
    const speedEl = container.querySelector('.progress-info span:last-child');
    const barEl = container.querySelector('.progress-bar .details-progress-fill');

    const label = type === 'copying' ? 'Copying...' : 'Downloading...';
    const percent = type === 'copying' ? progress.percent : progress.progress.toFixed(1);

    if (percentEl) percentEl.textContent = `${label} ${percent}%`;
    if (speedEl) speedEl.textContent = `${progress.speed} MB/s`;
    if (barEl) {
        barEl.style.width = `${percent}%`;
        barEl.className = `details-progress-fill ${type}`;
    }
}

let currentIdentifyHash = null;

async function identifyMovie(hash) {
    currentIdentifyHash = hash;
    const movie = await getMovieDetails(hash);
    if (movie.error) {
        showToast('Error loading movie details', 'error');
        return;
    }

    const modal = document.getElementById('identify-modal');
    if (!modal) {
        showToast('Identification modal not loaded', 'error');
        return;
    }

    const searchInput = document.getElementById('identify-search-input');
    const searchBtn = document.getElementById('identify-search-btn');
    const cancelBtn = document.getElementById('identify-modal-cancel-btn');
    const closeBtn = document.getElementById('identify-modal-close-btn');
    const resultsEl = document.getElementById('identify-search-results');
    const loadingEl = document.getElementById('identify-search-loading');

    // Setup input value
    searchInput.value = movie.title || '';
    resultsEl.innerHTML = '<p class="empty-state" style="text-align: center; color: var(--text-muted); font-style: italic; padding: 2rem 0;">Click Search to find matches.</p>';
    loadingEl.style.display = 'none';

    // Show modal
    openModal('identify-modal');

    // Attach search event
    const newSearchBtn = searchBtn.cloneNode(true);
    searchBtn.parentNode.replaceChild(newSearchBtn, searchBtn);
    newSearchBtn.addEventListener('click', () => performIdentifySearch(searchInput.value.trim()));

    searchInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            performIdentifySearch(searchInput.value.trim());
        }
    };

    // Attach cancel/close events
    cancelBtn.onclick = () => closeModal('identify-modal');
    closeBtn.onclick = () => closeModal('identify-modal');
}

async function performIdentifySearch(query) {
    if (!query) {
        showToast('Please enter a movie title', 'warning');
        return;
    }

    const resultsEl = document.getElementById('identify-search-results');
    const loadingEl = document.getElementById('identify-search-loading');

    resultsEl.innerHTML = '';
    loadingEl.style.display = 'block';

    try {
        const { searchTMDB } = await import('./api.js');
        const data = await searchTMDB(query);
        loadingEl.style.display = 'none';

        if (!data.success) {
            resultsEl.innerHTML = `<div style="text-align: center; color: var(--danger); padding: 2rem;">Error: ${data.message}</div>`;
            return;
        }

        if (!data.results || data.results.length === 0) {
            resultsEl.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No matches found on TMDB.</div>`;
            return;
        }

        renderIdentifySearchResults(resultsEl, data.results);
    } catch (e) {
        console.error(e);
        loadingEl.style.display = 'none';
        resultsEl.innerHTML = `<div style="text-align: center; color: var(--danger); padding: 2rem;">Error performing search</div>`;
    }
}

function renderIdentifySearchResults(container, results) {
    container.innerHTML = results.map(movie => `
        <div class="identify-movie-result-item" 
             style="display: flex; gap: 1rem; padding: 0.75rem; border-bottom: 1px solid var(--border); border-radius: 8px; cursor: pointer; transition: background 0.2s;"
             onclick="window.executeIdentifyMovie('${movie.tmdb_id}', '${escapeHtml(movie.title)}')">
            <img src="${movie.poster || 'https://via.placeholder.com/60x90?text=No+Cover'}" 
                 alt="${escapeHtml(movie.title)}" 
                 style="width: 50px; height: 75px; object-fit: cover; border-radius: 4px; flex-shrink: 0; background: var(--bg-tertiary);">
            <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center;">
                <div style="font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1rem;">
                    ${escapeHtml(movie.title)} ${movie.year ? `<span style="font-weight: 400; color: var(--text-muted); font-size: 0.9rem;">(${movie.year})</span>` : ''}
                </div>
                ${movie.original_title && movie.original_title !== movie.title ? `
                    <div style="font-size: 0.85rem; color: var(--text-muted); font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        Título original: ${escapeHtml(movie.original_title)}
                    </div>
                ` : ''}
                <div style="font-size: 0.85rem; color: var(--text-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 0.25rem; line-height: 1.4;">
                    ${escapeHtml(movie.overview) || 'Sin descripción disponible.'}
                </div>
            </div>
        </div>
    `).join('');
    
    // Hover effect dynamically
    container.querySelectorAll('.identify-movie-result-item').forEach(item => {
        item.addEventListener('mouseenter', () => item.style.backgroundColor = 'var(--bg-tertiary)');
        item.addEventListener('mouseleave', () => item.style.backgroundColor = 'transparent');
    });
}

window.executeIdentifyMovie = async function (tmdbId, title) {
    if (!currentIdentifyHash) return;
    
    closeModal('identify-modal');
    showToast(`Identifying torrent as "${title}"...`, 'info');
    
    try {
        const data = await apiIdentifyMovie(currentIdentifyHash, tmdbId);
        if (data.success) {
            showToast('Movie identified successfully!', 'success');
            showMovieDetails(currentIdentifyHash);
            
            // Also refresh dashboard to update titles/poster
            const { fetchMovies } = await import('./movies.js');
            await fetchMovies();
        } else {
            showToast(data.message || 'Error identifying movie', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('Error identifying movie', 'error');
    }
}

async function deleteMovie(hash) {
    deselectAllMovies();

    const card = document.querySelector(`.movie-card[data-hash="${hash}"]`);
    let movieData = { torrent_hash: hash, status: 'unknown' };
    if (card && card.dataset.movie) {
        movieData = JSON.parse(card.dataset.movie);
    }

    state.selectMovie(hash, movieData);
    updateSelectionUI();

    if (deleteModal) {
        deleteModal.classList.add('active');
    }
}

async function stopCopy(hash) {
    if (!confirm("Are you sure you want to stop the copy process?")) return;

    const data = await apiStopCopy(hash);

    if (data.success) {
        showToast('Copy process stopped', 'success');
        showMovieDetails(hash);
    } else {
        showToast(data.message, 'error');
    }
}

// Context for manual search - stores current movie info for custom searches
let manualSearchContext = {
    hash: null,
    title: '',
    tmdbId: null
};

async function handleManualSearch(hash) {
    const movie = await getMovieDetails(hash);
    if (movie.error) {
        showToast('Error loading movie details', 'error');
        return;
    }

    // Store context for custom searches
    manualSearchContext = {
        hash: hash,
        title: movie.title,
        tmdbId: movie.tmdb_id
    };

    const modal = document.getElementById('manual-search-modal');
    const titleEl = modal.querySelector('.modal-title');
    const searchInput = document.getElementById('manual-search-input');
    const searchSubmitBtn = document.getElementById('manual-search-submit-btn');
    const loadingEl = document.getElementById('manual-search-loading');
    const resultsEl = document.getElementById('manual-search-results');

    titleEl.textContent = `Manual Search: ${movie.title}`;

    // Set input to movie title
    searchInput.value = movie.title;

    resultsEl.innerHTML = '';
    loadingEl.style.display = 'block';
    modal.classList.add('active');

    // Setup search button listener (remove previous to avoid duplicates)
    const newSearchBtn = searchSubmitBtn.cloneNode(true);
    searchSubmitBtn.parentNode.replaceChild(newSearchBtn, searchSubmitBtn);
    newSearchBtn.addEventListener('click', () => performCustomSearch());

    // Setup Enter key listener for input
    searchInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            performCustomSearch();
        }
    };

    // Perform initial search with title and optionally tmdb_id for intelligent multi-language search
    const data = await searchIndexers(movie.title, movie.tmdb_id);
    loadingEl.style.display = 'none';

    if (!data.success) {
        resultsEl.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--danger);">Error: ${data.message}</div>`;
        return;
    }

    if (data.results.length === 0) {
        resultsEl.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--text-muted);">
            <i class="fa-solid fa-search" style="font-size: 2rem; opacity: 0.5; margin-bottom: 0.5rem;"></i>
            <p>No results found for "<strong>${escapeHtml(movie.title)}</strong>"</p>
            <p style="font-size: 0.9rem; margin-top: 0.5rem;">Try modifying the search query above and click Search.</p>
        </div>`;
        return;
    }

    renderManualSearchResults(resultsEl, data.results, movie.title, hash);
}

async function performCustomSearch() {
    const searchInput = document.getElementById('manual-search-input');
    const loadingEl = document.getElementById('manual-search-loading');
    const resultsEl = document.getElementById('manual-search-results');

    const customQuery = searchInput.value.trim();
    if (!customQuery) {
        showToast('Please enter a search query', 'warning');
        return;
    }

    resultsEl.innerHTML = '';
    loadingEl.style.display = 'block';

    // Search with custom query (no tmdb_id to allow free-form search)
    const data = await searchIndexers(customQuery);
    loadingEl.style.display = 'none';

    if (!data.success) {
        resultsEl.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--danger);">Error: ${data.message}</div>`;
        return;
    }

    if (data.results.length === 0) {
        resultsEl.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--text-muted);">
            <i class="fa-solid fa-search" style="font-size: 2rem; opacity: 0.5; margin-bottom: 0.5rem;"></i>
            <p>No results found for "<strong>${escapeHtml(customQuery)}</strong>"</p>
            <p style="font-size: 0.9rem; margin-top: 0.5rem;">Try a different search query.</p>
        </div>`;
        return;
    }

    // Use original movie title for download association
    renderManualSearchResults(resultsEl, data.results, manualSearchContext.title, manualSearchContext.hash);
}

function renderManualSearchResults(container, results, movieTitle, originalHash) {
    container.innerHTML = `
        <div style="display: grid; gap: 1rem;">
            ${results.map(result => `
                <div class="content-card" style="padding: 1.25rem; transition: all 0.2s ease;">
                    <div style="display: flex; justify-content: space-between; align-items: start; gap: 1.5rem;">
                        <div style="flex: 1; min-width: 0;">
                            <h4 style="margin: 0 0 0.75rem 0; font-size: 1.1rem; font-weight: 600; line-height: 1.4;">${escapeHtml(result.title)}</h4>
                            <div style="display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.9rem; color: var(--text-muted);">
                                ${result.indexer ? `<span style="display: flex; align-items: center; gap: 0.3rem;"><i class="fa-solid fa-server" style="font-size: 0.8rem;"></i>${escapeHtml(result.indexer)}</span>` : ''}
                                ${result.size ? `<span style="display: flex; align-items: center; gap: 0.3rem;"><i class="fa-solid fa-hard-drive" style="font-size: 0.8rem;"></i>${formatBytes(result.size)}</span>` : ''}
                                ${result.year ? `<span style="display: flex; align-items: center; gap: 0.3rem;"><i class="fa-solid fa-calendar" style="font-size: 0.8rem;"></i>${result.year}</span>` : ''}
                                ${result.seeders !== undefined ? `<span style="display: flex; align-items: center; gap: 0.3rem; color: var(--success);"><i class="fa-solid fa-arrow-up" style="font-size: 0.8rem;"></i>${result.seeders}</span>` : ''}
                                ${result.leechers !== undefined ? `<span style="display: flex; align-items: center; gap: 0.3rem; color: var(--warning);"><i class="fa-solid fa-arrow-down" style="font-size: 0.8rem;"></i>${result.leechers}</span>` : ''}
                            </div>
                        </div>
                        <button class="btn primary download-manual-btn" data-url="${escapeHtml(result.download_url)}" data-title="${escapeHtml(movieTitle)}" style="white-space: nowrap; flex-shrink: 0;">
                            <i class="fa-solid fa-download"></i> Download
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    container.querySelectorAll('.download-manual-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const url = btn.dataset.url;
            const title = btn.dataset.title;

            // Disable button to prevent double clicks
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Adding...';

            showToast(`Adding torrent for ${title}...`, 'info');
            const res = await addTorrent(url, title);

            if (res.success) {
                showToast('Torrent added successfully!', 'success');

                // Update button state to success
                btn.innerHTML = '<i class="fa-solid fa-check"></i> Added';
                btn.classList.remove('primary');
                btn.classList.add('success');

                // Delete the old movie entry from Dashboard DB to avoid duplicates
                if (originalHash) {
                    console.log(`Deleting old movie entry ${originalHash} to prevent duplicates...`);
                    await batchDeleteMovies([originalHash], {
                        deleteFromDB: true,
                        deleteFromDestination: false,
                        ignoreMovie: false
                    });
                }

                // Close modal after a short delay
                setTimeout(() => {
                    document.getElementById('manual-search-modal').classList.remove('active');

                    // Redirect to new movie details if hash is available, otherwise dashboard
                    if (res.hash) {
                        showMovieDetails(res.hash);
                    } else {
                        switchView('dashboard');
                        fetchMovies(); // Refresh dashboard list
                    }
                }, 1500);
            } else {
                showToast(res.message || 'Error adding torrent', 'error');
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-download"></i> Download';
            }
        });
    });
}

// ========== TRAILER MODAL ===========

async function showTrailerModal(hash) {
    const modal = document.getElementById('trailer-modal');
    const trailerContainer = document.getElementById('trailer-container');
    const modalTitle = document.getElementById('trailer-modal-title');

    if (!modal || !trailerContainer) {
        showToast('Error loading trailer modal', 'error');
        return;
    }

    // Show loading state
    modalTitle.textContent = 'Cargando tráiler...';
    trailerContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';
    modal.classList.add('active');

    try {
        // Fetch trailer data from API
        const response = await fetch(`/api/movie/${hash}/trailer`);
        const data = await response.json();

        if (!data.success) {
            trailerContainer.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--text-muted);">${escapeHtml(data.message || 'No hay tráiler disponible')}</div>`;
            modalTitle.textContent = 'Tráiler no disponible';
            return;
        }

        // Update modal title
        modalTitle.textContent = data.name || 'Tráiler';

        // Create YouTube iframe embed
        const youtubeKey = data.youtube_key;
        const embedUrl = `https://www.youtube.com/embed/${youtubeKey}?autoplay=1&rel=0`;

        trailerContainer.innerHTML = `
            <iframe 
                src="${embedUrl}" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowfullscreen
            ></iframe>
        `;

    } catch (error) {
        console.error('Error loading trailer:', error);
        trailerContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--danger);">Error loading trailer</div>';
        modalTitle.textContent = 'Error';
    }
}

function closeTrailerModal() {
    const modal = document.getElementById('trailer-modal');
    const trailerContainer = document.getElementById('trailer-container');

    if (modal) {
        modal.classList.remove('active');
    }

    // Stop video by clearing iframe
    if (trailerContainer) {
        trailerContainer.innerHTML = '';
    }
}

// Make functions globally accessible so they can be called from event listeners
window.showTrailerModal = showTrailerModal;
window.closeTrailerModal = closeTrailerModal;

// Setup trailer modal event listeners
document.addEventListener('DOMContentLoaded', () => {
    const trailerModal = document.getElementById('trailer-modal');
    const trailerCloseBtn = document.getElementById('trailer-modal-close-btn');

    if (trailerCloseBtn) {
        trailerCloseBtn.addEventListener('click', closeTrailerModal);
    }

    // Close on backdrop click
    if (trailerModal) {
        trailerModal.addEventListener('click', (e) => {
            if (e.target === trailerModal) {
                closeTrailerModal();
            }
        });
    }

    // Close on ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && trailerModal && trailerModal.classList.contains('active')) {
            closeTrailerModal();
        }
    });
});

// ========== MULTI-SELECT ===========

function setupMultiSelect() {
    if (selectAllBtn) selectAllBtn.addEventListener('click', selectAllMovies);
    if (deselectAllBtn) deselectAllBtn.addEventListener('click', deselectAllMovies);
    if (copySelectedBtn) copySelectedBtn.addEventListener('click', copySelectedMovies);
    if (deleteSelectedBtn) deleteSelectedBtn.addEventListener('click', () => {
        if (deleteModal) deleteModal.classList.add('active');
    });

    if (deleteModal) {
        const modalCancelBtn = document.getElementById('modal-cancel-btn');
        const modalConfirmBtn = document.getElementById('modal-confirm-btn');

        if (modalCancelBtn) {
            modalCancelBtn.addEventListener('click', () => deleteModal.classList.remove('active'));
        }

        if (modalConfirmBtn) {
            const newBtn = modalConfirmBtn.cloneNode(true);
            modalConfirmBtn.parentNode.replaceChild(newBtn, modalConfirmBtn);
            newBtn.addEventListener('click', confirmDeleteSelectedMovies);
        }

        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) deleteModal.classList.remove('active');
        });

        // Watchlist and Ignore mutual exclusion
        const watchlistCheckbox = document.getElementById('watchlist-movie');
        const ignoreCheckbox = document.getElementById('ignore-movie');
        const watchlistDaysContainer = document.getElementById('watchlist-days-container');

        if (watchlistCheckbox && ignoreCheckbox && watchlistDaysContainer) {
            watchlistCheckbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    ignoreCheckbox.checked = false;
                    watchlistDaysContainer.style.display = 'block';
                } else {
                    watchlistDaysContainer.style.display = 'none';
                }
            });

            ignoreCheckbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    watchlistCheckbox.checked = false;
                    watchlistDaysContainer.style.display = 'none';
                }
            });
        }
    }
}

export function toggleMovieSelection(hash, movieData, event) {
    event.stopPropagation();
    state.toggleMovieSelection(hash, movieData);
    updateSelectionUI();
}

function selectAllMovies() {
    const movieCards = document.querySelectorAll('.movie-card');
    movieCards.forEach(card => {
        const hash = card.dataset.hash;
        const movieData = JSON.parse(card.dataset.movie);
        state.selectMovie(hash, movieData);
    });
    updateSelectionUI();
}

function deselectAllMovies() {
    state.clearSelection();
    updateSelectionUI();
}

function updateSelectionUI() {
    const selectedMovies = state.getSelectedMovies();
    const count = selectedMovies.size;

    if (count > 0) {
        selectionCounter.textContent = `(${count})`;
        selectionCounter.classList.add('active');
    } else {
        selectionCounter.textContent = '';
        selectionCounter.classList.remove('active');
    }

    const hasSelection = count > 0;
    selectAllBtn.style.display = hasSelection ? 'none' : 'inline-flex';
    deselectAllBtn.style.display = hasSelection ? 'inline-flex' : 'none';
    deleteSelectedBtn.style.display = hasSelection ? 'inline-flex' : 'none';

    const hasNonErrorMovies = Array.from(selectedMovies.values()).some(
        m => m.status !== 'error' && m.status !== 'orphaned'
    );
    copySelectedBtn.style.display = (hasSelection && hasNonErrorMovies) ? 'inline-flex' : 'none';

    // Update card visuals
    document.querySelectorAll('.movie-card').forEach(card => {
        const hash = card.dataset.hash;
        const checkbox = card.querySelector('.movie-card-checkbox');

        if (selectedMovies.has(hash)) {
            card.classList.add('selected');
            if (checkbox) checkbox.checked = true;
        } else {
            card.classList.remove('selected');
            if (checkbox) checkbox.checked = false;
        }
    });
}

async function copySelectedMovies() {
    const selectedMovies = state.getSelectedMovies();
    const hashes = Array.from(selectedMovies.keys());

    const validHashes = hashes.filter(hash => {
        const movie = selectedMovies.get(hash);
        return movie.status !== 'error' && movie.status !== 'orphaned';
    });

    if (validHashes.length === 0) {
        showToast('No valid movies to copy', 'warning');
        return;
    }

    const data = await batchCopyMovies(validHashes);

    if (data.success) {
        showToast(`${data.copied} movies queued for copy`, 'success');
        deselectAllMovies();
        await fetchMovies();
    } else {
        showToast(data.message || 'Error copying movies', 'error');
    }
}

async function confirmDeleteSelectedMovies() {
    const deleteFromDB = document.getElementById('delete-from-db').checked;
    const deleteFromDestination = document.getElementById('delete-from-destination').checked;
    const ignoreMovie = document.getElementById('ignore-movie').checked;
    const watchlistMovie = document.getElementById('watchlist-movie')?.checked || false;
    const watchlistDays = parseInt(document.getElementById('watchlist-days')?.value) || 7;

    // Validation
    if (watchlistMovie) {
        // Watchlist mode - only needs watchlist checked
        if (!deleteFromDB) {
            showToast('Watchlist requires removing from dashboard', 'warning');
            return;
        }
    } else {
        // Normal delete mode
        if (!deleteFromDB && !deleteFromDestination) {
            showToast('Please select at least one option', 'warning');
            return;
        }
    }

    const selectedMovies = state.getSelectedMovies();
    const hashes = Array.from(selectedMovies.keys());
    const isInDetailView = getCurrentView() === 'movie-details';

    const data = await batchDeleteMovies(hashes, {
        deleteFromDB,
        deleteFromDestination,
        ignoreMovie,
        watchlistMovie,
        watchlistDays
    });

    if (data.success) {
        let message = '';
        if (data.added_to_watchlist) {
            message = `${data.added_to_watchlist} movie(s) added to watchlist for ${watchlistDays} days`;
        } else {
            if (deleteFromDB) message += `${data.deleted_from_db} removed from DB. `;
            if (deleteFromDestination) message += `${data.deleted_from_folder} files deleted.`;
        }

        showToast(message.trim(), 'success');
        deleteModal.classList.remove('active');
        deselectAllMovies();

        if (isInDetailView) {
            switchView('dashboard');
        }

        await fetchMovies();
    } else {
        showToast(data.message || 'Error processing request', 'error');
    }
}

// Exponer funciones globales necesarias para compatibilidad
window.toggleMovieSelection = toggleMovieSelection;
