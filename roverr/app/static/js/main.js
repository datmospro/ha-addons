/**
 * Punto de entrada principal para Roverr (versión modularizada)
 * Este archivo inicializa todos los módulos y arranca la aplicación
 * Reemplaza app.js - líneas 23-44 (DOMContentLoaded)
 */

import { initUI } from './ui.js';
import { initNavigation } from './navigation.js';
import { initDashboard, fetchTorrents, startDashboardAutoRefresh } from './dashboard.js';
import { initSearch } from './search.js';
import { initSettings, loadSettings } from './settings.js';
import { initMovies, fetchMovies } from './movies.js';
import { DEFAULT_POLL_INTERVAL } from './config.js';
import { loadModals } from './modal-loader.js';


/**
 * Inicializa la aplicación completa
 * Líneas 23-44 de app.js original
 */
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Roverr starting (modular version)...');

    try {
        // 0. Load modals first (must be in DOM before event listeners attach)
        await loadModals();
        console.log('✓ Modals loaded');

        // 1. Initialize UI utilities (toasts, etc.)
        initUI();
        console.log('✓ UI initialized');

        // 2. Initialize all modules
        initNavigation();
        console.log('✓ Navigation initialized');

        initDashboard();
        console.log('✓ Dashboard initialized');

        initSearch();
        console.log('✓ Search initialized');

        initSettings();
        console.log('✓ Settings initialized');

        initMovies();
        console.log('✓ Movies initialized');

        // 3. Load initial data
        console.log('Loading initial data...');
        await Promise.all([
            fetchTorrents(),
            loadSettings(),
            fetchMovies()
        ]);
        console.log('✓ Initial data loaded');

        // 4. Start auto-refresh
        startDashboardAutoRefresh(DEFAULT_POLL_INTERVAL);
        console.log('✓ Auto-refresh started');

        console.log('✅ Roverr initialized successfully!');
        console.log('🔧 Version 4.4.78 - Dark Premium UI/UX Redesign - JavaScript is UPDATED');

    } catch (error) {
        console.error('❌ Error initializing Roverr:', error);
        alert('Error initializing application. Check console for details.');
    }
});

/**
 * Cleanup on page unload
 */
window.addEventListener('beforeunload', () => {
    const { stopDashboardAutoRefresh } = require('./dashboard.js');
    stopDashboardAutoRefresh();
});

console.log('Roverr main.js loaded');
