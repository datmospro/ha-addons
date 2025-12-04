/**
 * MÃ³dulo Settings para Roverr
 * Gestiona toda la configuraciÃ³n de la aplicaciÃ³n
 * ExtraÃ­do de app.js - lÃ­neas 631-986, 1840-2009
 */

import { state } from './state.js';
import { getSettings, saveSettings as apiSaveSettings, testIndexer, testRSSFeed, testTelegram } from './api.js';
import { showToast, setButtonLoading, openModal, closeModal, escapeHtml } from './ui.js';
import { DEFAULT_INDEXER_CATEGORIES, MIN_RSS_REFRESH_INTERVAL } from './config.js';

// Referencias DOM
let indexersList;
let rssFeedsList;

/**
 * Inicializa el mÃ³dulo de settings
 */
export function initSettings() {
    indexersList = document.getElementById('indexers-list');
    rssFeedsList = document.getElementById('rss-feeds-list');

    // Setup event listeners
    document.getElementById('save-settings-btn')?.addEventListener('click', handleSaveSettings);
    document.getElementById('add-indexer-btn')?.addEventListener('click', addIndexer);
    document.getElementById('test-indexer-btn')?.addEventListener('click', handleTestIndexer);
    document.getElementById('add-rss-btn')?.addEventListener('click', addRSSFeed);
    document.getElementById('test-rss-btn')?.addEventListener('click', handleTestRSS);
    document.getElementById('test-telegram-btn')?.addEventListener('click', handleTestTelegram);
    document.getElementById('reset-ignored-btn')?.addEventListener('click', handleResetIgnored);
    document.getElementById('view-ignored-btn')?.addEventListener('click', openIgnoredMoviesModal);

    // Setup ignored movies modal listeners
    document.getElementById('ignored-movies-close-btn')?.addEventListener('click', () => closeModal('ignored-movies-modal'));
    const ignoredModalBackdrop = document.getElementById('ignored-movies-modal');
    if (ignoredModalBackdrop) {
        ignoredModalBackdrop.addEventListener('click', (e) => {
            if (e.target === ignoredModalBackdrop) {
                closeModal('ignored-movies-modal');
            }
        });
    }

    // Setup watchlist movies modal listeners
    document.getElementById('view-watchlist-btn')?.addEventListener('click', openWatchlistMoviesModal);
    document.getElementById('watchlist-movies-close-btn')?.addEventListener('click', () => closeModal('watchlist-movies-modal'));
    const watchlistModalBackdrop = document.getElementById('watchlist-movies-modal');
    if (watchlistModalBackdrop) {
        watchlistModalBackdrop.addEventListener('click', (e) => {
            if (e.target === watchlistModalBackdrop) {
                closeModal('watchlist-movies-modal');
            }
        });
    }

    // RSS Auto-download toggles
    const rssAutoAdd = document.getElementById('rss-auto-add');
    if (rssAutoAdd) {
        rssAutoAdd.addEventListener('change', () => toggleAutoDownloadSettings('rss-auto-add', 'rss-auto-download-settings'));
    }

    const editRssAutoAdd = document.getElementById('edit-rss-auto-add');
    if (editRssAutoAdd) {
        editRssAutoAdd.addEventListener('change', () => toggleAutoDownloadSettings('edit-rss-auto-add', 'edit-rss-auto-download-settings'));
    }

    // Settings tabs navigation
    setupSettingsTabs();

    // Modales de ediciÃ³n
    setupEditModals();
}

/**
 * Setup settings tabs navigation
 */
function setupSettingsTabs() {
    const tabs = document.querySelectorAll('.settings-tab');
    const panels = document.querySelectorAll('.settings-panel');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;

            // Remove active class from all tabs and panels
            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));

            // Add active class to clicked tab and corresponding panel
            tab.classList.add('active');
            document.getElementById(`tab-${targetTab}`)?.classList.add('active');
        });
    });
}

function toggleAutoDownloadSettings(checkboxId, settingsId) {
    const checkbox = document.getElementById(checkboxId);
    const settingsDiv = document.getElementById(settingsId);
    if (checkbox && settingsDiv) {
        settingsDiv.style.display = checkbox.checked ? 'block' : 'none';
    }
}

