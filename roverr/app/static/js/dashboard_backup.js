const API_BASE = '/api';

// State
let currentView = 'dashboard';
let torrents = [];
let settings = {};
let currentEditIndex = -1;
let refreshInterval = null;
let currentSort = { field: 'completion_on', direction: 'desc' };

// DOM Elements
const views = {
    dashboard: document.getElementById('view-dashboard'),
    search: document.getElementById('view-search'),
    settings: document.getElementById('view-settings'),
    'movie-details': document.getElementById('view-movie-details')
};
const navItems = document.querySelectorAll('.nav-item');
const torrentsList = document.getElementById('torrents-list');
const trackersList = document.getElementById('trackers-list');

// Init
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupDashboard();
    setupSettings();
    setupSearch();
    setupMultiSelect(); // Initialize multi-select

    // Initial Load
    fetchTorrents();
    fetchSettings();
    fetchMovies();

    // Auto Refresh
    refreshInterval = setInterval(() => {
        fetchTorrents();
        fetchMovies(true);
    }, 2000);

    // RSS Countdown - Update every second
    updateRSSCountdown();
    setInterval(updateRSSCountdown, 1000);
});

function setupNavigation() {
    navItems.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.view;
            switchView(target);
        });
    });
}

function switchView(viewName) {
    currentView = viewName;

    // Update Nav
    navItems.forEach(btn => {
        if (btn.dataset.view === viewName) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    // Update Views
    Object.keys(views).forEach(key => {
        if (key === viewName) views[key].classList.add('active');
        else views[key].classList.remove('active');
    });
}

// --- Dashboard Logic ---

function setupDashboard() {
    document.getElementById('refresh-btn').addEventListener('click', () => {
        fetchTorrents();
        fetchMovies();
    });
    document.getElementById('trigger-btn').addEventListener('click', triggerCheck);
    document.getElementById('fetch-rss-btn').addEventListener('click', fetchRSSMovies);

    // Sorting Event Listeners
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (currentSort.field === field) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.field = field;
                currentSort.direction = 'desc'; // Default to desc for new columns
            }
            renderTorrents();
        });
    });
}

async function fetchTorrents() {
    try {
        const res = await fetch(`${API_BASE}/torrents`);
        torrents = await res.json();
        renderTorrents();
    } catch (e) {
        console.error("Error fetching torrents:", e);
    }
}

async function triggerCheck() {
    try {
        await fetch(`${API_BASE}/trigger`, { method: 'POST' });
        showToast('Auto-check triggered', 'success');
        fetchTorrents();
    } catch (e) {
        showToast('Error triggering check', 'error');
    }
}

