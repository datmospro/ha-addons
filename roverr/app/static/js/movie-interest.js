import { escapeHtml } from './ui.js';

export const HIGH_INTEREST_MIN = 50;

const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const count = value => new Intl.NumberFormat('es-ES', {maximumFractionDigits: 1}).format(value);
const money = value => new Intl.NumberFormat('es-ES', {style:'currency', currency:'USD', notation:'compact', maximumFractionDigits:1}).format(value);

export function interestSignals(data) {
    const popularity=number(data.popularity), votes=number(data.votes), budget=number(data.budget), revenue=number(data.revenue);
    return [
        {icon:'fire', label:'Interés actual', value:popularity === null ? 'Sin datos' : popularity >= HIGH_INTEREST_MIN ? 'Muy popular' : popularity >= 10 ? 'Interés moderado' : 'Interés discreto',
         detail:popularity === null ? 'Popularidad no disponible' : `Índice TMDB: ${count(popularity)}`,
         help:'Orientativo de Roverr: discreto < 10, moderado entre 10 y 50, muy popular desde 50. TMDB combina visitas, favoritos, seguimiento y votos. No mide la expectación antes del estreno.'},
        {icon:'users', label:'Alcance del público', value:votes === null ? 'Sin datos' : votes >= 10000 ? 'Muy conocida' : votes >= 1000 ? 'Conocida' : votes > 0 ? 'Pocos votos' : 'Aún sin votos',
         detail:votes === null ? 'Recuento no disponible' : `${count(votes)} votos en TMDB`,
         help:'Orientativo de Roverr: conocida desde 1.000 votos y muy conocida desde 10.000. Los estrenos recientes pueden tener pocos votos. No representa espectadores ni calidad.'},
        {icon:'coins', label:'Presupuesto', value:budget ? money(budget) : 'No publicado',
         detail:revenue ? `Taquilla: ${money(revenue)}` : 'Importes declarados en dólares',
         help:'Presupuesto y recaudación publicados en TMDB, sin ajustar por inflación. Cero significa que no hay dato; no indica una producción barata.'}
    ];
}

export function renderRatings(movie) {
    const score = value => Number.isFinite(Number(value)) && Number(value)>0 && Number(value)<=10 ? Number(value).toFixed(1) : '—';
    const votes = value => Number.isFinite(Number(value)) && Number(value)>0 ? `${count(Number(value))} votos` : 'Sin votos publicados';
    const badge = (type, id, value, total) => {
        const valid = type==='tmdb' ? /^[1-9]\d*$/.test(String(id)) : /^tt\d+$/.test(String(id));
        const url = type==='tmdb' ? `https://www.themoviedb.org/movie/${id}` : `https://www.imdb.com/title/${id}/`;
        const tag=valid?'a':'div';
        return `<${tag} class="rating-badge ${type}${valid?' clickable':''}" ${valid?`href="${url}" target="_blank" rel="noopener noreferrer" title="Ver en ${type==='tmdb'?'TMDB':'IMDb'}"`:''}><span class="rating-source">${type==='tmdb'?'TMDB':'IMDb'}</span><strong class="rating-value">${score(value)}</strong><small class="rating-count">${votes(total)}</small></${tag}>`;
    };
    return `<div class="movie-interest-ratings">${badge('tmdb',movie.tmdb_id,movie.vote_average,movie.vote_count)}${movie.imdb_id?badge('imdb',movie.imdb_id,movie.imdb_rating,movie.imdb_votes):''}</div>`;
}

export function renderInterest(data, ratings = '') {
    const available=['ok','cached'].includes(data.status);
    const note = data.status==='loading' ? 'Consultando datos de TMDB…' : available
        ? `${data.status==='cached'?'Últimos datos disponibles · ':''}Fuente: TMDB · Indicadores orientativos; no son una nota de calidad ni una medida de expectación previa al estreno.`
        : 'Información de interés no disponible por ahora. Las valoraciones se muestran por separado.';
    return `<div class="movie-interest-grid">${interestSignals(data).map((signal,index)=>`<div class="movie-interest-card${index===1?' movie-interest-audience':''}"><span class="movie-interest-label" tabindex="0" title="${escapeHtml(signal.help)}"><i class="fas fa-${signal.icon}" aria-hidden="true"></i> ${signal.label}</span><strong>${escapeHtml(signal.value)}</strong>${index===1?`<div class="movie-interest-ratings-slot">${ratings}</div>`:`<small>${escapeHtml(signal.detail)}</small>`}</div>`).join('')}</div>
    <p class="movie-interest-note">${note}</p>
    <details class="movie-interest-help"><summary>¿Cómo se interpreta?</summary>${interestSignals(data).map(signal=>`<p><b>${signal.label}:</b> ${escapeHtml(signal.help)}</p>`).join('')}</details>`;
}