/**
 * Carga los settings del servidor
 */
export async function loadSettings() {
    const settings = await getSettings();
    state.setSettings(settings);
    renderSettings();
}

/**
 * Renderiza todos los settings en el UI
 * LÃ­neas 682-707 de app.js
 */
function renderSettings() {
    const settings = state.getSettings();

    // Torrent Client
    document.getElementById('setting-qb-host').value = settings.qb_host || 'localhost';
    document.getElementById('setting-qb-port').value = settings.qb_port || 8080;
    document.getElementById('setting-qb-user').value = settings.qb_user || 'admin';
    document.getElementById('setting-qb-pass').value = settings.qb_pass || '';

    // Paths
    document.getElementById('setting-local-source').value = settings.local_source_path || '';
    document.getElementById('setting-local-dest').value = settings.local_dest_path || '';

    // Advanced
    document.getElementById('setting-auto-copy-manual').checked = settings.auto_copy_manual_search || false;
    document.getElementById('setting-speed-limit').value = settings.copy_speed_limit || 10;
    document.getElementById('setting-tmdb-key').value = settings.tmdb_api_key || '';
    document.getElementById('setting-language').value = settings.language || 'es-ES';

    // Telegram
    document.getElementById('setting-telegram-token').value = settings.telegram_bot_token || '';
    document.getElementById('setting-telegram-chat-id').value = settings.telegram_chat_id || '';
    document.getElementById('setting-notify-new').checked = settings.telegram_notify_on_new_movie !== false; // Default true
    document.getElementById('setting-notify-download').checked = settings.telegram_notify_on_download_complete !== false; // Default true
    document.getElementById('setting-notify-move').checked = settings.telegram_notify_on_move !== false; // Default true

    // Render lists
    renderIndexersList();
    renderRSSFeedsList();
}



/**
 * Renderiza la lista de indexers
 * LÃ­neas 738-762 de app.js
 */
function renderIndexersList() {
    const settings = state.getSettings();
    indexersList.innerHTML = '';
    const indexers = settings.indexers || [];

    if (indexers.length === 0) {
        indexersList.innerHTML = '<li style="color: var(--text-muted); font-style: italic; justify-content: center;">No indexers configured</li>';
        return;
    }

    indexers.forEach((indexer, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 0.25rem; overflow: hidden;">
                <span style="font-weight: 600;">${indexer.name}</span>
                <span style="font-size: 0.8rem; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden;">${indexer.url}</span>
                <div class="indexer-stats-container" data-indexer-id="${index}">
                    <span style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">Loading stats...</span>
                </div>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn secondary sm edit-indexer-btn" data-index="${index}"><i class="fa-solid fa-pencil"></i></button>
                <button class="btn danger sm remove-indexer-btn" data-index="${index}"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        indexersList.appendChild(li);

        // Cargar estadísticas en paralelo
        loadIndexerStats(index);
    });

    // Attach event listeners
    indexersList.querySelectorAll('.edit-indexer-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditIndexerModal(parseInt(btn.dataset.index)));
    });
    indexersList.querySelectorAll('.remove-indexer-btn').forEach(btn => {
        btn.addEventListener('click', () => removeIndexer(parseInt(btn.dataset.index)));
    });
}

/**
 * Prueba un indexer
 * LÃ­neas 764-797 de app.js
 */
async function handleTestIndexer() {
    const url = document.getElementById('indexer-url').value.trim();
    const key = document.getElementById('indexer-key').value.trim();

    if (!url || !key) {
        showToast('Please enter URL and API Key to test', 'error');
        return;
    }

    const btn = document.getElementById('test-indexer-btn');
    setButtonLoading(btn, true, 'Testing...');

    const data = await testIndexer(url, key);

    if (data.success) {
        showToast(data.message, 'success');
    } else {
        showToast(data.message, 'error');
    }

    setButtonLoading(btn, false);
}

/**
 * AÃ±ade un indexer
 * LÃ­neas 799-824 de app.js
 */
