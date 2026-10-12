import { state } from './state.js';
import { getProgressClass } from './ui.js';
import { getStatusClass, getStatusIconAndLabel, getCopyStatusTooltip } from './templates.js';

let socket = null;
let socketReconnectTimeout = null;
let previousProgressHashes = new Set();
let messageQueue = Promise.resolve();

export function connectWebSocket() {
    if (socket) {
        socket.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    console.log(`🔌 Connecting WebSocket to: ${wsUrl}`);
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log('✅ WebSocket connected');
        state.wsConnected = true;
        if (socketReconnectTimeout) {
            clearTimeout(socketReconnectTimeout);
            socketReconnectTimeout = null;
        }
    };

    previousProgressHashes = new Set();
    socket.onmessage = event => {
        // WebSocket delivers in order, but async imports/fetches otherwise let
        // older handlers finish after newer final-state messages.
        messageQueue = messageQueue.then(() => handleSocketMessage(event));
    };

    async function handleSocketMessage(event) {
        try {
            const data = JSON.parse(event.data);
            console.log('📬 WebSocket message received:', data.type);
            
            if (data.type === 'initial' || data.type === 'movies') {
                // Update active movies in state
                state.setMovies(data.movies);
                
                // Update dashboard UI
                const { updateSeriesNotification, renderMovieCards } = await import('./movies.js');
                updateSeriesNotification(data.ignored_series || []);
                renderMovieCards(data.movies || []);
                const details = document.getElementById('movie-details-content');
                const current = (data.movies || []).find(movie => movie.torrent_hash === details?.dataset.hash);
                if (current && details.dataset.status !== current.status) {
                    const { getCurrentView } = await import('./navigation.js');
                    if (getCurrentView() === 'movie-details') {
                        const { showMovieDetails } = await import('./movies.js');
                        await showMovieDetails(current.torrent_hash);
                    }
                }

                if (data.client_status !== undefined) {
                    const { updateTorrentClientAlert } = await import('./ui.js');
                    updateTorrentClientAlert(data.client_status);
                }
            } else if (data.type === 'progress') {
                await updateRealtimeProgress(data.progress);
                if (data.client_status !== undefined) {
                    const { updateTorrentClientAlert } = await import('./ui.js');
                    updateTorrentClientAlert(data.client_status);
                }
            } else if (data.type === 'client_status') {
                const { updateTorrentClientAlert } = await import('./ui.js');
                updateTorrentClientAlert(data.client_status);
            }
        } catch (e) {
            console.error('Error handling WebSocket message:', e);
        }
    }

    socket.onclose = () => {
        console.log('❌ WebSocket disconnected. Retrying in 5s...');
        state.wsConnected = false;
        socketReconnectTimeout = setTimeout(connectWebSocket, 5000);
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        socket.close();
    };
}

async function updateRealtimeProgress(progressData) {
    if (!progressData) return;
    const currentHashes = new Set(Object.keys(progressData));
    const finished = [...previousProgressHashes].filter(hash => !currentHashes.has(hash));
    previousProgressHashes = currentHashes;
    if (finished.some(hash => state.getMovies().some(movie =>
        movie.torrent_hash === hash && ['copying', 'queued', 'downloading'].includes(movie.status)))) {
        // A progress message only contains active jobs, so disappearance alone
        // cannot tell us whether the result was success, cancellation or error.
        const { fetchMovies } = await import('./movies.js');
        await fetchMovies(true);
    }
    state.setMovies(state.getMovies().map(movie => {
        const progress = progressData[movie.torrent_hash];
        if (!progress) return movie;
        const status = progress.type === 'copying'
            ? (progress.state === 'queued' ? 'queued' : 'copying') : 'downloading';
        return { ...movie, status };
    }));

    const { getCurrentView } = await import('./navigation.js');
    const currentView = getCurrentView();
    
    // 1. Update cards on the dashboard grid
    for (const [hash, p] of Object.entries(progressData)) {
        const card = document.querySelector(`.movie-card[data-hash="${hash}"]`);
        if (card) {
            const progressBar = card.querySelector('.progress-bar');
            if (progressBar) {
                progressBar.style.display = 'block';
                const fill = progressBar.querySelector('.fill');
                if (fill) {
                    const progressPercent = p.progress * 100;
                    fill.style.width = `${progressPercent}%`;
                    fill.className = `fill ${p.type === 'copying' ? 'copying' : getProgressClass(p.state)}`;
                }
            }
            
            const overlay = card.querySelector('.overlay-status');
            if (overlay) {
                const status = p.type === 'copying' ? (p.state === 'queued' ? 'queued' : 'copying') : (p.state === 'downloading' ? 'downloading' : 'new');
                const statusClass = getStatusClass(status);
                const { icon: statusIcon, label: statusLabel } = getStatusIconAndLabel(status);
                overlay.className = `overlay-status ${statusClass}`;
                overlay.innerHTML = `${statusIcon} ${statusLabel}`;
                overlay.title = getCopyStatusTooltip(status, p);
            }
        }
        
        // 2. Update movie details view if open and matches this movie
        if (currentView === 'movie-details') {
            const detailsContainer = document.getElementById('movie-details-content');
            if (detailsContainer && detailsContainer.getAttribute('data-hash') === hash) {
                const progressContainer = detailsContainer.querySelector('.details-progress-container');
                if (!progressContainer) {
                    // Trigger re-render of details if progress container isn't shown yet
                    const { showMovieDetails } = await import('./movies.js');
                    showMovieDetails(hash);
                } else {
                    const { updateProgressUI } = await import('./movies.js');
                    const type = p.type === 'copying' && p.state === 'queued' ? 'queued' : p.type;
                    updateProgressUI({ ...p, percent: p.progress * 100, progress: p.progress * 100 }, type);
                }
            }
        }
    }
}
