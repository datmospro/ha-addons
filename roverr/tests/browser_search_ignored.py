"""Real search UI: ignored notices, explicit restore, failed/stale requests and navigation."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
import threading
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]/'app/static'
fixture='''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/styles/base.css"><link rel="stylesheet" href="/styles/components.css"><link rel="stylesheet" href="/styles/search-ignored.css">
<style>.view{display:none}.view.active{display:block}#search-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1rem}body{padding:1rem}</style>
<div id="view-search" class="view active"><input id="search-input"><button id="search-btn">Buscar</button><div id="search-results"></div></div>
<div id="view-dashboard" class="view"><div id="movies-grid"></div><span id="selection-counter"></span><button id="select-all-btn"></button><button id="deselect-all-btn"></button><button id="copy-selected-btn"></button><button id="stop-selected-btn"></button><button id="delete-selected-btn"></button></div>
<div id="view-settings" class="view"></div><div id="view-movie-details" class="view"></div>
<script type="module">import {initSearch} from '/js/search.js';import {initMovies} from '/js/movies.js';import {initNavigation,switchView} from '/js/navigation.js';initSearch();initMovies();initNavigation();window.goSearch=()=>switchView('search');</script></html>'''
title="L'été d'une película"
requests=[]
fail=False
stale=False
restored=False

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root),**kwargs)
    def reply(self,data):
        self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8' if isinstance(data,str) else 'application/json');self.end_headers()
        self.wfile.write(data.encode() if isinstance(data,str) else json.dumps(data).encode())
    def do_GET(self):
        path=urlparse(self.path).path
        if path=='/preview.html':return self.reply(fixture)
        if path=='/api/search_tmdb':return self.reply({'success':True,'results':[
            {'tmdb_id':42,'title':title,'original_title':"Summer's movie",'year':'2026','overview':'<img src=x onerror=alert(1)>','ignored':True},
            {'tmdb_id':99,'title':'Otra película','year':'2025','ignored':False}]})
        if path=='/api/search':
            ignored=parse_qs(urlparse(self.path).query).get('tmdb_id')==['42']
            return self.reply({'success':True,'ignored':ignored,'results':[{'title':title+' (2026) [1080p].mkv','download_url':'magnet:?xt=urn:btih:'+'a'*40,'size':3e9,'ignored':ignored}]})
        if path=='/api/movies':return self.reply({'movies':[{'title':title,'torrent_hash':'a'*40,'year':'2026','status':'downloading','progress':.1,'state':'downloading'}] if restored else [],'ignored_series':[]})
        return super().do_GET()
    def do_POST(self):
        global restored
        payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
        requests.append(payload)
        if fail:return self.reply({'success':False,'message':'No se pudo añadir el torrent'})
        if stale and payload.get('restore_ignored') is not True:return self.reply({'success':False,'status':'ignored','message':'Esta película está en la lista de ignorados.'})
        restored=True
        return self.reply({'success':True,'restored':1,'hash':None,'message':'Película restaurada. Pendiente de confirmación del cliente.'})
    def log_message(self,*args):pass

server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
        page=browser.new_page();page.set_default_timeout(8000);errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}/preview.html')
        page.locator('#search-input').fill('película');page.get_by_role('button',name='Buscar',exact=True).click()
        page.get_by_text('Ignorada',exact=True).wait_for()
        assert page.locator('#search-results img').count()==0
        page.locator('[data-movie-index="0"] button').click()
        button=page.get_by_role('button',name='Restaurar y descargar',exact=True)
        button.wait_for();assert 'lista de ignorados' in page.locator('.search-ignored-banner').inner_text()
        assert requests==[]
        fail=True;button.click()
        button.wait_for(state='visible');page.wait_for_function("!document.querySelector('.download-torrent-btn').disabled")
        assert requests[-1]['restore_ignored'] is True and requests[-1]['tmdb_id']==42
        assert requests[-1]['movie_title']==title and requests[-1]['movie_year']=='2026'
        assert not restored
        fail=False;button.click()
        page.wait_for_function("document.querySelector('#view-dashboard').classList.contains('active')")
        assert page.locator('.movie-card').count()==1
        page.evaluate('window.goSearch()')
        page.locator('#search-input').fill('otra');page.locator('#search-btn').click()
        page.locator('[data-movie-index="1"] button').click()
        normal=page.get_by_role('button',name='Descargar',exact=True);normal.wait_for()
        stale=True;normal.click()
        page.get_by_role('button',name='Restaurar y descargar',exact=True).wait_for()
        assert requests[-1]['restore_ignored'] is False
        assert page.locator('.search-ignored-banner').count()==1
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
        page.get_by_role('button',name='Restaurar y descargar',exact=True).click()
        page.wait_for_function("document.querySelector('#view-dashboard').classList.contains('active')")
        assert requests[-1]['restore_ignored'] is True
        assert not errors,errors
        browser.close()
    print('Search UI OK: ignored badge/banner, explicit restore, failures, stale ignore, safe titles, dashboard refresh and mobile.')
finally:server.shutdown();server.server_close()
