from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
import threading
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]/'app/static'
queue={'paused':False,'entries':[
 {'torrent_hash':'a','title':'Película activa','torrent_name':'Activa.mkv','state':'copying','active':True,'phase':'copying','percent':48.5,'speed':15,'eta_seconds':120,'reorderable':False,'stop_requested':False},
 {'torrent_hash':'b','title':'Película segunda','torrent_name':'Segunda.mkv','state':'queued','active':False,'queue_position':1,'percent':0,'speed':0,'reorderable':True,'stop_requested':False},
 {'torrent_hash':'c','title':'Película tercera','torrent_name':'Tercera.mkv','state':'queued','active':False,'queue_position':2,'percent':0,'speed':0,'reorderable':True,'stop_requested':False}],
 'recent':[{'title':'Película anterior','state':'completed','message':None}]}
mutations=[]
fixture='''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/styles/base.css"><link rel="stylesheet" href="/styles/components.css"><link rel="stylesheet" href="/styles/copy-queue.css">
<body><section id="copy-queue-panel"><div class="copy-queue-header"><h3>Actividad y cola de copias</h3><button id="copy-queue-toggle" class="btn secondary">Pausar cola</button></div><p id="copy-queue-state"></p><div id="copy-queue-entries"></div><details><summary>Últimos resultados</summary><div id="copy-queue-recent"></div></details></section>
<script type="module">import {initCopyQueue} from '/js/copy-queue.js'; initCopyQueue();</script></body></html>'''
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root),**kwargs)
    def reply(self,data,html=False):
        self.send_response(200);self.send_header('Content-Type','text/html' if html else 'application/json');self.end_headers();self.wfile.write(data.encode() if html else json.dumps(data).encode())
    def do_GET(self):
        if self.path=='/preview.html':self.reply(fixture,True)
        elif self.path=='/api/copy-queue':self.reply(queue)
        elif self.path.startswith('/api/movies'):self.reply({'movies':[]})
        else:super().do_GET()
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or '{}')
        mutations.append((self.path,data))
        if self.path.endswith('/pause'):
            queue['paused']=data['paused']
            queue['entries'][0]['phase']='paused' if data['paused'] else 'copying'
            queue['entries'][0]['speed']=0 if data['paused'] else 15
        elif self.path.endswith('/priority'):
            assert data['torrent_hash']=='c' and data['direction']=='first'
            queue['entries'][1],queue['entries'][2]=queue['entries'][2],queue['entries'][1]
            queue['entries'][1]['queue_position']=1;queue['entries'][2]['queue_position']=2
        elif self.path=='/api/stop/b':queue['entries']=[row for row in queue['entries'] if row['torrent_hash']!='b']
        self.reply({'success':True,'queue':queue})
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
        page=browser.new_page();errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_port}/preview.html')
        page.get_by_text('Copiando · 48.5% · 15.00 MB/s · 2 min restantes',exact=True).wait_for()
        page.get_by_role('button',name='Pausar cola',exact=True).click()
        page.get_by_role('button',name='Reanudar cola',exact=True).wait_for()
        assert 'Copia en pausa' in page.locator('[data-hash=a] .copy-queue-stats').inner_text()
        page.get_by_role('button',name='Reanudar cola',exact=True).click()
        page.get_by_role('button',name='Pausar cola',exact=True).wait_for()
        page.locator('[data-hash=c] [data-action=first]').click()
        page.wait_for_function("document.querySelector('[data-hash=c] .copy-queue-stats').textContent.includes('posición 1')")
        page.once('dialog',lambda dialog:dialog.accept())
        page.locator('[data-hash=b] [data-action=stop]').click()
        page.wait_for_function("!document.querySelector('[data-hash=b]')")
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
        assert [entry[0] for entry in mutations]==['/api/copy-queue/pause','/api/copy-queue/pause','/api/copy-queue/priority','/api/stop/b']
        assert not errors,errors
        browser.close()
    print('UI OK: activity, speed/ETA, pause/resume, priority, stop and mobile layout.')
finally:server.shutdown();server.server_close()
