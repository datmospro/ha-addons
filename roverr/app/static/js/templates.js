/**
 * Templates HTML para Roverr
 * Extrae los templates HTML del código JavaScript para mayor claridad
 * Este es un módulo simplificado - templates completos se añadirán en siguientes fases
 */

import { escapeHtml, formatBytes, formatDate, getProgressClass } from './ui.js';

/**
 * Obtiene la clase CSS para un status badge
 */
function getStatusClass(status) {
    if (status === 'moved' || status === 'moved_manually') return 'moved';
    if (status === 'error') return 'error';
    if (status === 'skipped') return 'skipped';
    if (status === 'copying') return 'copying';
    if (status === 'new') return 'new';
    if (status === 'orphaned') return 'orphaned';
    return 'pending';
}

/**
 * Obtiene el ícono y label para un status
 */
function getStatusIconAndLabel(status) {
    const icons = {
        'moved': { icon: '<i class="fa-solid fa-check"></i>', label: 'Moved' },
        'moved_manually': { icon: '<i class="fa-solid fa-check"></i>', label: 'Moved' },
        'copying': { icon: '<i class="fa-solid fa-spinner fa-spin"></i>', label: 'Copying' },
        'pending': { icon: '<i class="fa-regular fa-clock"></i>', label: 'Pending' },
        'missing': { icon: '<i class="fa-solid fa-circle-exclamation"></i>', label: 'Missing' },
        'new': { icon: '<i class="fa-solid fa-sparkles"></i>', label: 'New' },
        'orphaned': { icon: '<i class="fa-solid fa-link-slash"></i>', label: 'Orphaned' },
        'downloading': { icon: '<i class="fa-solid fa-download"></i>', label: 'Downloading' },
        'error': { icon: '<i class="fa-solid fa-triangle-exclamation"></i>', label: 'Error' },
        'skipped': { icon: '<i class="fa-solid fa-forward"></i>', label: 'Skipped' }
    };

    return icons[status] || { icon: '<i class="fa-solid fa-circle-question"></i>', label: status };
}

/**
 * Template para barra de progreso
 */
export function progressBarTemplate(percent, cssClass = '') {
    return `
        <div class="progress-bar">
            <div class="progress-fill ${cssClass}" style="width: ${percent}%"></div>
        </div>
        <div class="progress-text">${percent}%</div>
    `;
}

/**
 * Template para badge de status
 */
export function statusBadgeTemplate(status) {
    const statusClass = getStatusClass(status);
    const { icon, label } = getStatusIconAndLabel(status);

    return `<span class="status-badge status-${statusClass}">${icon} ${label}</span>`;
}

/**
 * NOTA: Los templates completos (torrentRowTemplate, movieCardTemplate, etc.) 
 * serán añadidos en la siguiente fase cuando se implementen los módulos
 * dashboard.js, search.js, y movies.js que los utilizan.
 * 
 * Por ahora, mantenemos solo las funciones helper para evitar dependencias circulares.
 */

// Exportar helpers
export { getStatusClass, getStatusIconAndLabel };
