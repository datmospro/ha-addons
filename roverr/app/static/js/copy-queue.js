import { escapeHtml, showToast } from './ui.js';
import { getMovieStatus } from './templates.js';
import { showMovieDetails, fetchMovies } from './movies.js';
import { translateMessage } from './messages.js';

let busy = false;
let current = null;
let panel;
let refreshTimer;
let readGeneration = 0;

function duration(seconds) {
    if (seconds == null) return 'Calculando tiempo restante';
    if (seconds < 60) return `${seconds} s restantes`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)} min restantes`;
    return `${Math.floor(seconds / 3600)} h ${Math.ceil(seconds % 3600 / 60)} min restantes`;
}

export function renderCopyQueue(data) {
    current = data;
    if (!panel) panel = document.getElementById('copy-queue-panel');
    if (!panel) return;
    const toggle = panel.querySelector('#copy-queue-toggle');
    toggle.textContent = data.paused ? 'Reanudar cola' : 'Pausar cola';
    toggle.disabled = busy;
    const active = data.entries.find(entry => entry.active);
    panel.querySelector('#copy-queue-state').textContent = data.paused
        ? (active && active.phase !== 'paused' ? 'Cola pausada; esperando a que la copia activa confirme la pausa.' : 'Cola pausada. Los archivos parciales se conservan.')
        : (data.entries.length ? 'La cola está activa. Se procesa una película a la vez.' : 'No hay copias en curso ni pendientes.');
    panel.querySelector('#copy-queue-entries').innerHTML = data.entries.map(entry => {
        const info = getMovieStatus({ status:entry.state, copy_progress:entry });
        const label = entry.stop_requested ? 'Deteniendo y limpiando' : entry.active ? info.label : `En cola · posición ${entry.queue_position}`;
        const progress = Math.min(100,Math.max(0,Number(entry.percent) || 0));
        const timing = entry.phase === 'verifying' ? 'Verificando el contenido completo' : entry.phase === 'paused' ? 'Tiempo restante al reanudar' : duration(entry.eta_seconds);
        return `<div class="copy-queue-row" data-hash="${escapeHtml(entry.torrent_hash)}">
            <div class="copy-queue-info">
                <button class="copy-queue-title" data-action="details">${escapeHtml(entry.title)}</button>
                <div class="copy-queue-stats">${escapeHtml(label)}${entry.active ? ` · ${progress.toFixed(1)}% · ${Number(entry.speed || 0).toFixed(2)} MB/s · ${escapeHtml(timing)}` : data.paused ? ' · esperando reanudación' : ''}</div>
                ${entry.active ? `<div class="copy-queue-track"><span style="width:${progress}%"></span></div>` : ''}
            </div>
            <div class="copy-queue-actions">
                ${entry.reorderable ? `<button class="btn secondary sm" data-action="up" aria-label="Subir ${escapeHtml(entry.title)}">Subir</button><button class="btn secondary sm" data-action="down" aria-label="Bajar ${escapeHtml(entry.title)}">Bajar</button><button class="btn secondary sm" data-action="first">Poner primero</button>` : ''}
                <button class="btn danger sm" data-action="stop" ${entry.stop_requested ? 'disabled' : ''}>Detener</button>
            </div>
        </div>`;
    }).join('');
    panel.querySelector('#copy-queue-recent').innerHTML = (data.recent || []).map(result => `<div class="copy-queue-recent-row">${escapeHtml(result.title)} · ${escapeHtml({completed:'Copiada',cancelled:'Detenida',error:'Requiere intervención'}[result.state] || result.state)}${result.message ? ` · ${escapeHtml(translateMessage(result.message))}` : ''}</div>`).join('') || '<p>No hay resultados recientes.</p>';
    if (busy) panel.querySelectorAll('button').forEach(button => {button.disabled=true;});
}

async function readQueue() {
    const generation = ++readGeneration;
    try {
        const response = await fetch('/api/copy-queue',{cache:'no-store'});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!busy && generation === readGeneration) renderCopyQueue(data);
    } catch (error) {
        if (panel && generation === readGeneration) panel.querySelector('#copy-queue-state').textContent='No se pudo consultar la cola. Se reintentará automáticamente.';
    }
}

async function mutate(path, payload) {
    if (busy) return;
    readGeneration++;
    busy = true;
    if (current) renderCopyQueue(current);
    try {
        const response = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'No se pudo modificar la cola');
        if (data.queue) current = data.queue;
        await fetchMovies(true);
    } catch (error) { showToast(error.message,'error'); }
    finally { busy=false; await readQueue(); }
}

export function initCopyQueue() {
    panel=document.getElementById('copy-queue-panel');
    if (!panel) return;
    panel.querySelector('#copy-queue-toggle').disabled=true;
    panel.querySelector('#copy-queue-toggle').addEventListener('click',()=>mutate('/api/copy-queue/pause',{paused:!current?.paused}));
    panel.querySelector('#copy-queue-entries').addEventListener('click',event=>{
        const button=event.target.closest('button[data-action]');
        if (!button || busy) return;
        const hash=button.closest('[data-hash]').dataset.hash;
        const action=button.dataset.action;
        if (action==='details') {showMovieDetails(hash);return;}
        if (action==='stop') {
            if (confirm('¿Detener esta copia y eliminar sus archivos incompletos? Para conservarlos, utiliza Pausar cola.')) mutate(`/api/stop/${encodeURIComponent(hash)}`,{});
        } else mutate('/api/copy-queue/priority',{torrent_hash:hash,direction:action});
    });
    async function poll() {await readQueue();refreshTimer=setTimeout(poll,2000);}
    poll();
    window.addEventListener('beforeunload',()=>clearTimeout(refreshTimer));
}
