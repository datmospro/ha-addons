/**
 * Módulo de Navegación para Roverr
 * Controla el cambio entre vistas de la aplicación
 * Extraído de app.js - líneas 46-69
 */

import { state } from './state.js';
import { VIEWS } from './config.js';

// Referencias DOM
let views = {};
let navItems = [];

/**
 * Inicializa el sistema de navegación
 * Configura los event listeners para los botones de navegación
 */
export function initNavigation() {
    // Cachear referencias a las vistas
    views = {
        [VIEWS.DASHBOARD]: document.getElementById('view-dashboard'),
        [VIEWS.SEARCH]: document.getElementById('view-search'),
        [VIEWS.SETTINGS]: document.getElementById('view-settings'),
        [VIEWS.MOVIE_DETAILS]: document.getElementById('view-movie-details')
    };

    // Cachear botones de navegación
    navItems = Array.from(document.querySelectorAll('.nav-item'));

    // Configurar event listeners
    navItems.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.view;
            switchView(target);
        });
    });
}

/**
 * Cambia a una vista específica
 * Líneas 55-69 de app.js original
 * @param {string} viewName - Nombre de la vista a mostrar
 */
export function switchView(viewName) {
    if (!Object.values(VIEWS).includes(viewName)) {
        console.warn(`Invalid view: ${viewName}`);
        return;
    }

    // Actualizar estado global
    state.setCurrentView(viewName);

    // Actualizar botones de navegación
    navItems.forEach(btn => {
        if (btn.dataset.view === viewName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Actualizar vistas (mostrar/ocultar)
    Object.keys(views).forEach(key => {
        if (key === viewName) {
            views[key].classList.add('active');
        } else {
            views[key].classList.remove('active');
        }
    });
}

/**
 * Obtiene la vista actual
 */
export function getCurrentView() {
    return state.getCurrentView();
}
