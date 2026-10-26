import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../app/static/js/dashboard-interest.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
const waiting=[];let running=0,maxRunning=0,calls=0;
const context=vm.createContext({HIGH_INTEREST_MIN:50,Intl,Date,Map,Promise,document:{createElement:()=>({setAttribute(){},remove(){this.parent.indicator=null;}})},getMovieInterest:hash=>new Promise(resolve=>{calls++;running++;maxRunning=Math.max(maxRunning,running);waiting.push(()=>{running--;resolve({status:'ok',popularity:80});});})});
vm.runInContext(source,context);
function card(hash) { const classes=new Set();return {isConnected:true,dataset:{hash},classes,classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)},querySelector(){return this.indicator;},appendChild(el){this.indicator=el;el.parent=this;}}; }
const first=card('first');context.applyInterestFrame(first,{status:'ok',popularity:50});assert(first.classes.has('movie-high-interest'));
context.applyInterestFrame(first,{status:'ok',popularity:49.9});assert(!first.classes.has('movie-high-interest'));assert.equal(first.indicator,null);
for(const popularity of [null,'80',NaN,Infinity]) {context.applyInterestFrame(first,{status:'ok',popularity});assert(!first.classes.has('movie-high-interest'));}
const cards=Array.from({length:10},(_,i)=>card(String(i)));
cards.forEach((c,i)=>context.updateDashboardInterest(c,{tmdb_id:i+1,torrent_hash:String(i)}));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
await tick();assert.equal(calls,3);
// A reused DOM card cannot receive the answer to its previous movie.
cards[0].dataset.hash='changed';
while(waiting.length){waiting.splice(0).forEach(f=>f());await tick();}
assert.equal(maxRunning,3);assert.equal(calls,10);assert(!cards[0].classes.has('movie-high-interest'));assert(cards[1].classes.has('movie-high-interest'));
cards.slice(1).forEach((c,i)=>context.updateDashboardInterest(c,{tmdb_id:i+2,torrent_hash:String(i+1)}));await tick();assert.equal(calls,10);
console.log('Dashboard gold frame: threshold, removal, missing data, cache, concurrency and recycled cards passed');
