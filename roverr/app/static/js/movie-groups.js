// Logical movie identity; torrents keep their own hashes, jobs and history.
const normalize = title => String(title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const titleKey = movie => movie.year && normalize(movie.title) ? `${normalize(movie.title)}:${movie.year}` : null;
const rank = movie => ({copying:0, queued:1, moved:2, moved_manually:2, downloading:3, pending:4, error:5, receptor_offline:5, missing:5, new:6, orphaned:7}[movie.status] ?? 8);
export function groupMovies(movies) {
    const known = new Map();
    for (const movie of movies) {
        const key = titleKey(movie);
        if (key && movie.tmdb_id) {
            if (!known.has(key)) known.set(key, new Set());
            known.get(key).add(String(movie.tmdb_id));
        }
    }
    const groups = new Map();
    for (const movie of movies) {
        const title = titleKey(movie);
        const candidates = known.get(title);
        const id = movie.tmdb_id || (candidates?.size === 1 ? [...candidates][0] : null);
        // Different identified movies and ambiguous unidentified titles stay apart.
        const key = id ? `tmdb:${id}` : (title && !candidates?.size ? `title:${title}` : `torrent:${movie.torrent_hash}`);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(movie);
    }
    return [...groups.entries()].map(([movie_id, versions]) => {
        const ordered = [...versions].sort((a,b) => rank(a)-rank(b) || (b.progress || 0)-(a.progress || 0) || String(a.torrent_hash).localeCompare(String(b.torrent_hash)));
        return {...ordered[0], movie_id, versions: ordered};
    });
}
export function getMovieVersions(movies, hash) {
    return groupMovies(movies).find(movie => movie.versions.some(version => version.torrent_hash === hash))?.versions || [];
}