async function fetchRSSMovies() {
    const btn = document.getElementById('fetch-rss-btn');
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Fetching...';

    try {
        const res = await fetch(`${API_BASE}/rss/fetch`, { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            showToast(data.message, 'success');
            fetchTorrents();
            fetchMovies();
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {
        showToast('Error fetching RSS movies', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

function sortTorrents(data) {
    return [...data].sort((a, b) => {
        let valA = a[currentSort.field];
        let valB = b[currentSort.field];

        // Handle nulls/undefined
        if (valA == null) valA = 0;
        if (valB == null) valB = 0;

        // String comparison
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });
}

function updateSortHeaders() {
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        // Remove existing arrows
        const text = th.textContent.replace(/[▲▼]/g, '').trim();
        th.textContent = text;

        if (th.dataset.sort === currentSort.field) {
            th.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            th.textContent = `${text} ${currentSort.direction === 'asc' ? '▲' : '▼'}`;
        }
    });
}

function renderTorrents() {
    torrentsList.innerHTML = '';

    if (torrents.length === 0) {
        torrentsList.innerHTML = '<tr><td colspan="9" style="text-align:center; padding: 2rem;">No active torrents found.</td></tr>';
        return;
    }

    const sortedTorrents = sortTorrents(torrents);
    updateSortHeaders();

    sortedTorrents.forEach(t => {
        const tr = document.createElement('tr');
        tr.dataset.hash = t.hash;

        // Progress Bar
        const progress = (t.progress * 100).toFixed(1);

        // Dates
        const addedDate = new Date(t.added_on * 1000).toLocaleString();
        const completedDate = t.completion_on > 0 ? new Date(t.completion_on * 1000).toLocaleString() : '-';

        // Status Logic
        const isMoved = t.status === 'moved' || t.status === 'moved_manually';
        const isCopying = t.status === 'copying';

        // Status Badge
        let statusBadge = `<span class="status-badge status-${t.status === 'moved' || t.status === 'moved_manually' ? 'moved' : t.status === 'error' ? 'error' : t.status === 'skipped' ? 'skipped' : 'pending'}">${t.status}</span>`;
        if (isCopying) {
            statusBadge = `<span class="status-badge status-pending"><i class="fa-solid fa-spinner fa-spin"></i> Copying</span>`;
        }

        // Copy Progress Bar (Below Status)
        let copyProgressHtml = '';
        if (isCopying && t.copy_progress) {
            copyProgressHtml = `
                <div style="margin-top: 8px;">
                    <div class="progress-bar" style="width: 100%; height: 6px; background-color: #334155; border-radius: 3px; overflow: hidden;">
                        <div class="progress-fill" style="width: ${t.copy_progress.percent}%; background-color: #3b82f6; height: 100%;"></div>
                    </div>
                    <div style="font-size: 0.75rem; color: #94a3b8; display: flex; justify-content: space-between; margin-top: 4px;">
                        <span>${t.copy_progress.percent}%</span>
                        <span>${t.copy_progress.speed} MB/s</span>
                    </div>
                </div>
            `;
        }

        // Actions
        let actionBtn = '';
        if (isCopying) {
            actionBtn = `<button class="btn danger sm" onclick="stopCopy('${t.hash}')">Stop</button>`;
        } else {
            actionBtn = `<button class="btn secondary sm" onclick="manualMove('${t.hash}')" ${isMoved ? 'disabled' : ''}>Move Now</button>`;
        }

        tr.innerHTML = `
            <td>
                <input type="checkbox" class="torrent-checkbox" onchange="toggleMovieSelection('${t.hash}', {torrent_hash: '${t.hash}', title: '${escapeHtml(t.name)}', status: '${t.status}'}, event)">
            </td>
            <td>
                <div style="font-weight: 500;">${t.name}</div>
                <div style="font-size: 0.8rem; color: #94a3b8;">${t.state}</div>
            </td>
            <td>${(t.size / 1024 / 1024 / 1024).toFixed(2)} GB</td>
            <td>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progress}%"></div>
                </div>
                <div style="font-size: 0.75rem; margin-top: 2px;">${progress}%</div>
            </td>
            <td>${t.ratio.toFixed(2)}</td>
            <td style="font-size: 0.85rem;">${addedDate}</td>
            <td style="font-size: 0.85rem;">${completedDate}</td>
            <td>
                ${statusBadge}
                ${copyProgressHtml}
            </td>
            <td>
                <input type="checkbox" ${isMoved || isCopying ? 'checked disabled' : ''} 
                       onchange="markAsMoved('${t.hash}', this)">
            </td>
            <td>
                ${actionBtn}
            </td>
        `;
        torrentsList.appendChild(tr);
    });
}

async function manualMove(hash) {
    // Disable button if possible (though we might be in list view)
    // Disable button if possible (though we might be in list view)
    // showToast('Requesting move...', 'info'); // Removed to prevent overlap

    try {
        const res = await fetch(`${API_BASE}/move/${hash}`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'started') {
            showToast('Move started', 'success');

            // If in details view for this movie, reload it immediately
            const detailsContainer = document.getElementById('movie-details-content');
            if (document.getElementById('view-movie-details').style.display !== 'none' &&
                detailsContainer && detailsContainer.getAttribute('data-hash') === hash) {

                // Small delay to allow backend to set initial state
                setTimeout(() => showMovieDetails(hash), 500);
            }

            fetchTorrents();
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {
        showToast('Error starting move', 'error');
    }
}

async function stopCopy(hash) {
    if (!confirm("Are you sure you want to stop the copy? This will delete the partial file.")) return;

    try {
        const res = await fetch(`${API_BASE}/stop/${hash}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Stopping copy...', 'info');
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {
        showToast('Error stopping copy', 'error');
    }
}

async function markAsMoved(hash, checkbox) {
    if (!checkbox.checked) return; // Only handle checking

    if (!confirm("Mark this torrent as moved manually?")) {
        checkbox.checked = false;
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/mark/${hash}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Marked as moved', 'success');
            fetchTorrents();
        } else {
            showToast(data.message, 'error');
            checkbox.checked = false;
        }
    } catch (e) {
        showToast('Error marking as moved', 'error');
        checkbox.checked = false;
    }
}

// --- Search Logic ---

function setupSearch() {
    const searchBtn = document.getElementById('search-btn');
    const searchInput = document.getElementById('search-input');

    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            const query = searchInput.value.trim();
            if (query) {
                searchMovies(query);
            }
        });
    }

    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                if (query) {
                    searchMovies(query);
                }
            }
        });
    }
}

async function searchMovies(query) {
    const resultsContainer = document.getElementById('search-results');
    resultsContainer.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Searching TMDB...</div>';

    try {
        const res = await fetch(`${API_BASE}/search_tmdb?q=${encodeURIComponent(query)}`);
        const data = await res.json();

        if (data.success && data.results) {
            renderTMDBResults(data.results);
        } else {
            resultsContainer.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--error);">${data.message || 'Search failed'}</div>`;
        }
    } catch (e) {
        console.error('Search error:', e);
        resultsContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--error);">Error performing search</div>';
    }
}

function renderTMDBResults(results) {
    const resultsContainer = document.getElementById('search-results');

    if (!results || results.length === 0) {
        resultsContainer.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 4rem 2rem; color: var(--text-muted);"><i class="fa-solid fa-film" style="font-size: 3rem; opacity: 0.3; margin-bottom: 1rem;"></i><p style="font-size: 1.1rem;">No results found</p></div>';
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

    resultsContainer.innerHTML = resultsHTML;
}

async function searchIndexersForMovie(title, originalTitle, year, tmdbId) {
    const resultsContainer = document.getElementById('search-results');

    // Show loading state
    resultsContainer.innerHTML = `
        <div style="grid-column: 1 / -1; max-width: 1200px; margin: 0 auto; width: 100%; text-align: center; padding: 4rem 2rem;">
            <i class="fa-solid fa-spinner fa-spin" style="font-size: 2rem; color: var(--primary); margin-bottom: 1rem;"></i>
            <p style="font-size: 1.1rem; color: var(--text);">Searching indexers for "${title}"...</p>
        </div>
    `;

    try {
        // Build query with both Spanish and English titles
        const queries = [];
        if (title) queries.push(year ? `${title} ${year}` : title);
        if (originalTitle && originalTitle !== title) {
            queries.push(year ? `${originalTitle} ${year}` : originalTitle);
        }

        const query = queries.join(' | ');
        const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();

        if (data.success && data.results) {
            renderIndexerResults(data.results, title, year);
        } else {
            resultsContainer.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--error);">${data.message || 'No torrents found'}</div>`;
        }
    } catch (e) {
        console.error('Indexer search error:', e);
        resultsContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--error);">Error searching indexers</div>';
    }
}

function renderIndexerResults(results, movieTitle, movieYear) {
    const resultsContainer = document.getElementById('search-results');

    if (!results || results.length === 0) {
        resultsContainer.innerHTML = `
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
                            <button class="btn primary" onclick="downloadTorrent('${escapeHtml(result.download_url)}', '${escapeHtml(result.title)}', this)" style="white-space: nowrap; flex-shrink: 0;">
                                <i class="fa-solid fa-download"></i> Download
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    resultsContainer.innerHTML = resultsHTML;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function downloadTorrent(url, title, btnElement) {
    // Show loading state on button
    let originalContent = '';
    if (btnElement) {
        originalContent = btnElement.innerHTML;
        btnElement.disabled = true;
        btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Adding...';
    }

    try {
        const res = await fetch(`${API_BASE}/add_torrent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, title })
        });

        const data = await res.json();

        if (data.success) {
            // Show success toast immediately
            showToast(data.message || 'Torrent added to qBittorrent', 'success');

            if (btnElement) {
                btnElement.innerHTML = '<i class="fa-solid fa-check"></i> Added';
                btnElement.classList.remove('primary');
                btnElement.classList.add('success');
            }

            // Navigate to movie details if we have a hash
            if (data.hash) {
                // Show redirect overlay
                showRedirectOverlay();

                setTimeout(() => {
                    showMovieDetails(data.hash);
                    setTimeout(removeRedirectOverlay, 500);
                }, 2500);
            } else {
                // If no hash yet, navigate to dashboard
                setTimeout(() => {
                    switchView('dashboard');
                }, 1000);
            }
        } else {
            showToast(data.message || 'Failed to add torrent', 'error');
            if (btnElement) {
                btnElement.disabled = false;
                btnElement.innerHTML = originalContent;
            }
        }
    } catch (e) {
        console.error('Error adding torrent:', e);
        showToast('Error adding torrent to qBittorrent', 'error');
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.innerHTML = originalContent;
        }
    }
}

function showRedirectOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'redirect-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        backdrop-filter: blur(5px);
        opacity: 0;
        transition: opacity 0.3s ease;
    `;

    overlay.innerHTML = `
        <div style="text-align: center; color: white;">
            <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 3rem; color: var(--primary); margin-bottom: 1.5rem;"></i>
            <h2 style="font-size: 1.8rem; margin-bottom: 0.5rem;">Torrent Added Successfully</h2>
            <p style="font-size: 1.2rem; color: #ccc;">Redirecting to movie details...</p>
        </div>
    `;

    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
    });
}

function removeRedirectOverlay() {
    const overlay = document.getElementById('redirect-overlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 300);
    }
}

// --- Settings Logic ---

function setupSettings() {
    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);

    const resetIgnoredBtn = document.getElementById('reset-ignored-btn');
    if (resetIgnoredBtn) {
        resetIgnoredBtn.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to restore ALL ignored movies? They will reappear in your dashboard.')) return;

            try {
                const res = await fetch(`${API_BASE}/reset-ignored`, { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    showToast(data.message, 'success');
                    fetchMovies(); // Refresh dashboard
                } else {
                    showToast(data.message, 'error');
                }
            } catch (e) {
                console.error(e);
                showToast('Error resetting ignored list', 'error');
            }
        });
    }

    document.getElementById('add-tracker-btn').addEventListener('click', addTracker);
    document.getElementById('add-indexer-btn').addEventListener('click', addIndexer);
    document.getElementById('test-indexer-btn').addEventListener('click', testIndexer);
    document.getElementById('add-rss-btn').addEventListener('click', addRSSFeed);
    document.getElementById('test-rss-btn').addEventListener('click', testRSSFeed);

    // Edit Indexer Modal Listeners
    document.getElementById('edit-indexer-cancel-btn').addEventListener('click', closeEditIndexerModal);
    document.getElementById('edit-indexer-save-btn').addEventListener('click', saveEditedIndexer);
    document.getElementById('edit-indexer-test-btn').addEventListener('click', testEditedIndexer);

    // Edit RSS Modal Listeners
    document.getElementById('edit-rss-cancel-btn').addEventListener('click', closeEditRSSModal);
    document.getElementById('edit-rss-save-btn').addEventListener('click', saveEditedRSS);
    document.getElementById('edit-rss-test-btn').addEventListener('click', testEditedRSS);
}

async function fetchSettings() {
    try {
        const res = await fetch(`${API_BASE}/settings`);
        settings = await res.json();
        renderSettings();
    } catch (e) {
        console.error("Error fetching settings:", e);
    }
}

function renderSettings() {
    // qBittorrent
    document.getElementById('setting-qb-host').value = settings.qb_host || 'localhost';
    document.getElementById('setting-qb-port').value = settings.qb_port || 8080;
    document.getElementById('setting-qb-user').value = settings.qb_user || 'admin';
    document.getElementById('setting-qb-pass').value = settings.qb_pass || '';

    // Paths
    document.getElementById('setting-local-source').value = settings.local_source_path || '';
    document.getElementById('setting-local-dest').value = settings.local_dest_path || '';

    // General
    document.getElementById('setting-speed-limit').value = settings.copy_speed_limit || 10;
    document.getElementById('setting-poll-interval').value = settings.poll_interval || 5;
    document.getElementById('setting-enable-scheduler').checked = settings.enable_scheduler || false;
    document.getElementById('setting-tmdb-key').value = settings.tmdb_api_key || '';

    // Trackers
    renderTrackersList();

    // Indexers
    renderIndexersList();

    // RSS Feeds
    renderRSSFeedsList();
}

function renderTrackersList() {
    trackersList.innerHTML = '';
    (settings.allowed_trackers || []).forEach((tracker, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${tracker}</span>
            <button class="btn danger sm" onclick="removeTracker(${index})"><i class="fa-solid fa-trash"></i></button>
        `;
        trackersList.appendChild(li);
    });
}

function addTracker() {
    const input = document.getElementById('new-tracker-input');
    const url = input.value.trim();
    if (!url) return;

    if (!settings.allowed_trackers) settings.allowed_trackers = [];
    settings.allowed_trackers.push(url);
    input.value = '';
    renderTrackersList();
}

// Expose to global scope for onclick
window.removeTracker = function (index) {
    settings.allowed_trackers.splice(index, 1);
    renderTrackersList();
};

function renderIndexersList() {
    const list = document.getElementById('indexers-list');
    list.innerHTML = '';
    const indexers = settings.indexers || [];

    if (indexers.length === 0) {
        list.innerHTML = '<li style="color: var(--text-muted); font-style: italic; justify-content: center;">No indexers configured</li>';
        return;
    }

    indexers.forEach((indexer, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 0.25rem; overflow: hidden;">
                <span style="font-weight: 600;">${indexer.name}</span>
                <span style="font-size: 0.8rem; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden;">${indexer.url}</span>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn secondary sm" onclick="openEditIndexerModal(${index})"><i class="fa-solid fa-pencil"></i></button>
                <button class="btn danger sm" onclick="removeIndexer(${index})"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        list.appendChild(li);
    });
}

