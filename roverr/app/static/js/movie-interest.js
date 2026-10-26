import { escapeHtml } from './ui.js';

const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const count = value => new Intl.NumberFormat('es-ES', {maximumFractionDigits: 1}).format(value);
const money = value => new Intl.NumberFormat('es-ES', {style:'currency', currency:'USD', notation:'compact', maximumFractionDigits:1}).format(value);

export function interestSignals(data) {
    const popularity=number(data.popularity), votes=number(data.votes), budget=number(data.budget), revenue=number(data.revenue);
    return [
        {icon:'fire', label:'Interés actual', value:popularity === null ? 'Sin datos' : popularity >= 50 ? 'Muy popular' : popularity >= 10 ? 'Interés moderado' : 'Interés discreto',
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

export function renderInterest(data) {
    if (!['ok','cached'].includes(data.status)) return '<p class="movie-interest-note">Información no disponible por ahora.</p>';
    return `<div class="movie-interest-grid">${interestSignals(data).map(signal=>`<div class="movie-interest-card" tabindex="0" title="${escapeHtml(signal.help)}"><span class="movie-interest-label"><i class="fas fa-${signal.icon}" aria-hidden="true"></i> ${signal.label}</span><strong>${escapeHtml(signal.value)}</strong><small>${escapeHtml(signal.detail)}</small></div>`).join('')}</div>
    <p class="movie-interest-note">${data.status==='cached'?'Últimos datos disponibles · ':''}Fuente: TMDB · Indicadores orientativos; no son una nota de calidad ni una medida de expectación previa al estreno.</p>
    <details class="movie-interest-help"><summary>¿Cómo se interpreta?</summary>${interestSignals(data).map(signal=>`<p><b>${signal.label}:</b> ${escapeHtml(signal.help)}</p>`).join('')}</details>`;
}
