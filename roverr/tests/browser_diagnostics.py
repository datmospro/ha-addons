"""Browser regression for diagnostics, escaped output and report download."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
import tempfile
import threading
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]/'app/static'
report={'generated_at':'2026-10-12T12:00:00+00:00','addon_version':'4.5.14','mode':'receptor',
 'summary':{'ok':2,'warning':0,'error':1,'skipped':0},'checks':[
 {'id':'qbittorrent','title':'Conexión con qBittorrent','status':'ok','message':'La conexión funciona.','action':'','details':{'version':'5.0.1'}},
 {'id':'destination_path','title':'Destino y permisos de escritura','status':'error','message':'No hay permisos suficientes.','action':'Concede permisos a la cuenta del receptor.','details':{'path':'M:\\Plex\\<img src=x onerror="window.injected=true">'}},
 {'id':'disk_space','title':'Espacio en el destino','status':'ok','message':'El disco tiene espacio libre.','action':'','details':{'free_bytes':1024**3,'total_bytes':10*1024**3}}]}
fixture='''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/styles/base.css"><link rel="stylesheet" href="/styles/components.css"><link rel="stylesheet" href="/styles/diagnostics.css">
<body><section id="diagnostics-panel"><h3>Diagnóstico de Roverr</h3><div class="diagnostics-actions"><button class="btn primary" id="run-diagnostics-btn">Ejecutar diagnóstico</button><button class="btn secondary" id="download-diagnostics-btn" disabled>Descargar informe sin credenciales</button></div><p id="diagnostics-summary"></p><div id="diagnostics-checks"></div></section><script type="module">import {initDiagnostics} from '/js/diagnostics.js'; initDiagnostics();</script></body></html>'''
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root),**kwargs)
    def reply(self,data,html=False):
        self.send_response(200);self.send_header('Content-Type','text/html' if html else 'application/json');self.end_headers();self.wfile.write(data.encode() if html else json.dumps(data).encode())
    def do_GET(self):
        if self.path=='/preview.html':self.reply(fixture,True)
        elif self.path=='/api/diagnostics/report':self.reply(report)
        elif self.path=='/api/version':self.reply({'version':'4.5.14'})
        else:super().do_GET()
    def do_POST(self):
        if self.path=='/api/diagnostics/run':self.reply({'success':True,'report':report})
        else:self.send_error(404)
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p,tempfile.TemporaryDirectory() as output:
        browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
        page=browser.new_page(accept_downloads=True);errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_port}/preview.html')
        run=page.get_by_role('button',name='Ejecutar diagnóstico',exact=True)
        download=page.get_by_role('button',name='Descargar informe sin credenciales',exact=True)
        assert download.is_disabled()
        run.click()
        page.get_by_text('No hay permisos suficientes.',exact=True).wait_for()
        assert '1 problema' in page.locator('#diagnostics-summary').inner_text()
        assert page.get_by_text('Concede permisos a la cuenta del receptor.',exact=False).is_visible()
        assert page.locator('.diagnostic-details img').count()==0
        assert not page.evaluate('!!window.injected')
        assert not download.is_disabled()
        with page.expect_download() as downloading:download.click()
        artifact=downloading.value
        target=Path(output)/artifact.suggested_filename
        artifact.save_as(str(target))
        assert artifact.suggested_filename=='roverr-diagnostico.json'
        assert json.loads(target.read_text(encoding='utf-8'))==report
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
        assert not errors,errors
        browser.close()
    print('UI OK: diagnostics results, actions, escaped paths, JSON download and mobile layout.')
finally:server.shutdown();server.server_close()
