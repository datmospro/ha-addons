import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../app/static/js/settings.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
for (const success of [true,false]) {
    let settings={rss_feeds:[{name:'Feed',min_year:1990}]}, sent, closed=false;
    const values={'edit-rss-name':'Feed','edit-rss-label':'films','edit-rss-interval':'300','edit-rss-url':'https://example.test/rss','edit-rss-preferred-size':'5000','edit-rss-max-size':'12000','edit-rss-min-year':'2000'};
    const context=vm.createContext({structuredClone,window:{},document:{getElementById:id=>({value:values[id],checked:true})},MIN_RSS_REFRESH_INTERVAL:60,state:{getSettings:()=>settings,setSettings:s=>settings=s},apiSaveSettings:async s=>{sent=structuredClone(s);return {success};},showToast:()=>{},closeModal:()=>{closed=true;}});
    vm.runInContext(source,context);
    vm.runInContext('currentEditIndex=0; renderRSSFeedsList=()=>{};',context);
    await vm.runInContext('saveEditedRSS()',context);
    assert.equal(sent.rss_feeds[0].min_year,2000);
    assert.equal(settings.rss_feeds[0].min_year,success?2000:1990);
    assert.equal(closed,success);
}
console.log('RSS year edit: persisted on save, original state and form retained on failure.');
