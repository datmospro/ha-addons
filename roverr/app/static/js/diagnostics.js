import { escapeHtml, formatBytes, setButtonLoading, showToast } from './ui.js';

let panel;
let busy=false;
let hasReport=false;

function details(check) {
    const info=check.details || {};
    const lines=[];
    for (const [key,label] of [['path','Ruta'],['source','Origen en Windows'],['destination','Destino en Windows'],['temporary_file','Archivo temporal de la prueba'],['version','Versión']]) {
        if (info[key] != null) lines.push(`${label}: <code>${escapeHtml(String(info[key]))}</code>`);
    }
    if (info.host) lines.push(`Servidor: ${escapeHtml(String(info.host))}${info.port ? ` · Puerto: ${Number(info.port)}` : ''}`);
    if (info.free_bytes != null) lines.push(`Libre: ${escapeHtml(formatBytes(info.free_bytes))} · Total: ${escapeHtml(formatBytes(info.total_bytes || 0))}`);
    if (info.largest_pending_bytes > 0) lines.push(`Descarga pendiente de mayor tamaño: ${escapeHtml(formatBytes(info.largest_pending_bytes))}`);
    if (info.rss_auto_copy_feeds != null) lines.push(`Fuentes RSS con copia automática: ${Number(info.rss_auto_copy_feeds)} · Búsquedas manuales: ${info.manual_search_auto_copy ? 'activada' : 'desactivada'}`);
    if (info.jobs) lines.push(`En cola: ${Number(info.jobs.queued || 0)} · En curso: ${Number(info.jobs.running || 0)} · Errores: ${Number(info.jobs.error || 0)}`);
    return lines.length ? `<p class="diagnostic-details">${lines.join('<br>')}</p>` : '';
}

export function renderDiagnostics(report) {
    panel ||= document.getElementById('diagnostics-panel');
    if (!panel) return;
    hasReport=true;
    const summary=report.summary || {};
    panel.querySelector('#diagnostics-summary').textContent=`Roverr ${report.addon_version} · ${Number(summary.ok || 0)} correctas · ${Number(summary.warning || 0)} ${summary.warning===1 ? 'aviso' : 'avisos'} · ${Number(summary.error || 0)} ${summary.error===1 ? 'problema' : 'problemas'}. Comprobado: ${new Date(report.generated_at).toLocaleString('es-ES')}.`;
    const labels={ok:'Correcto',warning:'Aviso',error:'Requiere atención',skipped:'Sin comprobar'};
    panel.querySelector('#diagnostics-checks').innerHTML=(report.checks || []).map(check=>{
        const status=Object.hasOwn(labels,check.status) ? check.status : 'error';
        return `<article class="diagnostic-check">
            <div class="diagnostic-check-header"><h4>${escapeHtml(check.title)}</h4><span class="diagnostic-status diagnostic-${status}">${labels[status]}</span></div>
            <p>${escapeHtml(check.message)}</p>
            ${check.action ? `<p><strong>Qué hacer:</strong> ${escapeHtml(check.action)}</p>` : ''}
            ${details(check)}
        </article>`;
    }).join('');
    panel.querySelector('#download-diagnostics-btn').disabled=busy;
}

async function run() {
    if (busy) return;
    busy=true;
    hasReport=false;
    panel.querySelector('#diagnostics-checks').innerHTML='';
    const button=panel.querySelector('#run-diagnostics-btn');
    panel.querySelector('#download-diagnostics-btn').disabled=true;
    setButtonLoading(button,true,'Comprobando...');
    panel.querySelector('#diagnostics-summary').textContent='Comprobando conexiones, rutas y permisos. Puede tardar unos segundos.';
    try {
        const response=await fetch('/api/diagnostics/run',{method:'POST',cache:'no-store'});
        if (!response.ok) throw new Error(`No se pudo ejecutar el diagnóstico (HTTP ${response.status}).`);
        const data=await response.json();
        if (!data.success) throw new Error(data.message || 'No se pudo completar el diagnóstico.');
        renderDiagnostics(data.report);
    } catch(error) {
        panel.querySelector('#diagnostics-summary').textContent=error.message;
        showToast(error.message,'error');
    } finally {
        busy=false;
        setButtonLoading(button,false);
        panel.querySelector('#download-diagnostics-btn').disabled=!hasReport;
    }
}

async function download() {
    if (busy || !hasReport) return;
    const button=panel.querySelector('#download-diagnostics-btn');
    button.disabled=true;
    try {
        const response=await fetch('/api/diagnostics/report',{cache:'no-store'});
        if (!response.ok) throw new Error('Ejecuta de nuevo el diagnóstico antes de descargar el informe.');
        const data=await response.json();
        const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
        const url=URL.createObjectURL(blob);
        const link=document.createElement('a');
        link.href=url;link.download='roverr-diagnostico.json';
        document.body.appendChild(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error) {showToast(error.message,'error');}
    finally {button.disabled=false;}
}

export function initDiagnostics() {
    panel=document.getElementById('diagnostics-panel');
    if (!panel) return;
    fetch('/api/version',{cache:'no-store'}).then(response=>response.ok ? response.json() : null).then(data=>{
        const version=document.getElementById('version-info');
        if (version && data?.version && data.version !== 'desconocida') version.textContent=`v${data.version}`;
    }).catch(()=>{});
    panel.querySelector('#run-diagnostics-btn').addEventListener('click',run);
    panel.querySelector('#download-diagnostics-btn').addEventListener('click',download);
}
