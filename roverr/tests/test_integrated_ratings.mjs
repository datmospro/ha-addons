import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {renderRatings,renderInterest} from '../app/static/js/movie-interest.js';
globalThis.document={createElement:()=>({set textContent(v){this.innerHTML=String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');}})};
const ratings=renderRatings({tmdb_id:123,imdb_id:'tt123',vote_average:6,imdb_rating:'5.7',vote_count:117,imdb_votes:5562});
const html=renderInterest({status:'ok',votes:117},ratings);
assert.match(html,/movie-interest-ratings-slot/);assert.match(html,/6\.0/);assert.match(html,/5\.7/);assert.match(html,/https:\/\/www.imdb.com\/title\/tt123\//);assert(!html.includes('ratings-section'));
assert.match(renderInterest({status:'unavailable'},ratings),/5\.7/);
assert(!renderRatings({tmdb_id:'" onclick="evil',imdb_id:'bad'}).includes('onclick='));
const source=fs.readFileSync(new URL('../app/static/js/movies.js',import.meta.url),'utf8');
const start=source.indexOf('function setupMovieDetailsListeners('),end=source.indexOf('// Polling para detalles',start);
for(const imdbFirst of [true,false]) {
    let doneImdb,doneInterest,attached;
    const value={textContent:''},votes={textContent:''};
    const badge={isConnected:true,querySelector:s=>s==='.rating-value'?value:votes};
    const tmdbValue={textContent:""},tmdbVotes={textContent:""};
    const originalRatings={querySelector:()=>({querySelector:s=>s===".rating-value"?tmdbValue:tmdbVotes})};
    const interest={isConnected:true,querySelector:s=>s==='.movie-interest-ratings'?originalRatings:{appendChild:node=>{attached=node;}}};
    const container={getAttribute:()=> 'hash',querySelector:s=>s==='.rating-badge.imdb'?badge:s==='.movie-interest-content'?interest:null,querySelectorAll:()=>[]};
    const context=vm.createContext({document:{getElementById:()=>container},Intl,renderInterest:()=>'<grid>',getMovieInterest:()=>new Promise(r=>{doneInterest=r;}),getMovieRatings:()=>new Promise(r=>{doneImdb=r;})});
    vm.runInContext(source.slice(start,end),context);vm.runInContext("setupMovieDetailsListeners('hash',{tmdb_id:123,imdb_id:'tt123'})",context);
    const rate=()=>doneImdb({imdb_id:'tt123',rating:'5.7',votes:'5562',status:'ok'}), signal=()=>doneInterest({tmdb_id:123,status:'ok',vote_average:6.2,votes:27});
    if(imdbFirst){rate();await Promise.resolve();signal();}else{signal();await Promise.resolve();rate();}
    await new Promise(r=>setImmediate(r));
    assert.equal(tmdbValue.textContent,'6.2');assert.equal(tmdbVotes.textContent,'27 votos');assert.equal(attached,originalRatings);assert.equal(value.textContent,'5.7');
}
console.log('Integrated ratings: compact layout, links, failure fallback and both response orders passed');
