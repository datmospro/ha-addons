/**
 * Módulo Dashboard para Roverr
 * Gestiona torrents, tabla de torrents, RSS countdown y acciones de dashboard
 * Extraído de app.js - líneas 73-331, 1030-1054
 * 
 * Optimizaciones v4.0.0:
 * - RSS countdown: 1s → 10s (90% menos requests)
 * - Polling inteligente: 2s cuando hay torrents activos, 10s cuando no
 * - Pausa polling cuando página inactiva, reactiva instantáneamente al volver
 */

import { state } from './state.js';
import {
    getTorrents, triggerCheck as apiTriggerCheck, fetchRSS,
    moveManually as apiMoveManually, stopCopy as apiStopCopy,
    markAsMoved as apiMarkAsMoved, getRSSStatus
} from './api.js';
import { showToast, formatBytes, formatDate, setButtonLoading } from './ui.js';
import { getStatusClass } from './templates.js';

// Referencias DOM

let refreshBtn;
let triggerBtn;
let fetchRssBtn;
let rssCountdownEl;

// Variables para polling inteligente
let isPageVisible = true;
let currentPollingInterval = 2000;

/**
 * Inicializa el módulo de dashboard
 * Líneas 73-94 de app.js
 */
export function initDashboard() {

    refreshBtn = document.getElementById('refresh-btn');
    triggerBtn = document.getElementById('trigger-btn');
    fetchRssBtn = document.getElementById('fetch-rss-btn');
    rssCountdownEl = document.getElementById('rss-countdown');

    // Event listeners
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            await fetchTorrents();
            const { fetchMovies } = await import('./movies.js');
            await fetchMovies();
        });
    }

    if (triggerBtn) {
        triggerBtn.addEventListener('click', handleTriggerCheck);
    }

    if (fetchRssBtn) {
        fetchRssBtn.addEventListener('click', handleFetchRSS);
    }

    // Sorting Event Listeners


    // RSS countdown update (optimizado: cada 10s en lugar de 1s)
    initRSSCountdown();
}

/**
 * Configura el sistema de ordenación de la tabla
 */


/**
 * Obtiene y renderiza los torrents
 * Líneas 96-104 de app.js
 */
export async function fetchTorrents() {
    const torrents = await getTorrents();
    state.setTorrents(torrents);

}

/**
 * Trigger manual check
 * Líneas 106-114 de app.js
 */
async function handleTriggerCheck() {
    const data = await apiTriggerCheck();
    if (data.success !== false) {
        showToast('Auto-check triggered', 'success');
        await fetchTorrents();
    } else {
        showToast('Error triggering check', 'error');
    }
}

/**
 * Fetch RSS movies
 * Líneas 116-139 de app.js
 */
async function handleFetchRSS() {
    if (!fetchRssBtn) return;

    setButtonLoading(fetchRssBtn, true, 'Fetching...');

    const data = await fetchRSS();

    if (data.success) {
        showToast(data.message, 'success');
        await fetchTorrents();
        const { fetchMovies } = await import('./movies.js');
        await fetchMovies();
    } else {
        showToast(data.message, 'error');
    }

    setButtonLoading(fetchRssBtn, false);
}

/**
 * Ordena los torrents según la configuración actual
 * Líneas 141-158 de app.js
 */


/**
 * Actualiza los headers de ordenación
 * Líneas 160-172 de app.js
 */


/**
 * Renderiza la tabla de torrents
 * Líneas 174-262 de app.js
 */


/**
 * Adjunta event listeners a checkboxes y elementos de la tabla
 */


/**
 * Mueve un torrent manualmente
 * Líneas 264-291 de app.js
 */
export async function manualMove(hash) {
    const data = await apiMoveManually(hash);

    if (data.status === 'started') {
        showToast('Move started', 'success');

        // If in details view for this movie, reload it
        const detailsContainer = document.getElementById('movie-details-content');
        if (detailsContainer && detailsContainer.getAttribute('data-hash') === hash) {
            setTimeout(async () => {
                const { showMovieDetails } = await import('./movies.js');
                showMovieDetails(hash);
            }, 500);
        }

        await fetchTorrents();
    } else {
        showToast(data.message, 'error');
    }
}



/**
 * Detiene la copia de un torrent
 * Líneas 293-307 de app.js
 */


/**
 * Inicializa el contador de RSS
 * OPTIMIZADO: actualiza cada 10s en lugar de 1s (90% menos requests)
 */
function initRSSCountdown() {
    updateRSSCountdown();
    setInterval(updateRSSCountdown, 10000); // Cambiado de 1000ms a 10000ms
}

