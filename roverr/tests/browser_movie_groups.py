from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
import threading
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]/'app/static'
def movies(first='moved',second='moved'):
    return [{'title':'Film '+hash,'year':'2026','torrent_hash':hash,'status':status,'state':'uploading','progress':1,'size':1}
            for hash,status in [('a',first),('b',second)]]
fixture='''<!doctype html><html><meta charset="utf-8"><body>
<div id="movie-details-content"></div><div id="movies-grid"></div><div id="selection-counter"></div>
<button id="select-all-btn"></button><button id="deselect-all-btn"></button>
<button id="stop-selected-btn">Detener seleccionadas</button><button id="copy-selected-btn"></button><button id="delete-selected-btn"></button>
<script type="module">
window.WebSocket=class {constructor(){window.testSocket=this;setTimeout(()=>this.onopen?.(),0)} close(){} };
import {initMovies,showMovieDetails} from '/js/movies.js';
import {state} from '/js/state.js';
window.showMovieDetails=showMovieDetails; window.appState=state;
import {connectWebSocket} from '/js/websocket.js';
initMovies(); connectWebSocket();
window.emit=data=>window.testSocket.onmessage({data:JSON.stringify(data)});
</script></html>'''
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(root),**kwargs)
    def do_GET(self):
        if self.path.startswith('/api/movie/'):
            data=movies('pending','copying')[0]; data.update(tmdb_id=42,cast=[],crew=[],genres=[],torrent_name='Versión A',copy_paused=False)
            self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(json.dumps(data).encode()); return
        if self.path=='/preview.html' or self.path.startswith('/api/movies'):
            self.send_response(200); self.send_header('Content-Type','text/html' if self.path=='/preview.html' else 'application/json'); self.end_headers()
            self.wfile.write(fixture.encode() if self.path=='/preview.html' else json.dumps({'movies':movies(),'ignored_series':[]}).encode())
        else: super().do_GET()
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
        page=browser.new_page(); errors=[]
        page.set_default_timeout(8000)
        page.on('console',lambda msg:print(msg.text,flush=True) if msg.type=='error' else None)
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}/preview.html')
        page.wait_for_function('!!window.emit')
        versions=movies('pending','copying')
        for movie in versions: movie.update(tmdb_id=42,title='La misma película',torrent_name='Versión '+movie['torrent_hash'])
        page.evaluate('data=>window.emit(data)',{'type':'initial','movies':versions,'ignored_series':[]})
        page.wait_for_function("document.querySelectorAll('.movie-card').length===1 && document.querySelector('.movie-card').dataset.hash==='b'")
        assert '2 versiones' in page.locator('.movie-meta').inner_text()
        page.locator('.movie-card-checkbox').click()
        assert page.evaluate("window.appState.getSelectedMovies().get('b').version_hashes.length")==2
        versions[0]['status']='copying'; versions[1]['status']='moved'
        page.evaluate('data=>window.emit(data)',{'type':'movies','movies':versions,'ignored_series':[]})
        page.wait_for_function("document.querySelector('.movie-card').dataset.hash==='a'")
        assert page.locator('.movie-card-checkbox').is_checked()
        assert page.evaluate("[...window.appState.getSelectedMovies().keys()]")==['a']
        page.evaluate("""window.originalFetch=window.fetch; window.fetch=async (url,options)=>{
          if(String(url).includes('/batch-stop')){window.stoppedHashes=JSON.parse(options.body).torrent_hashes;return {ok:true,json:async()=>({success:true,stopped:2})};}
          return window.originalFetch(url,options);
        };""")
        page.once('dialog',lambda dialog:dialog.accept())
        page.get_by_role('button',name='Detener seleccionadas').click()
        page.wait_for_function('window.stoppedHashes?.length===2')
        assert sorted(page.evaluate('window.stoppedHashes'))==['a','b']
        page.evaluate('data=>window.emit(data)',{'type':'movies','movies':versions,'ignored_series':[]})
        page.evaluate("window.showMovieDetails('a')")
        page.get_by_text('Versiones y descargas (2)',exact=True).wait_for()
        assert page.locator('.movie-version-btn').count()==2
        assert page.locator('.movie-version-btn[data-hash=a]').is_disabled()
        page.locator('.movie-version-btn[data-hash=b]').click()
        page.wait_for_function("document.querySelector('#movie-details-content').dataset.hash==='b'")
        assert not errors, errors
        browser.close()
    print('UI OK: one card per movie, versions selector, status switch and preserved selection.')
finally:
    server.shutdown(); server.server_close()
