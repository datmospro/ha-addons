/**
 * Utilidades de UI para Roverr
 * Extraído de app.js - funciones showToast, modales, utilidades
 */

import { TOAST_DURATION } from './config.js';

// Container para toasts (se creará dinámicamente)
let toastContainer = null;

/**
 * Inicializa el contenedor de toasts
 */
export function initUI() {
    // Create toast container if it doesn't exist
    toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(toastContainer);
    }

    // Asegurar que el estilo de toasts exista (mismo código que app.js original)
    if (!document.getElementById('toast-style')) {
        const style = document.createElement('style');
        style.id = 'toast-style';
        style.textContent = `
            .toast {
                position: relative;
                padding: 10px 20px;
                border-radius: 6px;
                color: white;
                font-weight: 500;
                animation: slideIn 0.3s ease-out;
                min-width: 250px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            }
            .toast-success { background-color: #10b981; }
            .toast-error { background-color: #ef4444; }
            .toast-info { background-color: #3b82f6; }
            .toast-warning { background-color: #f59e0b; }
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
}

/**
 * Muestra un toast notification
 * EXACTAMENTE igual que app.js original (líneas 990-1028)
 * @param {string} message - Mensaje a mostrar
 * @param {string} type - Tipo: 'success', 'error', 'info', 'warning'
 */
export function showToast(message, type = 'info') {
    if (!toastContainer) {
        initUI();
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, TOAST_DURATION);
}

/**
 * Muestra el overlay de redirección
 * Líneas 584-617 de app.js
 */
export function showRedirectOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'redirect-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        backdrop-filter: blur(5px);
        opacity: 0;
        transition: opacity 0.3s ease;
    `;

    overlay.innerHTML = `
        <div style="text-align: center; color: white;">
            <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 3rem; color: var(--primary); margin-bottom: 1.5rem;"></i>
            <h2 style="font-size: 1.8rem; margin-bottom: 0.5rem;">Torrent Added Successfully</h2>
            <p style="font-size: 1.2rem; color: #ccc;">Redirecting to movie details...</p>
        </div>
    `;

    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
    });
}

/**
 * Elimina el overlay de redirección
 * Líneas 619-627 de app.js
 */
export function removeRedirectOverlay() {
    const overlay = document.getElementById('redirect-overlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 300);
    }
}

/**
 * Abre un modal por ID
 */
export function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    } else {
        console.warn(`Modal not found: ${modalId}`);
    }
}

/**
 * Cierra un modal por ID
 */
export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

/**
 * Escapa HTML para prevenir XSS
 * Líneas 517-522 de app.js
 */
export function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Formatea bytes a formato legible
 * Líneas 1578-1585 de app.js
 */
export function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Formatea timestamp de Unix a fecha legible
 */
export function formatDate(timestamp) {
    if (!timestamp || timestamp <= 0) return '-';
    return new Date(timestamp * 1000).toLocaleString();
}

/**
 * Establece el estado de carga de un botón
 */
