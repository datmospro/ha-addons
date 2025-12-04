/**
 * Gestión de estado global de la aplicación Roverr
 * Extraído de app.js - variables de estado globales
 */

import { SORT_DEFAULTS, VIEWS } from './config.js';

/**
 * Clase para gestionar el estado global de la aplicación
 */
class AppState {
    constructor() {
        // Vista actual
        this.currentView = VIEWS.DASHBOARD;

        // Datos
        this.torrents = [];
        this.movies = [];
        this.settings = {};

        // Estado de ordenación
        this.currentSort = { ...SORT_DEFAULTS };

        // Multi-selección de películas
        this.selectedMovies = new Map(); // hash -> movie data

        // Intervalos de actualización
        this.refreshInterval = null;
        this.detailsPollInterval = null;

        // Estado de edición
        this.currentEditIndex = -1;

        // Event listeners (simple event emitter)
        this._listeners = {};
    }

    // === GETTERS Y SETTERS CON VALIDACIÓN ===

    setCurrentView(view) {
        if (!Object.values(VIEWS).includes(view)) {
            console.warn(`Invalid view: ${view}`);
            return;
        }
        const oldView = this.currentView;
        this.currentView = view;
        this.emit('viewChanged', { from: oldView, to: view });
    }

    getCurrentView() {
        return this.currentView;
    }

    setTorrents(torrents) {
        this.torrents = torrents || [];
        this.emit('torrentsUpdated', this.torrents);
    }

    getTorrents() {
        return this.torrents;
    }

    setMovies(movies) {
        this.movies = movies || [];
        this.emit('moviesUpdated', this.movies);
    }

    getMovies() {
        return this.movies;
    }

    setSettings(settings) {
        this.settings = settings || {};
        this.emit('settingsUpdated', this.settings);
    }

    getSettings() {
        return this.settings;
    }

    // === MULTI-SELECCIÓN ===

    selectMovie(hash, movieData) {
        this.selectedMovies.set(hash, movieData);
        this.emit('selectionChanged', this.selectedMovies);
    }

    deselectMovie(hash) {
        this.selectedMovies.delete(hash);
        this.emit('selectionChanged', this.selectedMovies);
    }

    toggleMovieSelection(hash, movieData) {
        if (this.selectedMovies.has(hash)) {
            this.deselectMovie(hash);
        } else {
            this.selectMovie(hash, movieData);
        }
    }

    clearSelection() {
        this.selectedMovies.clear();
        this.emit('selectionChanged', this.selectedMovies);
    }

    getSelectedMovies() {
        return this.selectedMovies;
    }

    // === EVENT EMITTER SIMPLE ===

    on(event, callback) {
        if (!this._listeners[event]) {
            this._listeners[event] = [];
        }
        this._listeners[event].push(callback);
    }

    off(event, callback) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }

    emit(event, data) {
        if (!this._listeners[event]) return;
        this._listeners[event].forEach(callback => {
            try {
                callback(data);
            } catch (e) {
                console.error(`Error in event listener for ${event}:`, e);
            }
        });
    }
}

// Exportar instancia única (singleton)
export const state = new AppState();
