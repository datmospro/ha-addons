/**
 * Configuración centralizada de la aplicación Roverr
 * Extraído de app.js - constantes globales
 */

// API Configuration
export const API_BASE = '/api';

// Polling intervals
export const DEFAULT_POLL_INTERVAL = 2000; // ms - cuando hay torrents activos
export const IDLE_POLL_INTERVAL = 10000; // ms - cuando NO hay torrents activos
export const DETAILS_POLL_INTERVAL = 1000; // ms
export const RSS_COUNTDOWN_INTERVAL = 10000; // ms - actualización del countdown RSS

// UI Configuration
export const REDIRECT_DELAY = 2500; // ms
export const TOAST_DURATION = 3000; // ms

// Views disponibles
export const VIEWS = {
    DASHBOARD: 'dashboard',
    SEARCH: 'search',
    SETTINGS: 'settings',
    MOVIE_DETAILS: 'movie-details'
};

// Configuración de ordenación por defecto
export const SORT_DEFAULTS = {
    field: 'completion_on',
    direction: 'desc'
};

// Categorías por defecto para indexers
export const DEFAULT_INDEXER_CATEGORIES = '2000,2010,2020,2030,2040,2045,2050,2060';

// RSS Configuration
export const MIN_RSS_REFRESH_INTERVAL = 60; // seconds
export const DEFAULT_RSS_REFRESH_INTERVAL = 300; // seconds