function addIndexer() {
    const nameInput = document.getElementById('indexer-name');
    const urlInput = document.getElementById('indexer-url');
    const keyInput = document.getElementById('indexer-key');
    const catsInput = document.getElementById('indexer-cats');

    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    const key = keyInput.value.trim();
    const cats = catsInput.value.trim() || DEFAULT_INDEXER_CATEGORIES;

    if (!name || !url || !key) {
        showToast('Please fill in Name, URL, and API Key', 'error');
        return;
    }

    const settings = state.getSettings();
    if (!settings.indexers) settings.indexers = [];
    settings.indexers.push({ name, url, api_key: key, categories: cats });

    nameInput.value = '';
    urlInput.value = '';
    keyInput.value = '';
    catsInput.value = '';

    state.setSettings(settings);
    renderIndexersList();
}

/**
 * Elimina un indexer
 * LÃ­neas 826-830 de app.js
 */
function removeIndexer(index) {
    if (!confirm('Are you sure you want to remove this indexer?')) return;

    const settings = state.getSettings();
    settings.indexers.splice(index, 1);
    state.setSettings(settings);
    renderIndexersList();
}

/**
 * Renderiza la lista de RSS feeds
 * LÃ­neas 915-943 de app.js
 */
function renderRSSFeedsList() {
    const settings = state.getSettings();
    rssFeedsList.innerHTML = '';
    const feeds = settings.rss_feeds || [];

    if (feeds.length === 0) {
        rssFeedsList.innerHTML = '<li style="color: var(--text-muted); font-style: italic; justify-content: center;">No RSS feeds configured</li>';
        return;
    }

    feeds.forEach((feed, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 0.25rem; overflow: hidden;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-weight: 600;">${feed.name}</span>
                    ${feed.enabled ? '<span style="color: var(--success); font-size: 0.75rem;">â— Enabled</span>' : '<span style="color: var(--text-muted); font-size: 0.75rem;">â—‹ Disabled</span>'}
                </div>
                <span style="font-size: 0.8rem; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden;">${feed.url}</span>
                <span style="font-size: 0.75rem; color: var(--text-muted);">Refresh: ${feed.refresh_interval}s ${feed.label ? `â€¢ Label: ${feed.label}` : ''}</span>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn secondary sm edit-rss-btn" data-index="${index}"><i class="fa-solid fa-pencil"></i></button>
                <button class="btn danger sm remove-rss-btn" data-index="${index}"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        rssFeedsList.appendChild(li);
    });

    // Attach event listeners
    rssFeedsList.querySelectorAll('.edit-rss-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditRSSModal(parseInt(btn.dataset.index)));
    });
    rssFeedsList.querySelectorAll('.remove-rss-btn').forEach(btn => {
        btn.addEventListener('click', () => removeRSSFeed(parseInt(btn.dataset.index)));
    });
}

/**
 * Prueba RSS feed
 * LÃ­neas 834-867 de app.js
 */
async function handleTestRSS() {
    const url = document.getElementById('rss-url').value.trim();

    if (!url) {
        showToast('Please enter RSS URL to test', 'error');
        return;
    }

    const btn = document.getElementById('test-rss-btn');
    setButtonLoading(btn, true, 'Testing...');

    const data = await testRSSFeed(url);

    if (data.success) {
        const info = data.feed_info || {};
        showToast(`RSS feed valid: ${info.entries_count || 0} entries found`, 'success');
    } else {
        showToast(data.message || 'Failed to validate RSS feed', 'error');
    }

    setButtonLoading(btn, false);
}

/**
 * Prueba Telegram
 */
async function handleTestTelegram() {
    const token = document.getElementById('setting-telegram-token').value.trim();
    const chatId = document.getElementById('setting-telegram-chat-id').value.trim();

    if (!token || !chatId) {
        showToast('Please enter Bot Token and Chat ID to test', 'error');
        return;
    }

    const btn = document.getElementById('test-telegram-btn');
    setButtonLoading(btn, true, 'Testing...');

    const data = await testTelegram(token, chatId);

    if (data.success) {
        showToast(data.message, 'success');
    } else {
        showToast(data.message, 'error');
    }

    setButtonLoading(btn, false);
}

/**
 * AÃ±ade un RSS feed
 * LÃ­neas 869-913 de app.js
 */
