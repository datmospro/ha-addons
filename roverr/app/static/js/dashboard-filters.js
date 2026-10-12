import { getMovieStatus } from './templates.js';
import { escapeHtml } from './ui.js';

export const filterDefaults = {query:'', status:'all', year:'', origin:'', sort:'recent', compact:false};
const storageKey = 'roverr.dashboard.v1';
let filters = {...filterDefaults};
try { filters = {...filters, ...JSON.parse(localStorage.getItem(storageKey) || '{}')}; } catch {}
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
export function statusGroup(movie) {
    const status = getMovieStatus(movie).status;
    if (['copying','recovering','verifying','validating_resume','paused'].includes(status)) return 'copying';
    if (['moved','moved_manually'].includes(status)) return 'copied';
    if (['blocked','conflict','error','receptor_offline','missing','orphaned'].includes(status)) return 'attention';
    if (['new','skipped'].includes(status)) return 'new';
    if (status === 'stopped') return 'stopped';
    return status;
}
const versions = movie => movie.versions || [movie];
const added = movie => Math.max(0,...versions(movie).map(version => Date.parse(version.added_at) || 0));
export function filterMovies(movies, options = filters) {
    const words = normalize(options.query).trim().split(/\s+/).filter(Boolean);
    const result = movies.filter(movie => {
        const haystack = normalize(versions(movie).map(v => `${v.title || ''} ${v.year || ''} ${v.torrent_name || ''}`).join(' '));
        return words.every(word => haystack.includes(word))
            && (options.status === 'all' || statusGroup(movie) === options.status)
            && (!options.year || String(movie.year) === options.year)
            && (!options.origin || versions(movie).some(v => (v.rss_feed_name || 'manual') === options.origin));
    });
    const title = (a,b) => String(a.title || '').localeCompare(String(b.title || ''),'es',{numeric:true,sensitivity:'base'});
    const queueRank = movie => statusGroup(movie) === 'copying' ? 0 : movie.status === 'queued' ? Number(movie.copy_progress?.queue_position || 9999) : 100000;
    const sorters = {
        recent:(a,b) => added(b)-added(a) || title(a,b),
        title, year:(a,b) => Number(b.year || 0)-Number(a.year || 0) || title(a,b),
        size:(a,b) => Number(b.size || 0)-Number(a.size || 0) || title(a,b),
        queue:(a,b) => queueRank(a)-queueRank(b) || title(a,b)
    };
    return result.sort(sorters[options.sort] || sorters.recent);
}
const labels = {all:'Todas',downloading:'Descargando',copying:'Copiando',queued:'En cola',pending:'Pendientes',new:'Por descargar',attention:'Revisar',stopped:'Detenidas',copied:'Copiadas'};
function save() { try { localStorage.setItem(storageKey,JSON.stringify(filters)); } catch {} }
export function initDashboardFilters(render) {
    const bar = document.getElementById('dashboard-filters');
    if (!bar) return;
    for (const name of ['query','status','year','origin','sort']) {
        const input = bar.querySelector(`[data-filter="${name}"]`);
        input.value = filters[name];
        input.addEventListener(name === 'query' ? 'input' : 'change',() => {
            filters[name] = input.value; save(); render();
        });
    }
    const compact = bar.querySelector('[data-filter="compact"]');
    compact.checked = Boolean(filters.compact);
    compact.addEventListener('change',() => {filters.compact=compact.checked;save();render();});
    bar.querySelector('#dashboard-reset').addEventListener('click',() => {
        filters={...filterDefaults,compact:filters.compact};save();
        bar.querySelectorAll('[data-filter]').forEach(input => {if(input.type!=='checkbox') input.value=filters[input.dataset.filter];});
        render();
    });
    document.getElementById('dashboard-counts').addEventListener('click',event => {
        const button=event.target.closest('[data-status]');
        if (!button) return;
        filters.status=button.dataset.status;bar.querySelector('[data-filter="status"]').value=filters.status;save();render();
    });
    document.addEventListener('keydown',event => {
        if (event.key==='/' && !event.ctrlKey && !event.metaKey && !event.altKey
            && !event.target.closest('input,textarea,select,[contenteditable]')
            && document.getElementById('view-dashboard')?.classList.contains('active')
            && !document.querySelector('.modal.active')) {
            event.preventDefault();bar.querySelector('[data-filter="query"]').focus();
        }
    });
}
export function updateDashboardFilters(movies) {
    const bar=document.getElementById('dashboard-filters');
    if (!bar) return movies;
    for (const [name,values,label] of [
        ['year',[...new Set(movies.map(m=>String(m.year || '')).filter(Boolean))].sort((a,b)=>Number(b)-Number(a)),'Todos los años'],
        ['origin',[...new Set(movies.flatMap(m=>versions(m).map(v=>v.rss_feed_name || 'manual')))].sort(),'Todos los orígenes']
    ]) {
        const input=bar.querySelector(`[data-filter="${name}"]`);
        if(filters[name] && !values.includes(filters[name])) values.push(filters[name]);
        const html=`<option value="">${label}</option>`+values.map(value=>`<option value="${escapeHtml(value)}">${escapeHtml(value==='manual'?'Manual / sin RSS':value)}</option>`).join('');
        if(input.innerHTML!==html) {input.innerHTML=html;input.value=filters[name];}
    }
    const counts={all:movies.length};
    movies.forEach(movie=>{const key=statusGroup(movie);counts[key]=(counts[key] || 0)+1;});
    document.getElementById('dashboard-counts').innerHTML=Object.entries(labels).filter(([key])=>key==='all' || counts[key]).map(([key,label])=>`<button type="button" data-status="${key}" aria-pressed="${filters.status===key}">${label} <strong>${counts[key] || 0}</strong></button>`).join('');
    document.getElementById('movies-grid').classList.toggle('compact-posters',Boolean(filters.compact));
    const visible=filterMovies(movies);
    document.getElementById('dashboard-results').textContent=`${visible.length} de ${movies.length} películas`;
    return visible;
}