async function testIndexer() {
    const url = document.getElementById('indexer-url').value.trim();
    const key = document.getElementById('indexer-key').value.trim();

    if (!url || !key) {
        showToast('Please enter URL and API Key to test', 'error');
        return;
    }

    const btn = document.getElementById('test-indexer-btn');
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing...';

    try {
        const res = await fetch(`${API_BASE}/test_indexer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, api_key: key })
        });
        const data = await res.json();

        if (data.success) {
            showToast(data.message, 'success');
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {
        showToast('Error testing connection', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

function addIndexer() {
    const nameInput = document.getElementById('indexer-name');
    const urlInput = document.getElementById('indexer-url');
    const keyInput = document.getElementById('indexer-key');
    const catsInput = document.getElementById('indexer-cats');

    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    const key = keyInput.value.trim();
    const cats = catsInput.value.trim() || '2000,2010,2020,2030,2040,2045,2050,2060';

    if (!name || !url || !key) {
        showToast('Please fill in Name, URL, and API Key', 'error');
        return;
    }

    if (!settings.indexers) settings.indexers = [];
    settings.indexers.push({ name, url, api_key: key, categories: cats });

    nameInput.value = '';
    urlInput.value = '';
    keyInput.value = '';
    catsInput.value = '';

    renderIndexersList();
}

window.removeIndexer = function (index) {
    if (!confirm('Are you sure you want to remove this indexer?')) return;
    settings.indexers.splice(index, 1);
    renderIndexersList();
};

// --- RSS Feeds Management ---

async function testRSSFeed() {
    const url = document.getElementById('rss-url').value.trim();

    if (!url) {
        showToast('Please enter RSS URL to test', 'error');
        return;
    }

    const btn = document.getElementById('test-rss-btn');
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing...';

    try {
        const res = await fetch(`${API_BASE}/test_rss_feed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();

        if (data.success) {
            const info = data.feed_info || {};
            showToast(`RSS feed valid: ${info.entries_count || 0} entries found`, 'success');
        } else {
            showToast(data.message || 'Failed to validate RSS feed', 'error');
        }
    } catch (e) {
        showToast('Error testing RSS feed', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

function addRSSFeed() {
    const nameInput = document.getElementById('rss-name');
    const enabledInput = document.getElementById('rss-enabled');
    const autoAddInput = document.getElementById('rss-auto-add');
    const labelInput = document.getElementById('rss-label');
    const intervalInput = document.getElementById('rss-refresh-interval');
    const urlInput = document.getElementById('rss-url');

    const name = nameInput.value.trim();
    const enabled = enabledInput.checked;
    const autoAdd = autoAddInput.checked;
    const label = labelInput.value.trim();
    const refreshInterval = parseInt(intervalInput.value) || 300;
    const url = urlInput.value.trim();

    if (!name || !url) {
        showToast('Please fill in Name and RSS URL', 'error');
        return;
    }

    if (refreshInterval < 60) {
        showToast('Refresh interval must be at least 60 seconds', 'error');
        return;
    }

    if (!settings.rss_feeds) settings.rss_feeds = [];
    settings.rss_feeds.push({
        name,
        enabled,
        auto_add: autoAdd,
        label,
        refresh_interval: refreshInterval,
        url
    });

    nameInput.value = '';
    enabledInput.checked = true;
    autoAddInput.checked = false;
    labelInput.value = '';
    intervalInput.value = '300';
    urlInput.value = '';

    renderRSSFeedsList();
    showToast('RSS feed added successfully', 'success');
}

function renderRSSFeedsList() {
    const list = document.getElementById('rss-feeds-list');
    list.innerHTML = '';
    const feeds = settings.rss_feeds || [];

    if (feeds.length === 0) {
        list.innerHTML = '<li style="color: var(--text-muted); font-style: italic; justify-content: center;">No RSS feeds configured</li>';
        return;
    }

    feeds.forEach((feed, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 0.25rem; overflow: hidden;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-weight: 600;">${feed.name}</span>
                    ${feed.enabled ? '<span style="color: var(--success); font-size: 0.75rem;">● Enabled</span>' : '<span style="color: var(--text-muted); font-size: 0.75rem;">○ Disabled</span>'}
                </div>
                <span style="font-size: 0.8rem; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden;">${feed.url}</span>
                <span style="font-size: 0.75rem; color: var(--text-muted);">Refresh: ${feed.refresh_interval}s ${feed.label ? `• Label: ${feed.label}` : ''}</span>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn secondary sm" onclick="openEditRSSModal(${index})"><i class="fa-solid fa-pencil"></i></button>
                <button class="btn danger sm" onclick="removeRSSFeed(${index})"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        list.appendChild(li);
    });
}

window.removeRSSFeed = function (index) {
    if (!confirm('Are you sure you want to remove this RSS feed?')) return;
    settings.rss_feeds.splice(index, 1);
    renderRSSFeedsList();
};

async function saveSettings() {
    // Gather values
    const newSettings = {
        ...settings,
        qb_host: document.getElementById('setting-qb-host').value,
        qb_port: parseInt(document.getElementById('setting-qb-port').value),
        qb_user: document.getElementById('setting-qb-user').value,
        qb_pass: document.getElementById('setting-qb-pass').value,
        local_source_path: document.getElementById('setting-local-source').value,
        local_dest_path: document.getElementById('setting-local-dest').value,
        copy_speed_limit: parseInt(document.getElementById('setting-speed-limit').value),
        poll_interval: parseInt(document.getElementById('setting-poll-interval').value),
        enable_scheduler: document.getElementById('setting-enable-scheduler').checked,
        tmdb_api_key: document.getElementById('setting-tmdb-key').value,
        allowed_trackers: settings.allowed_trackers || [],
        indexers: settings.indexers || [],
        rss_feeds: settings.rss_feeds || []
    };

    try {
        const res = await fetch(`${API_BASE}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newSettings)
        });
        const data = await res.json();
        if (data.success) {
            showToast('Settings saved successfully', 'success');
            settings = newSettings; // Update local state
        } else {
            showToast('Error saving settings', 'error');
        }
    } catch (e) {
        showToast('Error saving settings', 'error');
    }
}

// --- Utils ---

function showToast(message, type = 'info') {
    // Simple toast implementation
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    // Add styles dynamically if not present
    if (!document.getElementById('toast-style')) {
        const style = document.createElement('style');
        style.id = 'toast-style';
        style.textContent = `
            .toast {
                position: fixed;
                bottom: 20px;
                right: 20px;
                padding: 10px 20px;
                border-radius: 6px;
                color: white;
                font-weight: 500;
                z-index: 1000;
                animation: slideIn 0.3s ease-out;
            }
            .toast-success { background-color: #10b981; }
            .toast-error { background-color: #ef4444; }
            .toast-info { background-color: #3b82f6; }
            @keyframes slideIn {
                from { transform: translateY(100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// RSS Countdown Timer
async function updateRSSCountdown() {
    const countdownEl = document.getElementById('rss-countdown');
    if (!countdownEl) return; // Element not in DOM yet

    try {
        const res = await fetch(`${API_BASE}/rss/status`);
        const data = await res.json();

        if (data.has_feeds && data.countdown_seconds >= 0) {
            // Format countdown as mm:ss
            const minutes = Math.floor(data.countdown_seconds / 60);
            const seconds = data.countdown_seconds % 60;
            const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

            countdownEl.innerHTML = `<i class="fa-solid fa-clock"></i> Next RSS: <strong>${data.next_feed_name}</strong> in ${timeStr}`;
            countdownEl.style.display = 'block';
        } else {
            countdownEl.style.display = 'none';
        }
    } catch (e) {
        console.error('Error fetching RSS status:', e);
        countdownEl.style.display = 'none';
    }
}

async function fetchMovies(isPolling = false) {
    const grid = document.getElementById('movies-grid');
    if (!grid) return; // Safety check

    if (!isPolling && grid.children.length === 0) {
        grid.innerHTML = '<div style="text-align: center; grid-column: 1/-1;">Loading movies...</div>';
    }

    try {
        const res = await fetch(`${API_BASE}/movies`);
        const data = await res.json();

        // Handle new response format
        const movies = Array.isArray(data) ? data : (data.movies || []);
        const ignored = data.ignored_series || [];

        // Update Series Notification
        const notificationArea = document.getElementById('series-notification');
        if (notificationArea) {
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

        if (movies.length === 0) {
            grid.innerHTML = '<div style="text-align: center; grid-column: 1/-1;">No movies found.</div>';
            return;
        }

        // Check if grid has non-card children (like "Loading..." or "No movies")
        if (grid.querySelector(':not(.movie-card)')) {
            grid.innerHTML = '';
        }

        // Map existing cards
        const existingCards = new Map();
        grid.querySelectorAll('.movie-card').forEach(card => {
            existingCards.set(card.dataset.hash, card);
        });

        movies.forEach(movie => {
            let card = existingCards.get(movie.torrent_hash);
            const progressClass = getProgressClass(movie.state);
            const isCopying = movie.status === 'copying';

            // Status Badge Logic
            const statusClass = movie.status === 'moved_manually' ? 'moved' : movie.status;
            let statusIcon = '<i class="fa-solid fa-circle-question"></i>';
            let statusLabel = movie.status;

            if (movie.status === 'moved' || movie.status === 'moved_manually') {
                statusIcon = '<i class="fa-solid fa-check"></i>';
                statusLabel = 'Moved';
            } else if (movie.status === 'copying') {
                statusIcon = '<i class="fa-solid fa-spinner fa-spin"></i>';
                statusLabel = 'Copying';
            } else if (movie.status === 'pending') {
                statusIcon = '<i class="fa-regular fa-clock"></i>';
                statusLabel = 'Pending';
            } else if (movie.status === 'missing') {
                statusIcon = '<i class="fa-solid fa-circle-exclamation"></i>';
                statusLabel = 'Missing';
            } else if (movie.status === 'new') {
                statusIcon = '<i class="fa-solid fa-sparkles"></i>';
                statusLabel = 'New';
            } else if (movie.status === 'orphaned') {
                statusIcon = '<i class="fa-solid fa-link-slash"></i>';
                statusLabel = 'Orphaned';
            } else if (movie.status === 'downloading') {
                statusIcon = '<i class="fa-solid fa-download"></i>';
                statusLabel = 'Downloading';
            } else if (movie.status === 'error') {
                statusIcon = '<i class="fa-solid fa-triangle-exclamation"></i>';
                statusLabel = 'Error';
            } else if (movie.status === 'skipped') {
                statusIcon = '<i class="fa-solid fa-forward"></i>';
                statusLabel = 'Skipped';
            }

            const posterSrc = movie.poster_url ? movie.poster_url : 'https://via.placeholder.com/300x450?text=No+Cover';

            if (card) {
                // Update existing card
                existingCards.delete(movie.torrent_hash);

                // Update data attribute
                card.dataset.movie = JSON.stringify({
                    torrent_hash: movie.torrent_hash,
                    title: movie.title,
                    status: movie.status
                });

                const img = card.querySelector('img');
                // Use getAttribute to compare raw values (relative vs absolute issue)
                if (img.getAttribute('src') !== posterSrc) img.src = posterSrc;

                const overlay = card.querySelector('.overlay-status');
                overlay.className = `overlay-status ${statusClass}`;
                overlay.innerHTML = `${statusIcon} ${statusLabel}`;

                const title = card.querySelector('.movie-title');
                if (title.textContent !== movie.title) title.textContent = movie.title;

                const meta = card.querySelector('.movie-meta');
                meta.innerHTML = `<span>${movie.year || 'N/A'}</span>${movie.size > 0 ? `<span>${formatBytes(movie.size)}</span>` : ''}`;

                const fill = card.querySelector('.progress-bar .fill');
                fill.className = `fill ${progressClass}`;
                fill.style.width = `${movie.progress * 100}%`;

            } else {
                // Create new card
                card = document.createElement('div');
                card.className = 'movie-card';
                card.dataset.hash = movie.torrent_hash;
                card.dataset.movie = JSON.stringify({
                    torrent_hash: movie.torrent_hash,
                    title: movie.title,
                    status: movie.status
                });

                card.innerHTML = `
                    <input type="checkbox" class="movie-card-checkbox">
                    <div class="poster-wrapper">
                        <img src="${posterSrc}" alt="${movie.title}" loading="lazy">
                        <div class="overlay-status ${statusClass}">
                            ${statusIcon} ${statusLabel}
                        </div>
                    </div>
                    <div class="movie-info">
                        <div class="movie-title" title="${movie.title}">${movie.title}</div>
                        <div class="movie-meta">
                            <span>${movie.year || 'N/A'}</span>
                            ${movie.size > 0 ? `<span>${formatBytes(movie.size)}</span>` : ''}
                        </div>
                        <div class="progress-bar">
                            <div class="fill ${progressClass}" style="width: ${movie.progress * 100}%"></div>
                        </div>
                    </div>
                `;

                // Add listeners
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

                grid.appendChild(card);
            }
        });

        // Remove stale cards
        existingCards.forEach(card => card.remove());

        // Update selection UI (highlight selected cards)
        updateSelectionUI();

    } catch (e) {
        console.error("Error fetching movies:", e);
        if (!isPolling) {
            grid.innerHTML = '<div style="text-align: center; grid-column: 1/-1; color: var(--danger);">Error loading movies.</div>';
        }
    }
}

async function showMovieDetails(hash) {
    switchView('movie-details');
    const container = document.getElementById('movie-details-content');
    container.setAttribute('data-hash', hash);
    container.innerHTML = '<div style="text-align: center; padding: 2rem;">Loading details...</div>';

    try {
        const res = await fetch(`${API_BASE}/movie/${hash}`);
        const movie = await res.json();

        if (movie.error) {
            container.innerHTML = `<div class="error-message">${movie.error}</div>`;
            return;
        }

        // Format runtime
        // Format runtime
        const runtime = movie.runtime ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : 'N/A';

        // Render cast carousel
        // Render cast carousel
        const castHTML = movie.cast && movie.cast.length > 0 ? movie.cast.map(person => `
            <div class="cast-card">
                <img src="${person.profile_path || 'https://via.placeholder.com/185x278?text=No+Photo'}" alt="${person.name}">
                <div class="cast-name">${person.name}</div>
                <div class="cast-character">como ${person.character}</div>
            </div>
        `).join('') : '<p>No cast information available.</p>';

        // Render crew carousel
        // Render crew carousel
        const crewHTML = movie.crew && movie.crew.length > 0 ? movie.crew.map(person => `
            <div class="cast-card">
                <img src="${person.profile_path || 'https://via.placeholder.com/185x278?text=No+Photo'}" alt="${person.name}">
                <div class="cast-name">${person.name}</div>
                <div class="cast-character">como ${person.job}</div>
            </div>
        `).join('') : '<p>No crew information available.</p>';

        // Status Badge Logic (Unified)
        let statusIcon = '<i class="fa-solid fa-circle-question"></i>';
        let statusLabel = movie.status;
        let statusClass = movie.status === 'moved_manually' ? 'moved' : movie.status;

        if (movie.status === 'moved' || movie.status === 'moved_manually') {
            statusIcon = '<i class="fa-solid fa-check"></i>';
            statusLabel = 'Moved';
        } else if (movie.status === 'copying') {
            statusIcon = '<i class="fa-solid fa-spinner fa-spin"></i>';
            statusLabel = 'Copying';
        } else if (movie.status === 'pending') {
            statusIcon = '<i class="fa-regular fa-clock"></i>';
            statusLabel = 'Pending';
        } else if (movie.status === 'error') {
            statusIcon = '<i class="fa-solid fa-triangle-exclamation"></i>';
            statusLabel = 'Error';
        } else if (movie.status === 'skipped') {
            statusIcon = '<i class="fa-solid fa-forward"></i>';
            statusLabel = 'Skipped';
        } else if (movie.status === 'missing') {
            statusIcon = '<i class="fa-solid fa-circle-exclamation"></i>';
            statusLabel = 'Missing';
        } else if (movie.status === 'orphaned') {
            statusIcon = '<i class="fa-solid fa-link-slash"></i>';
            statusLabel = 'Orphaned';
        } else if (movie.status === 'new') {
            statusIcon = '<i class="fa-solid fa-sparkles"></i>';
            statusLabel = 'New';
        } else if (movie.status === 'downloading') {
            statusIcon = '<i class="fa-solid fa-download"></i>';
            statusLabel = 'Downloading';
        }

        container.innerHTML = `
            <!-- Backdrop Image -->
            ${movie.backdrop_url ? `
            <div class="movie-backdrop" style="background-image: url('${movie.backdrop_url}');"></div>
            ` : ''}
            
            <!-- Sticky Header -->
            <div class="movie-sticky-header">
                <div class="header-top">
                    <h2>Movie Details</h2>
                    <button class="btn secondary" onclick="switchView('dashboard')"><i class="fa-solid fa-arrow-left"></i> Back</button>
                </div>
                <div class="movie-action-bar">
                    ${movie.status !== 'moved' && movie.status !== 'copying' ?
                `<button class="btn primary" onclick="manualMove('${movie.torrent_hash}')"><i class="fa-solid fa-play"></i> Move Now</button>` :
                ''}
                    ${movie.status === 'copying' ?
                `<button class="btn danger" onclick="stopCopy('${movie.torrent_hash}')"><i class="fa-solid fa-stop"></i> Stop Copy</button>` : ''}
                    ${movie.status === 'missing' ?
                `<button class="btn warning" onclick="manualMove('${hash}')"><i class="fa-solid fa-rotate-right"></i> Retry Move</button>` : ''}
                    <button class="btn secondary" onclick="identifyMovie('${hash}')"><i class="fa-solid fa-magnifying-glass"></i> Identify Manually</button>
                    <button class="btn danger" onclick="deleteMovie('${hash}')"><i class="fa-solid fa-trash"></i> Remove from Dashboard</button>
                </div>
            </div>
            
            <div class="movie-details-layout">
                <div class="movie-poster-large">
                    <img src="${movie.poster_url || 'https://via.placeholder.com/500x750?text=No+Cover'}" alt="${movie.title}">
                </div>
                <div class="movie-info-panel">
                    <h1>${movie.title} <span class="year">(${movie.year || 'N/A'})</span></h1>
                    
                    <div class="meta-row">
                        <span class="badge runtime"><i class="fa-regular fa-clock"></i> ${runtime}</span>
                        <span class="badge status ${statusClass}">
                            ${statusIcon} ${statusLabel}
                        </span>
                        <span class="badge size"><i class="fa-solid fa-hard-drive"></i> ${formatBytes(movie.size)}</span>
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
                    </div>
                    ` : ''}

                    ${movie.status === 'downloading' && movie.download_stats ? `
                    <div class="details-progress-container">
                        <div class="progress-info">
                            <span>Downloading... ${movie.download_stats.progress.toFixed(1)}%</span>
                            <span>${movie.download_stats.speed} MB/s</span>
                        </div>
                        <div class="progress-bar large">
                            <div class="details-progress-fill downloading" style="width: ${movie.download_stats.progress}%"></div>
                        </div>
                    </div>
                    ` : ''}
                    
                    <!-- Ratings Section -->
                    <div class="ratings-section">
                        <h3>Ratings</h3>
                        <div class="ratings-grid">
                            <div class="rating-badge tmdb">
                                <div class="rating-source">TMDB</div>
                                <div class="rating-value">${movie.vote_average ? movie.vote_average.toFixed(1) : 'N/A'}</div>
                                <div class="rating-count">${movie.vote_count ? `${movie.vote_count} votes` : ''}</div>
                            </div>
                            ${movie.imdb_id ? `
                            <div class="rating-badge imdb">
                                <div class="rating-source">IMDb</div>
                                <div class="rating-value">${movie.imdb_rating || 'N/A'}</div>
                                <div class="rating-count">${movie.imdb_votes ? `${movie.imdb_votes} votes` : ''}</div>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                    
                    <div class="paths-box">
                        <div class="path-item">
                            <label>Current Location:</label>
                            <code>${movie.source_path}</code>
                        </div>
                        <div class="path-item">
                            <label>Destination:</label>
                            <code>${movie.dest_path}</code>
                        </div>
                    </div>
                    
                    <div class="synopsis">
                        <h3>Synopsis</h3>
                        <p>${movie.overview || 'No synopsis available.'}</p>
                    </div>
                    
                    <!-- Cast Section -->
                    <div class="cast-section">
                        <h3>Reparto</h3>
                        <div class="cast-carousel">
                            ${castHTML}
                        </div>
                    </div>
                    
                    <!-- Crew Section -->
                    <div class="crew-section">
                        <h3>Equipo</h3>
                        <div class="cast-carousel">
                            ${crewHTML}
                        </div>
                    </div>
                </div>
            </div>
                `;

        if (movie.status === 'copying' || movie.status === 'downloading') {
            startDetailsPolling(hash);
        }

    } catch (error) {
        console.error("Error fetching details:", error);
        container.innerHTML = `< div class="error-message" > Error loading details.</div > `;
    }
}

let detailsPollInterval = null;

function startDetailsPolling(hash) {
    if (detailsPollInterval) clearInterval(detailsPollInterval);

    detailsPollInterval = setInterval(async () => {
        // Check if we are still on the details page for this hash
        const container = document.getElementById('movie-details-content');
        if (document.getElementById('view-movie-details').style.display === 'none' ||
            !container || container.getAttribute('data-hash') !== hash) {
            stopDetailsPolling();
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/movie/${hash}`);
            const movie = await res.json();

            if (movie.status !== 'copying' && movie.status !== 'downloading') {
                // If finished copying/downloading, reload full view to show final state and stop polling
                stopDetailsPolling();
                showMovieDetails(hash);
                return;
            }

            if (movie.status === 'copying' && movie.copy_progress) {
                updateProgressUI(movie.copy_progress, 'copying');
            } else if (movie.status === 'downloading' && movie.download_stats) {
                updateProgressUI(movie.download_stats, 'downloading');
            }
        } catch (e) {
            console.error("Polling error:", e);
        }
    }, 1000); // Poll every 1 second
}

function stopDetailsPolling() {
    if (detailsPollInterval) {
        clearInterval(detailsPollInterval);
        detailsPollInterval = null;
    }
}

function updateProgressUI(progress, type) {
    const container = document.querySelector('.details-progress-container');
    if (!container) return; // Should exist if status is copying/downloading

    const percentEl = container.querySelector('.progress-info span:first-child');
    const speedEl = container.querySelector('.progress-info span:last-child');
    const barEl = container.querySelector('.progress-bar .details-progress-fill');

    const label = type === 'copying' ? 'Copying...' : 'Downloading...';
    const percent = type === 'copying' ? progress.percent : progress.progress.toFixed(1);

    if (percentEl) percentEl.textContent = `${label} ${percent}%`;
    if (speedEl) speedEl.textContent = `${progress.speed} MB/s`;
    if (barEl) {
        barEl.style.width = `${percent}%`;
        barEl.className = `details-progress-fill ${type}`; // Ensure correct color
    }
}

async function identifyMovie(hash) {
    const tmdbId = prompt("Enter the TMDB ID for this movie (e.g., 550 for Fight Club):");
    if (!tmdbId) return;

    try {
        showToast('Identifying movie...', 'info');
        const res = await fetch(`${API_BASE} /movie/${hash}/identify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tmdb_id: tmdbId })
        });
        const data = await res.json();

        if (data.success) {
            showToast('Movie identified successfully!', 'success');
            showMovieDetails(hash); // Reload details
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {
        showToast('Error identifying movie', 'error');
    }
}

async function deleteMovie(hash) {
    // Reuse the batch delete modal for single movie deletion
    // 1. Clear current selection
    deselectAllMovies();

    // 2. Select this movie
    const card = document.querySelector(`.movie-card[data-hash="${hash}"]`);
    let movieData = { torrent_hash: hash, status: 'unknown' };
    if (card && card.dataset.movie) {
        movieData = JSON.parse(card.dataset.movie);
    }

    selectedMovies.set(hash, movieData);
    updateSelectionUI();

    // 3. Open Modal
    const deleteModal = document.getElementById('delete-modal');
    if (deleteModal) {
        deleteModal.classList.add('active');
    } else {
        console.error("Delete modal not found");
        showToast("Error: Delete modal not found", "error");
    }
}

async function stopCopy(hash) {
    if (!confirm("Are you sure you want to stop the copy process?")) return;

    try {
        const res = await fetch(`${API_BASE}/stop/${hash}`, { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            showToast('Copy process stopped', 'success');
            showMovieDetails(hash); // Reload details
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {
        showToast('Error stopping copy', 'error');
    }
}

// Helpers
function getProgressClass(state) {
    if (state === 'downloading') return 'downloading';
    if (state === 'pausedDL' || state === 'pausedUP') return 'paused';
    if (state === 'uploading' || state === 'stalledUP') return 'seeding';
    if (state === 'error') return 'error';
    return 'completed';
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// ========== MULTI-SELECT MOVIES FUNCTIONALITY ==========

// Selection state
let selectedMovies = new Map(); // hash -> movie data

// Setup multi-select event listeners
function setupMultiSelect() {
    const selectAllBtn = document.getElementById('select-all-btn');
    const deselectAllBtn = document.getElementById('deselect-all-btn');
    const copySelectedBtn = document.getElementById('copy-selected-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    const deleteModal = document.getElementById('delete-modal');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');

    console.log("Setting up multi-select listeners");
    if (selectAllBtn) selectAllBtn.addEventListener('click', selectAllMovies);
    if (deselectAllBtn) deselectAllBtn.addEventListener('click', deselectAllMovies);
    if (copySelectedBtn) copySelectedBtn.addEventListener('click', copySelectedMovies);
    if (deleteSelectedBtn) deleteSelectedBtn.addEventListener('click', () => {
        // Re-query modal to be safe
        const currentDeleteModal = document.getElementById('delete-modal');
        if (currentDeleteModal) {
            currentDeleteModal.classList.add('active');
        } else {
            console.error("Delete modal not found in DOM");
        }
    });

    if (modalCancelBtn) modalCancelBtn.addEventListener('click', () => {
        deleteModal.classList.remove('active');
    });

    if (modalConfirmBtn) {
        // Remove any existing listeners by cloning the button
        const newModalConfirmBtn = modalConfirmBtn.cloneNode(true);
        modalConfirmBtn.parentNode.replaceChild(newModalConfirmBtn, modalConfirmBtn);

        newModalConfirmBtn.addEventListener('click', () => {
            confirmDeleteSelectedMovies();
        });
    } else {
        console.error("Modal confirm button not found!");
    }

    // Close modal on backdrop click
    if (deleteModal) {
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) {
                deleteModal.classList.remove('active');
            }
        });
    }
}

// Global function for checkbox in header
window.toggleSelectAll = function (checkbox) {
    if (checkbox.checked) {
        selectAllMovies();
    } else {
        deselectAllMovies();
    }
};

function toggleMovieSelection(hash, movieData, event) {
    event.stopPropagation(); // Prevent opening modal details

    if (selectedMovies.has(hash)) {
        selectedMovies.delete(hash);
    } else {
        selectedMovies.set(hash, movieData);
    }

    updateSelectionUI();
}

function selectAllMovies() {
    const movieCards = document.querySelectorAll('.movie-card');
    movieCards.forEach(card => {
        const hash = card.dataset.hash;
        const movieData = JSON.parse(card.dataset.movie);
        selectedMovies.set(hash, movieData);
    });
    updateSelectionUI();
}

function deselectAllMovies() {
    selectedMovies.clear();
    updateSelectionUI();
}

function updateSelectionUI() {
    const counter = document.getElementById('selection-counter');
    const selectAllBtn = document.getElementById('select-all-btn');
    const deselectAllBtn = document.getElementById('deselect-all-btn');
    const copySelectedBtn = document.getElementById('copy-selected-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');

    const count = selectedMovies.size;

    // Update counter
    if (count > 0) {
        counter.textContent = `(${count})`;
        counter.classList.add('active');
    } else {
        counter.textContent = '';
        counter.classList.remove('active');
    }

    // Show/hide action buttons
    const hasSelection = count > 0;
    selectAllBtn.style.display = hasSelection ? 'none' : 'inline-flex';
    deselectAllBtn.style.display = hasSelection ? 'inline-flex' : 'none';
    deleteSelectedBtn.style.display = hasSelection ? 'inline-flex' : 'none';

    // Copy button: only show if selection includes non-error movies
    // Error states: 'error', 'orphaned'
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

    // Update table rows
    document.querySelectorAll('#torrents-list tr').forEach(tr => {
        const hash = tr.dataset.hash;
        const checkbox = tr.querySelector('.torrent-checkbox');
        if (!checkbox) return;

        if (selectedMovies.has(hash)) {
            checkbox.checked = true;
        } else {
            checkbox.checked = false;
        }
    });

    // Update header checkbox
    const headerCheckbox = document.getElementById('select-all-checkbox');
    if (headerCheckbox) {
        // Check if all visible items are selected
        // This is a bit complex because we have two views. 
        // For now, just uncheck if selection is empty, check if > 0 (simplified)
        // Or better: check if count matches total items? 
        // Let's keep it simple: uncheck if empty.
        if (count === 0) headerCheckbox.checked = false;
    }
}

async function copySelectedMovies() {
    const hashes = Array.from(selectedMovies.keys());

    // Filter out error states
    const validHashes = hashes.filter(hash => {
        const movie = selectedMovies.get(hash);
        return movie.status !== 'error' && movie.status !== 'orphaned';
    });

    if (validHashes.length === 0) {
        showToast('No valid movies to copy', 'warning');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/movies/batch-copy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ torrent_hashes: validHashes })
        });

        const data = await res.json();

        if (data.success) {
            showToast(`${data.copied} movies queued for copy`, 'success');
            deselectAllMovies();
            fetchMovies();
            fetchTorrents();
        } else {
            showToast(data.message || 'Error copying movies', 'error');
        }
    } catch (e) {
        console.error('Error copying movies:', e);
        showToast('Error copying movies', 'error');
    }
}

async function confirmDeleteSelectedMovies() {
    const deleteFromDB = document.getElementById('delete-from-db').checked;
    const deleteFromDestination = document.getElementById('delete-from-destination').checked;
    const ignoreMovie = document.getElementById('ignore-movie').checked;

    if (!deleteFromDB && !deleteFromDestination) {
        showToast('Please select at least one option', 'warning');
        return;
    }

    const hashes = Array.from(selectedMovies.keys());
    const isInDetailView = currentView === 'movie-details';

    try {
        const res = await fetch(`${API_BASE}/movies/batch-delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                torrent_hashes: hashes,
                delete_from_db: deleteFromDB,
                delete_from_destination: deleteFromDestination,
                ignore_movie: ignoreMovie
            })
        });

        const data = await res.json();

        if (data.success) {
            let message = '';
            if (deleteFromDB) message += `${data.deleted_from_db} removed from DB. `;
            if (deleteFromDestination) message += `${data.deleted_from_folder} files deleted.`;

            showToast(message.trim(), 'success');
            document.getElementById('delete-modal').classList.remove('active');
            deselectAllMovies();

            // If we're in detail view, redirect to dashboard
            if (isInDetailView) {
                switchView('dashboard');

            }

            // Force refresh movies and torrents
            console.log("Refreshing movies and torrents");
            await fetchMovies();
            await fetchTorrents();
        } else {
            showToast(data.message || 'Error deleting movies', 'error');
        }
    } catch (e) {
        console.error('Error deleting movies:', e);
        showToast('Error deleting movies', 'error');
    }
}

// --- Edit Indexer Modal Logic ---

function openEditIndexerModal(index) {
    const indexer = settings.indexers[index];
    if (!indexer) return;

    currentEditIndex = index;
    document.getElementById('edit-indexer-name').value = indexer.name || '';
    document.getElementById('edit-indexer-url').value = indexer.url || '';
    document.getElementById('edit-indexer-key').value = indexer.api_key || '';
    document.getElementById('edit-indexer-cats').value = indexer.categories || '2000,2010,2020,2030,2040,2045,2050,2060';

    document.getElementById('edit-indexer-modal').classList.add('active');
}

function closeEditIndexerModal() {
    document.getElementById('edit-indexer-modal').classList.remove('active');
    currentEditIndex = -1;
}

async function saveEditedIndexer() {
    if (currentEditIndex === -1) return;

    const name = document.getElementById('edit-indexer-name').value.trim();
    const url = document.getElementById('edit-indexer-url').value.trim();
    const key = document.getElementById('edit-indexer-key').value.trim();
    const cats = document.getElementById('edit-indexer-cats').value.trim();

    if (!name || !url || !key) {
        showToast('Please fill in Name, URL, and API Key', 'error');
        return;
    }

    settings.indexers[currentEditIndex] = {
        name,
        url,
        api_key: key,
        categories: cats
    };

    renderIndexersList();
    closeEditIndexerModal();
    showToast('Indexer updated', 'success');
}

async function testEditedIndexer() {
    const url = document.getElementById('edit-indexer-url').value.trim();
    const key = document.getElementById('edit-indexer-key').value.trim();

    if (!url || !key) {
        showToast('Please enter URL and API Key to test', 'error');
        return;
    }

    const btn = document.getElementById('edit-indexer-test-btn');
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing...';

    try {
        const res = await fetch(`${API_BASE}/test_indexer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, api_key: key })
        });
        const data = await res.json();

        if (data.success) {
            showToast(data.message, 'success');
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {
        showToast('Error testing connection', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

// --- Edit RSS Feed Modal Logic ---

function openEditRSSModal(index) {
    const feed = settings.rss_feeds[index];
    if (!feed) return;

    currentEditIndex = index;
    document.getElementById('edit-rss-name').value = feed.name || '';
    document.getElementById('edit-rss-enabled').checked = feed.enabled !== false;
    document.getElementById('edit-rss-auto-add').checked = feed.auto_add || false;
    document.getElementById('edit-rss-label').value = feed.label || '';
    document.getElementById('edit-rss-interval').value = feed.refresh_interval || 300;
    document.getElementById('edit-rss-url').value = feed.url || '';

    document.getElementById('edit-rss-modal').classList.add('active');
}

function closeEditRSSModal() {
    document.getElementById('edit-rss-modal').classList.remove('active');
    currentEditIndex = -1;
}

async function saveEditedRSS() {
    if (currentEditIndex === -1) return;

    const name = document.getElementById('edit-rss-name').value.trim();
    const enabled = document.getElementById('edit-rss-enabled').checked;
    const autoAdd = document.getElementById('edit-rss-auto-add').checked;
    const label = document.getElementById('edit-rss-label').value.trim();
    const refreshInterval = parseInt(document.getElementById('edit-rss-interval').value) || 300;
    const url = document.getElementById('edit-rss-url').value.trim();

    if (!name || !url) {
        showToast('Please fill in Name and RSS URL', 'error');
        return;
    }

    if (refreshInterval < 60) {
        showToast('Refresh interval must be at least 60 seconds', 'error');
        return;
    }

    settings.rss_feeds[currentEditIndex] = {
        name,
        enabled,
        auto_add: autoAdd,
        label,
        refresh_interval: refreshInterval,
        url
    };

    renderRSSFeedsList();
    closeEditRSSModal();
    showToast('RSS feed updated', 'success');
}

async function testEditedRSS() {
    const url = document.getElementById('edit-rss-url').value.trim();

    if (!url) {
        showToast('Please enter RSS URL to test', 'error');
        return;
    }

    const btn = document.getElementById('edit-rss-test-btn');
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing...';

    try {
        const res = await fetch(`${API_BASE}/test_rss_feed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();

        if (data.success) {
            const info = data.feed_info || {};
            showToast(`RSS feed valid: ${info.entries_count || 0} entries found`, 'success');
        } else {
            showToast(data.message || 'Failed to validate RSS feed', 'error');
        }
    } catch (e) {
        showToast('Error testing RSS feed', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

// Initialize on DOM load