function addRSSFeed() {
    const nameInput = document.getElementById('rss-name');
    const enabledInput = document.getElementById('rss-enabled');
    const autoAddInput = document.getElementById('rss-auto-add');
    const autoCopyInput = document.getElementById('rss-auto-copy');
    const labelInput = document.getElementById('rss-label');
    const intervalInput = document.getElementById('rss-refresh-interval');
    const urlInput = document.getElementById('rss-url');
    const preferredSizeInput = document.getElementById('rss-preferred-size');
    const maxSizeInput = document.getElementById('rss-max-size');

    const name = nameInput.value.trim();
    const enabled = enabledInput.checked;
    const autoAdd = autoAddInput.checked;
    const autoCopy = autoCopyInput.checked;
    const label = labelInput.value.trim();
    const refreshInterval = parseInt(intervalInput.value) || 300;
    const url = urlInput.value.trim();
    const preferredSize = parseInt(preferredSizeInput.value) || 0;
    const maxSize = parseInt(maxSizeInput.value) || 0;

    if (!name || !url) {
        showToast('Please fill in Name and RSS URL', 'error');
        return;
    }

    if (refreshInterval < MIN_RSS_REFRESH_INTERVAL) {
        showToast(`Refresh interval must be at least ${MIN_RSS_REFRESH_INTERVAL} seconds`, 'error');
        return;
    }

    const settings = state.getSettings();
    if (!settings.rss_feeds) settings.rss_feeds = [];
    settings.rss_feeds.push({
        name,
        enabled,
        auto_add: autoAdd,
        auto_copy: autoCopy,
        label,
        refresh_interval: refreshInterval,
        url,
        preferred_size: preferredSize,
        max_size: maxSize
    });

    nameInput.value = '';
    enabledInput.checked = true;
    autoAddInput.checked = false;
    autoCopyInput.checked = false;
    labelInput.value = '';
    intervalInput.value = '300';
    urlInput.value = '';
    preferredSizeInput.value = '';
    maxSizeInput.value = '';

    // Reset visibility
    toggleAutoDownloadSettings('rss-auto-add', 'rss-auto-download-settings');

    state.setSettings(settings);
    renderRSSFeedsList();
    showToast('RSS feed added successfully', 'success');
}

/**
 * Elimina un RSS feed
 * LÃ­neas 945-949 de app.js
 */
function removeRSSFeed(index) {
    if (!confirm('Are you sure you want to remove this RSS feed?')) return;

    const settings = state.getSettings();
    settings.rss_feeds.splice(index, 1);
    state.setSettings(settings);
    renderRSSFeedsList();
}

/**
 * Guarda todos los settings
 * LÃ­neas 951-986 de app.js
 */
async function handleSaveSettings() {
    const settings = state.getSettings();

    const newSettings = {
        ...settings,
        qb_host: document.getElementById('setting-qb-host').value,
        qb_port: parseInt(document.getElementById('setting-qb-port').value),
        qb_user: document.getElementById('setting-qb-user').value,
        qb_pass: document.getElementById('setting-qb-pass').value,
        local_source_path: document.getElementById('setting-local-source').value,
        local_dest_path: document.getElementById('setting-local-dest').value,
        auto_copy_manual_search: document.getElementById('setting-auto-copy-manual').checked,
        copy_speed_limit: parseInt(document.getElementById('setting-speed-limit').value),
        tmdb_api_key: document.getElementById('setting-tmdb-key').value,
        language: document.getElementById('setting-language').value,
        telegram_bot_token: document.getElementById('setting-telegram-token').value,
        telegram_chat_id: document.getElementById('setting-telegram-chat-id').value,
        telegram_notify_on_new_movie: document.getElementById('setting-notify-new').checked,
        telegram_notify_on_download_complete: document.getElementById('setting-notify-download').checked,
        telegram_notify_on_move: document.getElementById('setting-notify-move').checked,
        indexers: settings.indexers || [],
        rss_feeds: settings.rss_feeds || []
    };

    const result = await apiSaveSettings(newSettings);

    if (result.success) {
        state.setSettings(newSettings);
    }
}

/**
 * Resetea la lista de pelÃ­culas ignoradas
 */
