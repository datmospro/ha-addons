import { getMovieInterest } from './api.js';

import { HIGH_INTEREST_MIN } from './movie-interest.js';
const cache = new Map();
const pending = new Map();
const queue = [];
let active = 0;

export function applyInterestFrame(card, data) {
    const high = ['ok', 'cached'].includes(data?.status) && typeof data.popularity === 'number' && Number.isFinite(data.popularity) && data.popularity >= HIGH_INTEREST_MIN;
    card.classList.toggle('movie-high-interest', high);
    let indicator = card.querySelector('.movie-interest-indicator');
    if (!high) { indicator?.remove(); return; }
    if (!indicator) {
        indicator = document.createElement('span');
        indicator.className = 'movie-interest-indicator';
        indicator.innerHTML = '<i class="fas fa-fire" aria-hidden="true"></i><span class="sr-only">Interés alto</span>';
        indicator.tabIndex = 0;
        card.appendChild(indicator);
    }
    indicator.title = `Interés alto · Popularidad TMDB: ${new Intl.NumberFormat('es-ES', {maximumFractionDigits:1}).format(data.popularity)} (desde ${HIGH_INTEREST_MIN})${data.status==='cached'?' · Último dato disponible':''}`;
    indicator.setAttribute('aria-label', indicator.title);
}

function pump() {
    while (active < 3 && queue.length) {
        const job = queue.shift();
        active++;
        Promise.resolve().then(() => job.card.isConnected ? getMovieInterest(job.hash) : {status:'cancelled'}).then(data => {
            if (data.status !== 'cancelled') {
                if (cache.size >= 512 && !cache.has(job.id)) cache.delete(cache.keys().next().value);
                cache.set(job.id, {data, until:Date.now() + (['ok','cached'].includes(data.status) ? 21600000 : 60000)});
            }
            job.resolve(data);
        }, () => job.resolve({status:'unavailable'})).finally(() => { pending.delete(job.id); active--; pump(); });
    }
}

export function updateDashboardInterest(card, movie) {
    const id = String(movie.tmdb_id || '');
    card.dataset.interestTmdb = id;
    if (!id) { applyInterestFrame(card, null); return; }
    const cached = cache.get(id);
    if (cached && Date.now() < cached.until) { applyInterestFrame(card, cached.data); return; }
    if (card.dataset.interestPending === id) return;
    // A recycled card must not retain another movie's gold frame.
    applyInterestFrame(card, null);
    card.dataset.interestPending = id;
    if (!pending.has(id)) {
        const promise = new Promise(resolve => queue.push({id,hash:movie.torrent_hash,card,resolve}));
        pending.set(id, promise);
        Promise.resolve().then(pump);
    }
    const hash = movie.torrent_hash;
    pending.get(id).then(data => {
        if (card.isConnected && card.dataset.hash === hash && card.dataset.interestTmdb === id) applyInterestFrame(card, data);
    }).finally(() => { if(card.dataset.interestPending === id) delete card.dataset.interestPending; });
}
