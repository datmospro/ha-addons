import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../app/static/js/movies.js',import.meta.url),'utf8');
const start=source.indexOf('function setupMovieDetailsListeners('), end=source.indexOf('// Polling para detalles',start);
for(const changed of [false,true]) {
    const value={textContent:''},votes={textContent:''};
    const badge={isConnected:true,querySelector:s=>s==='.rating-value'?value:votes};
    const container={getAttribute:()=>changed?'other':'hash',querySelector:s=>s==='.rating-badge.imdb'?badge:null,querySelectorAll:()=>[]};
    const context=vm.createContext({document:{getElementById:()=>container},Intl,getMovieRatings:async()=>({imdb_id:'tt123',rating:'7.5',votes:'1000',status:'ok'})});
    vm.runInContext(source.slice(start,end),context);
    vm.runInContext("setupMovieDetailsListeners('hash',{imdb_id:'tt123'})",context);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(value.textContent,changed?'':'7.5');
    if(!changed) assert.match(votes.textContent,/votos/);
}
console.log('IMDb detail: asynchronous update and navigation race checks passed');