async function updateRSSCountdown() {
    if (!rssCountdownEl) return;

    const data = await getRSSStatus();

    if (data.has_feeds && data.countdown_seconds >= 0) {
        const minutes = Math.floor(data.countdown_seconds / 60);
        const seconds = data.countdown_seconds % 60;
        const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        rssCountdownEl.innerHTML = `<i class="fa-solid fa-clock"></i> Next RSS: <strong>${data.next_feed_name}</strong> in ${timeStr}`;
        rssCountdownEl.style.display = 'block';
    } else {
        rssCountdownEl.style.display = 'none';
    }
}

/**
 * Inicia auto-refresh de torrents con POLLING INTELIGENTE
 * 
 * Optimizaciones v4.0.0:
 * 1. Intervalo adaptativo:
 *    - 2s cuando HAY torrents activos (downloading/copying)
 *    - 10s cuando NO hay torrents activos (80% menos requests)
 * 2. Detección de página inactiva:
 *    - Pausa polling cuando la página está oculta/en segundo plano
 *    - Reactiva INSTANTÁNEAMENTE cuando vuelve a estar visible
 * 3. Fetch inmediato al reactivar para datos frescos
 */
export function startDashboardAutoRefresh(interval = 2000) {
    if (state.refreshInterval) {
        clearInterval(state.refreshInterval);
    }

    // Función de polling que se ejecuta en cada intervalo
    const pollFunction = async () => {
        // Solo hacer polling si la página está visible
        if (!isPageVisible) {
            return;
        }

        await fetchTorrents();
        const { fetchMovies } = await import('./movies.js');
        await fetchMovies(true); // isPolling = true

        // Ajustar intervalo dinámicamente según actividad
        adjustPollingInterval();
    };

    // Primera ejecución inmediata
    pollFunction();

    // Configurar intervalo inicial
    state.refreshInterval = setInterval(pollFunction, interval);
    currentPollingInterval = interval;

    // Setup Page Visibility API
    setupPageVisibilityDetection();
}

/**
 * Ajusta el intervalo de polling según si hay torrents activos
 * - Torrents activos = downloading, copying, o progreso < 100%
 * - Si hay activos: 2s (responsive)
 * - Si NO hay activos: 10s (ahorro de recursos)
 */
function adjustPollingInterval() {
    const torrents = state.getTorrents();
    const hasActiveTorrents = torrents.some(t =>
        t.status === 'copying' ||
        t.state === 'downloading' ||
        t.progress < 1
    );

    const newInterval = hasActiveTorrents ? 2000 : 10000;

    // Solo cambiar si el intervalo es diferente
    if (newInterval !== currentPollingInterval) {
        console.log(`🔄 Polling interval adjusted: ${currentPollingInterval}ms → ${newInterval}ms (Active torrents: ${hasActiveTorrents})`);
        currentPollingInterval = newInterval;

        // Reiniciar con nuevo intervalo
        if (state.refreshInterval) {
            clearInterval(state.refreshInterval);
            state.refreshInterval = setInterval(async () => {
                if (!isPageVisible) return;

                await fetchTorrents();
                const { fetchMovies } = await import('./movies.js');
                await fetchMovies(true);
                adjustPollingInterval();
            }, newInterval);
        }
    }
}

/**
 * Configura detección de visibilidad de página con Page Visibility API y Focus API
 * - Detecta cuando el usuario cambia de tab o minimiza ventana (visibilitychange)
 * - Detecta cuando la ventana pierde el foco (blur) - Petición de usuario: detener si no es pestaña activa
 * - Pausa polling para ahorrar recursos
 * - Reactiva instantáneamente con fetch inmediato al volver
 */
function setupPageVisibilityDetection() {
    // Evitar múltiples listeners
    if (window._roverrVisibilitySetup) return;
    window._roverrVisibilitySetup = true;

    // Función para evaluar si debemos hacer polling
    const checkVisibility = () => {
        // Estricto: debe estar visible Y tener foco (ser la pestaña activa)
        const isVisible = !document.hidden;
        const hasFocus = document.hasFocus();

        const shouldPoll = isVisible && hasFocus;

        if (shouldPoll !== isPageVisible) {
            isPageVisible = shouldPoll;

            if (isPageVisible) {
                console.log('▶️ Page active & focused - resuming polling');
                // Fetch inmediato al volver para datos frescos
                (async () => {
                    await fetchTorrents();
                    const { fetchMovies } = await import('./movies.js');
                    await fetchMovies(true);
                    adjustPollingInterval();
                })();
            } else {
                console.log('⏸️ Page inactive/background - pausing polling');
            }
        }
    };

    // Listeners
    document.addEventListener('visibilitychange', checkVisibility);
    window.addEventListener('blur', checkVisibility);
    window.addEventListener('focus', checkVisibility);

    // Estado inicial
    isPageVisible = !document.hidden && document.hasFocus();
}

/**
 * Detiene auto-refresh
 */
export function stopDashboardAutoRefresh() {
    if (state.refreshInterval) {
        clearInterval(state.refreshInterval);
        state.refreshInterval = null;
    }
    currentPollingInterval = 2000;
}
