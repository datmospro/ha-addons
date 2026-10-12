"""Exercise actual dashboard markup/modules with local, deterministic responses."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
import threading
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1] / 'app/static'
html = (root / 'index.html').read_text(encoding='utf-8')
dashboard = html[html.index('<div id="view-dashboard"'):html.index('<!-- Ficha de la película View -->')]
styles = '\n'.join(line for line in html.splitlines() if 'href="styles/' in line)
fixture = f'''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">{styles}
<body><div class="app-layout"><aside class="sidebar"><div class="logo"><h1>Roverr</h1></div><nav><button class="nav-item" aria-label="Panel"><i>▦</i> Panel</button></nav></aside><main class="main-content">{dashboard}</main></div>
<script type="module">
import {{initMovies,renderMovieCards}} from '/js/movies.js';
import {{state}} from '/js/state.js';
import {{initCopyQueue}} from '/js/copy-queue.js';
window.setMovies=data=>{{state.setMovies(data);renderMovieCards(data)}};
window.appState=state;
initMovies(); initCopyQueue();
fetch('/fixture-movies').then(r=>r.json()).then(window.setMovies);
</script></body></html>'''

def movie(hash, title, status, date, **extras):
    return dict(torrent_hash=hash, title=title, status=status, year='2026', size=4e9,
                state='uploading', progress=1, added_at=date, torrent_name=title+'.mkv',
                poster_url='/posters/placeholder_unidentified.png', **extras)

movies = [
    movie('a', 'Árbol del tiempo', 'moved', '2026-10-01', tmdb_id=1, rss_feed_name='HDO'),
    movie('b', 'Zeta', 'copying', '2026-10-05', tmdb_id=2, rss_feed_name='HDO'),
    movie('c', 'Otra versión de Zeta', 'pending', '2026-10-06', tmdb_id=2),
    movie('d', 'Película pendiente', 'queued', '2026-10-04', copy_progress={'queue_position':2}),
    movie('e', 'Sin descarga', 'new', '2026-10-03'),
    movie('f', 'Error de destino', 'error', '2026-10-02', rss_feed_name='<img src=x onerror=alert(1)>'),
]
movies[0]['year']='2025'
movies[4]['size']=9e9
queue = {'paused':False, 'entries':[
    {'torrent_hash':'b','title':'Zeta','state':'copying','active':True,'phase':'copying','percent':48.5,'speed':15,'eta_seconds':120},
    *[{'torrent_hash':f'q{i}','title':f'Película en espera {i}','state':'queued','active':False,'queue_position':i,'reorderable':True} for i in range(1,9)]
], 'recent':[]}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root),**kwargs)
    def do_GET(self):
        response = {'/preview.html':fixture, '/fixture-movies':movies, '/api/copy-queue':queue}.get(self.path)
        if response is None:return super().do_GET()
        self.send_response(200)
        self.send_header('Content-Type','text/html; charset=utf-8' if isinstance(response,str) else 'application/json')
        self.end_headers()
        self.wfile.write(response.encode() if isinstance(response,str) else json.dumps(response).encode())
    def log_message(self,*args):pass

server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
        page=browser.new_page(viewport={'width':1280,'height':900})
        page.set_default_timeout(8000)
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        url=f'http://127.0.0.1:{server.server_port}/preview.html'
        page.goto(url)
        page.wait_for_function("document.querySelectorAll('.movie-card').length===5")
        assert page.locator('#dashboard-results').inner_text()=='5 de 5 películas'
        assert page.locator('.movie-card').first.get_attribute('data-hash')=='b'
        assert page.locator('#copy-queue-entries .copy-queue-row:visible').count()==2
        assert page.locator('#copy-queue-panel').bounding_box()['height']<300, page.locator('#copy-queue-panel').bounding_box()
        page.locator('#copy-queue-expand').click()
        assert page.locator('#copy-queue-entries .copy-queue-row:visible').count()==9
        page.locator('#copy-queue-expand').click()
        query=page.locator('[data-filter=query]')
        query.fill('arbol 2025')
        assert page.locator('.movie-card').count()==1
        assert page.locator('.movie-card').get_attribute('data-hash')=='a'
        page.locator('#select-all-btn').click()
        query.fill('Zeta')
        assert '1 fuera del filtro' in page.locator('#selection-counter').inner_text()
        page.locator('#select-all-btn').click()
        assert page.evaluate('window.appState.getSelectedMovies().size')==2
        page.locator('#deselect-all-btn').click()
        page.reload()
        page.wait_for_function("document.querySelectorAll('.movie-card').length===1")
        assert query.input_value()=='Zeta'
        page.locator('#dashboard-reset').click()
        page.locator('[data-filter=sort]').select_option('title')
        assert page.locator('.movie-card').first.get_attribute('data-hash')=='a'
        page.locator('[data-filter=year]').select_option('2025')
        assert page.locator('.movie-card').count()==1
        page.locator('[data-filter=year]').select_option('')
        page.locator('[data-filter=sort]').select_option('size')
        assert page.locator('.movie-card').first.get_attribute('data-hash')=='e'
        page.locator('[data-filter=sort]').select_option('queue')
        assert [page.locator('.movie-card').nth(i).get_attribute('data-hash') for i in range(2)]==['b','d']
        page.locator('[data-filter=origin]').select_option('HDO')
        assert page.locator('.movie-card').count()==2
        page.locator('#dashboard-reset').click()
        page.locator('[data-status=copied]').click()
        assert page.locator('.movie-card').count()==1
        changed=[dict(m) for m in movies];changed[1]['status']='moved'
        page.evaluate('window.setMovies',changed)
        assert page.locator('.movie-card').count()==2
        page.locator('#dashboard-reset').click()
        query.fill('no existe')
        assert 'No hay películas con estos filtros' in page.locator('.dashboard-empty').inner_text()
        page.locator('#dashboard-reset').click()
        page.locator('[data-filter=compact]').check()
        assert 'compact-posters' in page.locator('#movies-grid').get_attribute('class')
        page.locator('#dashboard-reset').focus()
        page.keyboard.press('/')
        assert query.evaluate('e=>document.activeElement===e')
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
        page.locator('.main-content').evaluate('e=>e.scrollTop=0')
        page.screenshot(path=str(root.parents[3]/'dashboard-mobile.png'),full_page=True)
        page.set_viewport_size({'width':1280,'height':900})
        page.locator('.main-content').evaluate('e=>e.scrollTop=0')
        page.screenshot(path=str(root.parents[3]/'dashboard-desktop.png'),full_page=True)
        assert not errors,errors
        browser.close()
    print('Dashboard OK: grouping, search, sorting, counters/live status, origin, selection, persistence, compact queue and mobile.')
finally:
    server.shutdown();server.server_close()
