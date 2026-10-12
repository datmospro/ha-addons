import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../app/static/js/templates.js',import.meta.url),'utf8').replace(/^import .* from '.\/ui.js';$/m,'').replace("'./messages.js'", JSON.stringify(new URL('../app/static/js/messages.js',import.meta.url).href));
const {getMovieStatus}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
assert.equal(getMovieStatus({status:'pending',copy_paused:true,copy_pause_reason:'manual'}).label,'Detenida');
assert.equal(getMovieStatus({status:'pending',copy_paused:true,copy_pause_reason:'manual'}).action,'Reanudar copia');
assert.equal(getMovieStatus({status:'error',copy_paused:true,copy_pause_reason:'conflict'}).action,'Revisar destino');
assert.equal(getMovieStatus({status:'copying',copy_paused:true}).label,'Copiando');
assert.equal(getMovieStatus({status:'moved',copy_paused:true}).label,'Copiada');
assert.equal(getMovieStatus({status:'moved_manually',copy_paused:true}).label,'Copiada');
assert.equal(getMovieStatus({status:'copying',copy_progress:{recovering:true}}).label,'Recuperando copia');
assert.match(getMovieStatus({status:'queued',copy_progress:{queue_position:2,queue_total:4,active_copy:'Otra peli'}}).reason,/Posición 2 de 4/);
assert.equal(getMovieStatus({status:'error',status_reason:'Permiso denegado'}).reason,'Permiso denegado');
assert.equal(getMovieStatus({status:'downloading',copy_paused:true}).label,'Descargando');
assert.match(getMovieStatus({status:'receptor_offline'}).reason,/puerto/);
console.log('Status presentation: 11 checks passed');

const sizeReason = 'No torrent within size limits (max: 12000 MB)';
for (const pauseReason of [null, 'manual', 'conflict']) {
    const rss = getMovieStatus({status:'new',state:'rss',progress:0,copy_paused:true,copy_pause_reason:pauseReason,status_reason:sizeReason});
    assert.equal(rss.label,'Por descargar');
    assert.equal(rss.reason,'No se encontró ningún torrent dentro del tamaño máximo de 12000 MB');
    assert.notEqual(rss.action,'Reanudar copia');
}
assert.equal(getMovieStatus({status:'pending',progress:0.5,copy_paused:true,copy_pause_reason:'manual'}).status,'pending');
assert.equal(getMovieStatus({status:'pending',progress:1,copy_paused:true,copy_pause_reason:null}).status,'pending');
assert.equal(getMovieStatus({status:'pending',download_stats:{progress:100},copy_paused:true,copy_pause_reason:'manual'}).status,'stopped');
console.log('Undownloaded RSS and size rejection: regression checks passed');