export function setButtonLoading(buttonElement, isLoading, loadingText = 'Loading...') {
    if (!buttonElement) return;

    if (isLoading) {
        buttonElement.dataset.originalContent = buttonElement.innerHTML;
        buttonElement.disabled = true;
        buttonElement.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${loadingText}`;
    } else {
        buttonElement.disabled = false;
        buttonElement.innerHTML = buttonElement.dataset.originalContent || buttonElement.innerHTML;
        delete buttonElement.dataset.originalContent;
    }
}

/**
 * Obtiene la clase de progreso según el estado del torrent
 * Líneas 1570-1576 de app.js
 */
export function getProgressClass(state) {
    if (state === 'downloading') return 'downloading';
    if (state === 'pausedDL' || state === 'pausedUP') return 'paused';
    if (state === 'uploading' || state === 'stalledUP') return 'seeding';
    if (state === 'error') return 'error';
    return 'completed';
}

/**
 * Actualiza el banner de alerta y el indicador de estado del cliente torrent (qBittorrent)
 * @param {Object} status - Estado del cliente { connected, last_error, error_type, host, port }
 */
export function updateTorrentClientAlert(status) {
    const alertBanner = document.getElementById('torrent-client-alert');
    const sidebarIndicator = document.getElementById('sidebar-qb-status');
    const alertTitle = document.getElementById('client-alert-title-text');
    const alertDesc = document.getElementById('client-alert-desc');
    const alertTips = document.getElementById('client-alert-tips-list');
    
    if (sidebarIndicator && !sidebarIndicator._hasClick) {
        sidebarIndicator._hasClick = true;
        sidebarIndicator.addEventListener('click', () => {
            const navSettings = document.querySelector('[data-view="settings"]');
            if (navSettings) {
                navSettings.click();
                setTimeout(() => {
                    const qbHost = document.getElementById('setting-qb-host');
                    if (qbHost) {
                        qbHost.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        qbHost.focus();
                    }
                }, 150);
            }
            if (sidebarIndicator.dataset.lastError) {
                showToast(sidebarIndicator.dataset.lastError, 'warning', 6000);
            }
        });
    }

    if (!status || status.connected) {
        if (alertBanner) alertBanner.style.display = 'none';
        if (sidebarIndicator) {
            sidebarIndicator.className = 'qb-status-indicator online';
            sidebarIndicator.title = `qBittorrent: Conectado (${status?.host || 'OK'}) - Clic para configurar`;
            sidebarIndicator.dataset.lastError = '';
            const text = sidebarIndicator.querySelector('.qb-status-text');
            if (text) text.textContent = 'qBittorrent OK';
        }
        return;
    }

    // Torrent client is disconnected!
    if (sidebarIndicator) {
        sidebarIndicator.className = 'qb-status-indicator offline';
        sidebarIndicator.title = `qBittorrent: Desconectado (${status.host}:${status.port}) - Clic para configurar`;
        sidebarIndicator.dataset.lastError = status.last_error || 'qBittorrent no responde.';
        const text = sidebarIndicator.querySelector('.qb-status-text');
        if (text) text.textContent = 'qBittorrent Desconectado';
    }

    if (alertBanner) {
        alertBanner.style.display = 'flex';
        
        const hostPort = `${escapeHtml(status.host || '192.168.0.169')}:${escapeHtml(String(status.port || '8080'))}`;
        
        if (status.error_type === 'connection_refused') {
            if (alertTitle) alertTitle.textContent = '⚠️ qBittorrent no responde (Conexión rechazada)';
            if (alertDesc) alertDesc.innerHTML = `No se puede conectar con qBittorrent en <strong>${hostPort}</strong>. La aplicación o contenedor parece estar <strong>cerrado</strong> o su Web UI inactiva.`;
            if (alertTips) {
                alertTips.innerHTML = `
                    <li><strong>1.</strong> Abre la aplicación o contenedor de <strong>qBittorrent</strong> si se ha cerrado.</li>
                    <li><strong>2.</strong> En qBittorrent, entra en <em>Herramientas → Opciones → Interfaz Web</em> y comprueba que esté habilitada en el puerto <strong>${escapeHtml(String(status.port || '8080'))}</strong>.</li>
                    <li><strong>3.</strong> Una vez abierto qBittorrent, haz clic en <strong>Reintentar</strong> a la derecha.</li>
                `;
            }
        } else if (status.error_type === 'timeout') {
            if (alertTitle) alertTitle.textContent = '⚠️ Tiempo de espera agotado con qBittorrent';
            if (alertDesc) alertDesc.innerHTML = `No hay respuesta de <strong>${hostPort}</strong>.`;
            if (alertTips) {
                alertTips.innerHTML = `
                    <li><strong>1.</strong> Comprueba que el equipo donde corre qBittorrent esté encendido y conectado a la red.</li>
                    <li><strong>2.</strong> Verifica si la dirección IP del equipo ha cambiado por DHCP.</li>
                    <li><strong>3.</strong> Revisa si el cortafuegos está bloqueando el puerto <strong>${escapeHtml(String(status.port || '8080'))}</strong>.</li>
                `;
            }
        } else {
            if (alertTitle) alertTitle.textContent = '⚠️ Error de conexión con qBittorrent';
            if (alertDesc) alertDesc.textContent = status.last_error || 'Error al conectar con el cliente torrent.';
            if (alertTips) {
                alertTips.innerHTML = `
                    <li><strong>1.</strong> Comprueba el usuario y contraseña de qBittorrent en Ajustes de Roverr.</li>
                    <li><strong>2.</strong> Verifica que la Web UI de qBittorrent permita conexiones desde la red local.</li>
                `;
            }
        }
    }
}
