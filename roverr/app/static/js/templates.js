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
    if (['blocked', 'conflict'].includes(status)) return 'error';
    if (status === 'stopped') return 'skipped';
    if (status === 'recovering') return 'copying';
    if (status === 'moved' || status === 'moved_manually') return 'moved';
    if (status === 'error' || status === 'receptor_offline') return 'error';
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
        stopped: { icon: '<i class="fa-solid fa-stop"></i>', label: 'Detenida' },
        conflict: { icon: '<i class="fa-solid fa-triangle-exclamation"></i>', label: 'Revisar destino' },
        blocked: { icon: '<i class="fa-solid fa-triangle-exclamation"></i>', label: 'Requiere intervención' },
        recovering: { icon: '<i class="fa-solid fa-spinner fa-spin"></i>', label: 'Recuperando copia' },
        'moved': { icon: '<i class="fa-solid fa-check"></i>', label: 'Copiada' },
        'moved_manually': { icon: '<i class="fa-solid fa-check"></i>', label: 'Copiada' },
        'copying': { icon: '<i class="fa-solid fa-spinner fa-spin"></i>', label: 'Copiando' },
        'queued': { icon: '<i class="fa-regular fa-clock"></i>', label: 'En cola' },
        'pending': { icon: '<i class="fa-regular fa-clock"></i>', label: 'Pendiente' },
        'missing': { icon: '<i class="fa-solid fa-circle-exclamation"></i>', label: 'Destino no encontrado' },
        'new': { icon: '<i class="fa-solid fa-sparkles"></i>', label: 'Por descargar' },
        'orphaned': { icon: '<i class="fa-solid fa-link-slash"></i>', label: 'Sin torrent' },
        'downloading': { icon: '<i class="fa-solid fa-download"></i>', label: 'Descargando' },
        'error': { icon: '<i class="fa-solid fa-triangle-exclamation"></i>', label: 'Error' },
        'receptor_offline': { icon: '<i class="fa-solid fa-network-wired"></i>', label: 'Receptor desconectado' },
        'skipped': { icon: '<i class="fa-solid fa-forward"></i>', label: 'Omitida' }
    };

    return icons[status] || { icon: '<i class="fa-solid fa-circle-question"></i>', label: status };
}

export function getCopyStatusTooltip(status, progress = {}) {
    if (status === 'queued') {
        const position = progress.queue_position ? `Posición ${progress.queue_position} de ${progress.queue_total} en la cola. ` : '';
        const active = progress.active_copy ? `Ahora se está copiando: ${progress.active_copy}. ` : '';
        return `${position}${active}Solo se copia una película a la vez. La posición 1 es la siguiente en comenzar.`;
    }
    if (status === 'copying' && progress.recovering) return 'Recuperando la copia anterior. La cola espera a confirmar el estado del receptor para evitar transferencias duplicadas.';
    if (status === 'copying') return 'La copia está en curso. Las demás películas esperan su turno en la cola.';
    return '';
}

export function getQueueLabel(progress = {}) {
    return progress.queue_position ? `En cola · posición ${progress.queue_position} de ${progress.queue_total}` : 'En cola';
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

// Presentation is separate from the persisted states used by the scheduler.
export function getMovieStatus(movie) {
    const progress = movie.copy_progress || {};
    let status = movie.status;
    let reason = getCopyStatusTooltip(status, progress) || movie.status_reason || '';
    let action = 'Copiar';
    if (['moved', 'moved_manually'].includes(status)) reason = '';
    if (status === 'copying' && progress.recovering) status = 'recovering';
    else if (!['moved', 'moved_manually', 'copying', 'queued', 'downloading'].includes(status)) {
        if (movie.copy_pause_reason === 'conflict') {
            status = 'conflict';
            reason = movie.status_reason || 'El destino existe o ha cambiado. Compara los archivos antes de decidir si quieres sobrescribir o conservar el destino.';
            action = 'Revisar destino';
        } else if (movie.copy_paused && movie.copy_pause_reason !== 'conflict') {
            status = 'stopped';
            reason = 'La copia está detenida. No se iniciará automáticamente; pulsa Reanudar copia para volver a ponerla en cola.';
            action = 'Reanudar copia';
        } else if (['error', 'skipped'].includes(status)) {
            status = 'blocked';
            reason = movie.status_reason || 'La copia no pudo completarse. Revisa las rutas y el registro del addon y pulsa Reintentar copia.';
            action = 'Reintentar copia';
        }
    }
    if (status === 'receptor_offline') reason ||= 'No se puede contactar con el receptor. Comprueba que esté iniciado y que su dirección y puerto sean correctos; después reintenta la copia.';
    if (status === 'missing') reason ||= 'El archivo copiado no se encuentra en el destino. Comprueba que la unidad esté montada antes de reintentar.';
    if (status === 'pending') reason ||= 'La descarga está completa y la copia aún no está en cola. Puedes iniciarla con Copiar.';
    if (status === 'new') reason ||= 'La película todavía no tiene una descarga confirmada. Usa Manual Search para buscar un torrent.';
    if (status === 'orphaned') reason ||= 'El torrent ya no está disponible en el cliente. Usa Manual Search para buscar una descarga.';
    const badge = getStatusIconAndLabel(status);
    return { status, reason, action, cssClass: getStatusClass(status), ...badge };
}