async function handleResetIgnored() {
    if (!confirm('Are you sure you want to restore ALL ignored movies? They will reappear in your dashboard.')) return;

    try {
        const { resetIgnoredMovies } = await import('./api.js');
        const data = await resetIgnoredMovies();

        if (data.success) {
            showToast(data.message, 'success');
            const { fetchMovies } = await import('./movies.js');
            await fetchMovies();
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('Error resetting ignored list', 'error');
    }
}

/**
 * Opens the ignored movies modal and loads the list
 */
async function openIgnoredMoviesModal() {
    const modal = document.getElementById('ignored-movies-modal');
    const loadingEl = document.getElementById('ignored-movies-loading');
    const listEl = document.getElementById('ignored-movies-list');

    // Show modal and loading
    modal.classList.add('active');
    loadingEl.style.display = 'block';
    listEl.innerHTML = '';

    try {
        const { getIgnoredMovies } = await import('./api.js');
        const data = await getIgnoredMovies();

        loadingEl.style.display = 'none';

        if (!data.success) {
            listEl.innerHTML = `<div style="text-align: center; color: var(--danger); padding: 2rem;">${data.message}</div>`;
            return;
        }

        if (data.movies.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No ignored movies</div>`;
            return;
        }

        // Render list
        renderIgnoredMoviesList(data.movies);

        const ignoredSearchInput = document.getElementById('ignored-movies-search');
        if (ignoredSearchInput) {
            ignoredSearchInput.value = ''; // Clear previous search
            ignoredSearchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                const filteredMovies = data.movies.filter(movie =>
                    movie.title.toLowerCase().includes(query) ||
                    (movie.year && movie.year.toString().includes(query))
                );
                renderIgnoredMoviesList(filteredMovies);
            });
        }
    } catch (e) {
        console.error('Error loading ignored movies:', e);
        loadingEl.style.display = 'none';
        listEl.innerHTML = `<div style="text-align: center; color: var(--danger); padding: 2rem;">Error loading ignored movies</div>`;
    }
}

/**
 * Renders the list of ignored movies
 */
function renderIgnoredMoviesList(movies) {
    const listEl = document.getElementById('ignored-movies-list');

    listEl.innerHTML = movies.map(movie => `
        <div class="ignored-movie-item" style="display: flex; align-items: center; gap: 1rem; padding: 0.75rem; border-bottom: 1px solid var(--border); transition: background 0.2s;">
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${movie.title}
                </div>
                ${movie.year ? `<div style="font-size: 0.85rem; color: var(--text-muted);">${movie.year}</div>` : ''}
            </div>
            <button class="btn danger sm" onclick="window.handleUnignoreMovie('${movie.hash}')" 
                    style="flex-shrink: 0;" title="Remove from ignored list">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `).join('');
}

/**
 * Removes a single movie from ignored list
 */
async function handleUnignoreMovie(hash) {
    try {
        const { unignoreMovie } = await import('./api.js');
        const data = await unignoreMovie(hash);

        if (data.success) {
            showToast(data.message, 'success');
            // Reload the list
            openIgnoredMoviesModal();
            // Refresh dashboard
            const { fetchMovies } = await import('./movies.js');
            await fetchMovies();
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {
        console.error('Error unignoring movie:', e);
        showToast('Error removing movie from ignored list', 'error');
    }
}

// ===== MODALES DE EDICIÃ“N =====

let currentEditIndex = -1;

function setupEditModals() {
    // Edit Indexer Modal
    document.getElementById('edit-indexer-cancel-btn')?.addEventListener('click', closeEditIndexerModal);
    document.getElementById('edit-indexer-save-btn')?.addEventListener('click', saveEditedIndexer);
    document.getElementById('edit-indexer-test-btn')?.addEventListener('click', testEditedIndexer);

    // Edit RSS Modal
    document.getElementById('edit-rss-cancel-btn')?.addEventListener('click', closeEditRSSModal);
    document.getElementById('edit-rss-save-btn')?.addEventListener('click', saveEditedRSS);
    document.getElementById('edit-rss-test-btn')?.addEventListener('click', testEditedRSS);
}

// Indexer Edit Modal
function openEditIndexerModal(index) {
    const settings = state.getSettings();
    const indexer = settings.indexers[index];
    if (!indexer) return;

    currentEditIndex = index;
    document.getElementById('edit-indexer-name').value = indexer.name || '';
    document.getElementById('edit-indexer-url').value = indexer.url || '';
    document.getElementById('edit-indexer-key').value = indexer.api_key || '';
    document.getElementById('edit-indexer-cats').value = indexer.categories || DEFAULT_INDEXER_CATEGORIES;

    openModal('edit-indexer-modal');
}

function closeEditIndexerModal() {
    closeModal('edit-indexer-modal');
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

    const settings = state.getSettings();
    settings.indexers[currentEditIndex] = { name, url, api_key: key, categories: cats };

    state.setSettings(settings);
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
    setButtonLoading(btn, true, 'Testing...');

    const data = await testIndexer(url, key);

    if (data.success) {
        showToast(data.message, 'success');
    } else {
        showToast(data.message, 'error');
    }

    setButtonLoading(btn, false);
}

// RSS Edit Modal
function openEditRSSModal(index) {
    const settings = state.getSettings();
    const feed = settings.rss_feeds[index];
    if (!feed) return;

    currentEditIndex = index;
    document.getElementById('edit-rss-name').value = feed.name || '';
    document.getElementById('edit-rss-enabled').checked = feed.enabled !== false;
    document.getElementById('edit-rss-auto-add').checked = feed.auto_add || false;
    document.getElementById('edit-rss-auto-copy').checked = feed.auto_copy || false;
    document.getElementById('edit-rss-label').value = feed.label || '';
    document.getElementById('edit-rss-interval').value = feed.refresh_interval || 300;
    document.getElementById('edit-rss-url').value = feed.url || '';
    document.getElementById('edit-rss-preferred-size').value = feed.preferred_size || '';
    document.getElementById('edit-rss-max-size').value = feed.max_size || '';

    toggleAutoDownloadSettings('edit-rss-auto-add', 'edit-rss-auto-download-settings');

    openModal('edit-rss-modal');
}

function closeEditRSSModal() {
    closeModal('edit-rss-modal');
    currentEditIndex = -1;
}

async function saveEditedRSS() {
    if (currentEditIndex === -1) return;

    const name = document.getElementById('edit-rss-name').value.trim();
    const enabled = document.getElementById('edit-rss-enabled').checked;
    const autoAdd = document.getElementById('edit-rss-auto-add').checked;
    const autoCopy = document.getElementById('edit-rss-auto-copy').checked;
    const label = document.getElementById('edit-rss-label').value.trim();
    const refreshInterval = parseInt(document.getElementById('edit-rss-interval').value) || 300;
    const url = document.getElementById('edit-rss-url').value.trim();
    const preferredSize = parseInt(document.getElementById('edit-rss-preferred-size').value) || 0;
    const maxSize = parseInt(document.getElementById('edit-rss-max-size').value) || 0;

    if (!name || !url) {
        showToast('Please fill in Name and RSS URL', 'error');
        return;
    }

    if (refreshInterval < MIN_RSS_REFRESH_INTERVAL) {
        showToast(`Refresh interval must be at least ${MIN_RSS_REFRESH_INTERVAL} seconds`, 'error');
        return;
    }

    const settings = state.getSettings();
    settings.rss_feeds[currentEditIndex] = {
        name,
        enabled,
        auto_add: autoAdd,
        auto_copy: autoCopy,
        label,
        refresh_interval: refreshInterval,
        url,
        preferred_size: preferredSize,
        max_size: maxSize
    };

    state.setSettings(settings);
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
    setButtonLoading(btn, true, 'Testing...');

    const data = await testRSSFeed(url);

    if (data.success) {
        const info = data.feed_info || {};
        showToast(`RSS feed valid: ${info.entries_count || 0} entries found`, 'success');
    } else {
        showToast(data.message || 'Failed to validate RSS feed', 'error');
    }

    setButtonLoading(btn, false);
}

// Exponer funciones para compatibilidad con onclick
window.removeIndexer = removeIndexer;
window.removeRSSFeed = removeRSSFeed;
window.openEditIndexerModal = openEditIndexerModal;
window.openEditRSSModal = openEditRSSModal;
window.handleUnignoreMovie = handleUnignoreMovie;

// ========== WATCHLIST MOVIES MANAGEMENT ==========

/**
 * Opens watchlist movies modal and loads current watchlist
 */
async function openWatchlistMoviesModal() {
    const modal = document.getElementById('watchlist-movies-modal');
    const container = document.getElementById('watchlist-movies-container');

    if (!modal || !container) {
        console.error('Watchlist modal or container not found');
        return;
    }

    // Show modal
    modal.classList.add('active');

    // Show loading
    container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Loading watchlist...</p>';

    try {
        const response = await fetch('/api/watchlist');
        const data = await response.json();

        if (data.success && data.movies) {
            if (data.movies.length === 0) {
                container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No movies in watchlist.</p>';
            } else {
                renderWatchlistMovies(data.movies, container);
            }
        } else {
            container.innerHTML = '<p style="text-align: center; color: var(--danger);\">Error loading watchlist</p>';
        }
    } catch (error) {
        console.error('Error loading watchlist:', error);
        container.innerHTML = '<p style="text-align: center; color: var(--danger);\">Error loading watchlist</p>';
    }
}

/**
 * Renders watchlist movies in the modal
 */
function renderWatchlistMovies(movies, container) {
    container.innerHTML = movies.map(movie => `
        <div class="content-card" style="padding: 1rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
            <div style="flex: 1; min-width: 0;">
                <h4 style="margin: 0 0 0.25rem 0; font-weight: 600;">${escapeHtml(movie.title)} ${movie.year ? `(${movie.year})` : ''}</h4>
                <small style="color: var(--text-muted);">
                    <i class="fa-solid fa-clock"></i> Expires in ${movie.days_remaining !== null ? movie.days_remaining : 'N/A'} days
                </small>
            </div>
            <button class="btn danger sm" onclick="window.removeFromWatchlist('${movie.torrent_hash}')">
                <i class="fa-solid fa-trash"></i> Remove
            </button>
        </div>
    `).join('');
}

/**
 * Removes a movie from watchlist
 */
async function removeFromWatchlist(hash) {
    if (!confirm('Remove this movie from watchlist?')) return;

    try {
        const response = await fetch(`/api/watchlist/${hash}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showToast('Removed from watchlist', 'success');
            // Reload watchlist
            openWatchlistMoviesModal();
        } else {
            showToast(data.message || 'Error removing from watchlist', 'error');
        }
    } catch (error) {
        console.error('Error removing from watchlist:', error);
        showToast('Error removing from watchlist', 'error');
    }
}

// Make watchlist functions globally accessible
window.removeFromWatchlist = removeFromWatchlist;
window.openWatchlistMoviesModal = openWatchlistMoviesModal;

/**
 * Carga estadísticas de Prowlarr para un indexer
 */
async function loadIndexerStats(indexerId) {
    const container = document.querySelector(`.indexer-stats-container[data-indexer-id="${indexerId}"]`);
    if (!container) return;

    try {
        const response = await fetch(`/api/indexer/stats/${indexerId}`);
        const data = await response.json();

        if (data.success) {
            const trackerCount = data.tracker_count;
            const languages = data.languages.join(', ');
            const trackers = data.trackers || [];

            // Crear tooltip con detalles
            const tooltipText = trackers
                .map(t => `${t.enabled ? '✅' : '❌'} ${t.name} (${t.language})`)
                .join('\\n');

            container.innerHTML = `
                <div class="indexer-stats" title="${tooltipText}">
                    <div class="stat-item">
                        <i class="fa-solid fa-server"></i>
                        <span>${trackerCount} tracker${trackerCount !== 1 ? 's' : ''} configured</span>
                    </div>
                    <div class="stat-item">
                        <i class="fa-solid fa-language"></i>
                        <span>Languages: ${languages || 'unknown'}</span>
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = `
                <span style="font-size: 0.75rem; color: var(--danger);">${data.message || 'Failed to load stats'}</span>
            `;
        }
    } catch (error) {
        console.error('Error loading indexer stats:', error);
        container.innerHTML = `
            <span style="font-size: 0.75rem; color: var(--text-muted);">Stats unavailable</span>
        `;
    }
}

