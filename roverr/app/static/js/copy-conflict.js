import { escapeHtml, formatBytes } from './ui.js';

export function showCopyConflict(comparison) {
    return new Promise(resolve => {
        const previousFocus = document.activeElement;
        const modal = document.createElement('div');
        modal.className = 'modal-backdrop active';
        const size = info => info.exists
            ? `${formatBytes(info.size)} (${Number(info.size).toLocaleString('es-ES')} bytes)`
            : 'No existe';
        const date = info => info.modified
            ? new Date(info.modified).toLocaleString('es-ES') : '—';
        const rows = comparison.files.map(row => {
            const difference = row.difference_bytes;
            let summary = 'Archivo nuevo';
            if (row.destination.exists) {
                summary = row.same_size ? 'Mismo tamaño; contenido sin verificar'
                    : difference < 0 ? `El destino tiene ${formatBytes(-difference)} menos; podría estar incompleto`
                    : `El destino tiene ${formatBytes(difference)} más; podría ser una versión diferente`;
            }
            return `<tr>
                <td data-label="Origen" style="overflow-wrap:anywhere"><code>${escapeHtml(row.source.path)}</code><br>
                    ${size(row.source)}<br><small>Modificado: ${date(row.source)}</small></td>
                <td data-label="Destino" style="overflow-wrap:anywhere"><code>${escapeHtml(row.destination.path)}</code><br>
                    ${size(row.destination)}<br><small>Modificado: ${date(row.destination)}</small></td>
                <td data-label="Comparación">${escapeHtml(summary)}${difference !== null ? `<br><small>Diferencia: ${difference > 0 ? '+' : ''}${Number(difference).toLocaleString('es-ES')} bytes</small>` : ''}</td>
            </tr>`;
        }).join('');
        modal.innerHTML = `<style>
            .copy-conflict-dialog {display:flex;flex-direction:column;max-width:1000px;max-height:90vh}
            .copy-conflict-content {overflow-y:auto;min-height:0}
            .copy-comparison-table {width:100%;border-collapse:separate;border-spacing:12px;table-layout:fixed}
            .copy-comparison-table td {vertical-align:top}
            @media (max-width:600px) {
                .copy-conflict-dialog {padding:1rem}
                .copy-comparison-table, .copy-comparison-table tbody, .copy-comparison-table tr, .copy-comparison-table td {display:block;width:100%}
                .copy-comparison-table thead {display:none}
                .copy-comparison-table td {padding:8px 0}
                .copy-comparison-table td::before {content:attr(data-label);display:block;font-weight:600;margin-bottom:4px}
                .copy-comparison-table tr {border-bottom:1px solid var(--border);padding-bottom:12px}
            }
        </style><div class="modal-dialog copy-conflict-dialog" role="dialog" aria-modal="true"
            aria-labelledby="copy-conflict-title">
            <h2 id="copy-conflict-title">El archivo de destino ya existe</h2>
            <div class="copy-conflict-content">
            <p style="overflow-wrap:anywhere">${escapeHtml(comparison.torrent_name)}</p>
            <p><strong>Ubicación:</strong> ${escapeHtml(comparison.location)}</p>
            <div style="overflow-x:auto;margin:1rem 0">
                <table class="copy-comparison-table">
                    <thead><tr><th>Origen</th><th>Destino</th><th>Comparación</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <p>Sobrescribir crea primero una copia temporal y sustituye el destino al terminar.
                Conservar no modifica el archivo y marca la película como copiada, aunque su tamaño sea diferente.</p>
            ${!comparison.all_destinations_exist ? '<p>Faltan archivos de destino; no se puede marcar toda la película como copiada.</p>' : ''}
            </div><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:1.5rem;flex-shrink:0">
                <button class="btn danger" data-action="overwrite">Sobrescribir</button>
                <button class="btn secondary" data-action="keep" ${comparison.all_destinations_exist ? '' : 'disabled'}>Conservar y marcar como copiada</button>
                <button class="btn secondary" data-action="cancel">Cancelar</button>
            </div>
        </div>`;
        const finish = action => {
            document.removeEventListener('keydown', onKey);
            modal.remove();
            previousFocus?.focus();
            resolve(action === 'cancel' ? null : { action, fingerprint: comparison.fingerprint });
        };
        const onKey = event => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                finish('cancel');
            } else if (event.key === 'Tab') {
                const buttons = [...modal.querySelectorAll('button:not(:disabled)')];
                const first = buttons[0], last = buttons[buttons.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault(); last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault(); first.focus();
                }
            }
        };
        modal.querySelectorAll('[data-action]').forEach(button => {
            button.addEventListener('click', () => finish(button.dataset.action));
        });
        modal.addEventListener('click', event => {
            if (event.target === modal) finish('cancel');
        });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(modal);
        modal.querySelector('[data-action="cancel"]').focus({ preventScroll: true });
    });
}
