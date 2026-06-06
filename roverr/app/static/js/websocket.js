import { state } from './state.js';
import { getProgressClass } from './ui.js';
import { getStatusClass, getStatusIconAndLabel } from './templates.js';

let socket = null;
let socketReconnectTimeout = null;

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

    socket.onmessage = async (event) => {
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
            } else if (data.type === 'progress') {
                updateRealtimeProgress(data.progress);
            }
        } catch (e) {
            console.error('Error handling WebSocket message:', e);
        }
    };

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
                const status = p.type === 'copying' ? 'copying' : (p.state === 'downloading' ? 'downloading' : 'new');
                const statusClass = getStatusClass(status);
                const { icon: statusIcon, label: statusLabel } = getStatusIconAndLabel(status);
                overlay.className = `overlay-status ${statusClass}`;
                overlay.innerHTML = `${statusIcon} ${statusLabel}`;
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
                    const percentEl = progressContainer.querySelector('.progress-info span:first-child');
                    const speedEl = progressContainer.querySelector('.progress-info span:last-child');
                    const barEl = progressContainer.querySelector('.progress-bar .details-progress-fill');
                    
                    const label = p.type === 'copying' ? 'Copying...' : 'Downloading...';
                    const percent = p.progress * 100;
                    const percentStr = percent.toFixed(1);
                    
                    if (percentEl) percentEl.textContent = `${label} ${percentStr}%`;
                    if (speedEl) speedEl.textContent = `${p.speed} MB/s`;
                    if (barEl) {
                        barEl.style.width = `${percent}%`;
                        barEl.className = `details-progress-fill ${p.type}`;
                    }
                }
            }
        }
    }
}
