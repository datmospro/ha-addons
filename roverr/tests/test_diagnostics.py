"""Support diagnostics, filesystem safety and export privacy regressions."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'app'))
import database
from peewee import SqliteDatabase
from modules import diagnostics
import filesystem_diagnostics as fs
import main


class DiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.base=Path(self.temp.name)
        self.source=self.base/'source';self.source.mkdir()
        self.destination=self.base/'library';self.destination.mkdir()
        (self.source/'sample.mkv').write_bytes(b'source')
        (self.destination/'keep.nfo').write_bytes(b'keep')
        self.db=SqliteDatabase(str(self.base/'history.db'))
        self.db.bind([database.Movie,database.MoveHistory,database.CopyJob,database.CopyQueueControl])
        self.db.create_tables([database.Movie,database.MoveHistory,database.CopyJob,database.CopyQueueControl])
        self.settings={'qb_host':'localhost','qb_port':8080,'qb_user':'private-user','qb_pass':'secret-password-123',
                       'local_source_path':str(self.source),'local_dest_path':str(self.destination),'receptor_enabled':False,
                       'tmdb_api_key':'private-tmdb-key','telegram_bot_token':'private-bot-token',
                       'indexers':[{'api_key':'private-indexer-key'}]}
        self.qb=Mock();self.qb.app_version.return_value='5.0.1'
        self.client=patch.object(diagnostics.qbittorrentapi,'Client',return_value=self.qb)
        self.client.start()
        diagnostics.LATEST_REPORT=None

    def tearDown(self):
        self.client.stop()
        self.db.close()
        self.temp.cleanup()

    def report(self):return diagnostics.build_diagnostics(self.settings)
    def check(self, report, key):return next(row for row in report['checks'] if row['id']==key)
    def response(self,data):
        response=Mock(status_code=200);response.json.return_value=data;return response

    def test_local_diagnostics_preserve_files_and_remove_their_probe(self):
        before=list(self.destination.iterdir())
        report=self.report()
        self.assertEqual(self.check(report,'qbittorrent')['status'],'ok')
        self.assertEqual(self.check(report,'source_path')['status'],'ok')
        self.assertEqual(self.check(report,'destination_path')['status'],'ok')
        self.assertEqual(list(self.destination.iterdir()),before)
        self.assertEqual((self.destination/'keep.nfo').read_bytes(),b'keep')
        self.assertEqual((self.source/'sample.mkv').read_bytes(),b'source')
        self.assertEqual(self.check(report,'receptor')['status'],'skipped')
        self.assertEqual(report['addon_version'],'4.5.14')

    def test_missing_destination_is_not_created_by_diagnostics(self):
        missing=self.destination/'not-mounted'
        self.settings['local_dest_path']=str(missing)
        report=self.report()
        self.assertEqual(self.check(report,'destination_path')['status'],'error')
        self.assertFalse(missing.exists())

    def test_write_permission_denied_has_an_action_without_raw_exception(self):
        with patch.object(fs.tempfile,'mkstemp',side_effect=PermissionError('secret-password-123')):
            report=self.report()
        result=self.check(report,'destination_path')
        self.assertEqual(result['status'],'error')
        self.assertIn('permisos',result['action'])
        self.assertNotIn('secret-password-123',json.dumps(report))
        self.assertEqual(list(self.destination.iterdir()),[self.destination/'keep.nfo'])

    def test_failed_probe_cleanup_identifies_only_its_own_file(self):
        with patch.object(fs.os,'remove',side_effect=PermissionError('cannot remove')):
            report=self.report()
        result=self.check(report,'destination_path')
        self.assertEqual(result['status'],'error')
        temporary=Path(result['details']['temporary_file'])
        self.assertTrue(temporary.name.startswith('.roverr-diagnostico-'))
        self.assertEqual(temporary.parent,self.destination)
        temporary.unlink()
        self.assertEqual((self.destination/'keep.nfo').read_bytes(),b'keep')

    def test_no_disk_space_and_insufficient_space_are_distinct(self):
        with patch.object(fs.shutil,'disk_usage',return_value=SimpleNamespace(total=1000,free=0)):
            self.assertEqual(self.check(self.report(),'disk_space')['status'],'error')
        with patch.object(fs.shutil,'disk_usage',return_value=SimpleNamespace(total=1000,free=10)):
            self.assertEqual(self.check(self.report(),'disk_space')['status'],'warning')

    def test_authentication_error_does_not_export_password_or_internal_error(self):
        class LoginFailed(Exception):pass
        self.qb.auth_log_in.side_effect=LoginFailed('secret-password-123 private-tmdb-key raw request cookie=private-cookie')
        report=self.report()
        self.assertEqual(self.check(report,'qbittorrent')['status'],'error')
        self.assertIn('autenticación',self.check(report,'qbittorrent')['message'])
        text=json.dumps(report)
        self.assertNotIn('secret-password-123',text)
        self.assertNotIn('private-cookie',text)

    def test_windows_mapping_is_boundary_aware_and_handles_trailing_slashes(self):
        mapping='/share/downloads/=C:\\TorDownload\\\n/media/library=M:\\Plex'
        self.assertEqual(diagnostics.mapped_windows_path('/share/downloads',mapping),'C:\\TorDownload')
        self.assertEqual(diagnostics.mapped_windows_path('/media/library',mapping),'M:\\Plex')
        with self.assertRaises(ValueError):diagnostics.mapped_windows_path('/media/library-other',mapping)
        self.assertEqual(diagnostics.mapped_windows_path('\\\\server\\share\\Films',''),'\\\\server\\share\\Films')

    def test_remote_diagnostics_use_mapped_windows_paths_not_ha_paths(self):
        self.settings.update(receptor_enabled=True,receptor_host='192.0.2.10',local_source_path='/share/downloads',local_dest_path='/media/library',
                             receptor_path_mapping='/share/downloads=C:\\TorDownload\n/media/library=M:\\Plex')
        rows=[fs.diagnostic_check(key,key,'ok','Comprobado',details={'path':'M:\\Plex','api_key':'private-indexer-key','configuration':self.settings})
              for key in ('source_path','destination_path','disk_space')]
        health={'service':'Roverr Receptor','status':'ok','version':'4.5.14','diagnostics':True}
        with patch.object(diagnostics.requests,'get',return_value=self.response(health)),patch.object(diagnostics.requests,'post',return_value=self.response({'checks':rows})) as post:
            report=self.report()
        payload=post.call_args.kwargs['json']
        self.assertEqual(payload['source'],'C:\\TorDownload')
        self.assertEqual(payload['destination'],'M:\\Plex')
        self.assertEqual(self.check(report,'destination_path')['status'],'ok')
        self.assertNotIn('configuration',str(report))
        self.assertNotIn('private-indexer-key',str(report))

    def test_old_receptor_marks_unavailable_permission_checks_as_skipped(self):
        self.settings.update(receptor_enabled=True,receptor_host='localhost')
        health={'service':'Roverr Receptor','status':'ok','version':'4.5.13'}
        with patch.object(diagnostics.requests,'get',return_value=self.response(health)),patch.object(diagnostics.requests,'post') as post:
            report=self.report()
        self.assertEqual(self.check(report,'receptor')['status'],'warning')
        self.assertEqual(self.check(report,'destination_path')['status'],'skipped')
        post.assert_not_called()

    def test_offline_receptor_does_not_echo_connection_exception(self):
        import requests
        self.settings.update(receptor_enabled=True,receptor_host='localhost')
        with patch.object(diagnostics.requests,'get',side_effect=requests.ConnectionError('http://private-user:secret-password-123@localhost private-bot-token')):
            report=self.report()
        self.assertEqual(self.check(report,'receiver_diagnostics')['status'],'error')
        self.assertEqual(self.check(report,'source_path')['status'],'skipped')
        self.assertNotIn('secret-password-123',json.dumps(report))
        self.assertNotIn('private-user',json.dumps(report))

    def test_redaction_covers_nested_tokens_encoding_and_url_credentials(self):
        from urllib.parse import quote
        self.settings['qb_pass']='secret password&123'
        raw={'details':['secret password&123',quote(self.settings['qb_pass'],safe=''),'private-tmdb-key','private-bot-token','private-indexer-key',
                        'http://someone:unknown-host-password@localhost/path'], 'queue':{'token':'private-bot-token'}}
        report=diagnostics.redact_report(raw,self.settings)
        text=json.dumps(report)
        for value in raw['details'][:5]:self.assertNotIn(value,text)
        self.assertNotIn('unknown-host-password',text)

    def test_generic_urls_and_query_credentials_are_removed(self):
        raw={'path':'smb://someone:unknown-share-password@server/share?apikey=unknown-key&token=unknown-token'}
        report=diagnostics.redact_report(raw,self.settings)
        text=json.dumps(report)
        for value in ('unknown-share-password','unknown-key','unknown-token'):
            self.assertNotIn(value,text)
        self.assertEqual(diagnostics.public_endpoint('http://private-user:secret-password-123@localhost/path?apikey=private-indexer-key',8080),{'host':'localhost','port':8080})

    def test_paused_queue_is_a_clear_warning_without_exposing_jobs_options(self):
        database.CopyQueueControl.create(id=1,paused=True)
        check,_=diagnostics.queue_diagnostic()
        self.assertEqual(check['status'],'warning')
        self.assertIn('Reanudar cola',check['action'])
        self.assertEqual(check['details']['jobs']['running'],0)

    def test_automatic_copy_policy_is_clear_and_does_not_export_feed_urls(self):
        check=diagnostics.automatic_copy_diagnostic(self.settings)
        self.assertEqual(check['status'],'warning')
        self.settings['rss_feeds']=[{'enabled':True,'auto_copy':True,'auto_add':True,'url':'https://example.test/rss?apikey=private-indexer-key'}]
        check=diagnostics.automatic_copy_diagnostic(self.settings)
        self.assertEqual(check['status'],'ok')
        self.assertEqual(check['details']['rss_auto_copy_feeds'],1)
        self.assertNotIn('private-indexer-key',json.dumps(check))

    def test_export_is_the_completed_report_and_does_not_rerun_probes(self):
        with patch.object(diagnostics,'load_settings',return_value=self.settings):
            result=diagnostics.run_diagnostics()
        self.assertTrue(result['success'])
        self.assertNotIn('secret-password-123',json.dumps(result))
        response=main.download_diagnostics_endpoint()
        self.assertEqual(response.status_code,200)
        self.assertIn('attachment',response.headers['content-disposition'])
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(json.loads(response.body),result['report'])
        cached=diagnostics.latest_diagnostics();cached['checks'].clear()
        self.assertTrue(diagnostics.latest_diagnostics()['checks'])

    def test_export_requires_a_completed_run_and_concurrent_run_is_rejected(self):
        self.assertEqual(main.download_diagnostics_endpoint().status_code,404)
        diagnostics.RUN_LOCK.acquire()
        try:self.assertFalse(diagnostics.run_diagnostics()['success'])
        finally:diagnostics.RUN_LOCK.release()

    def test_threaded_receptor_admits_the_same_hash_only_once(self):
        from http.server import ThreadingHTTPServer
        from concurrent.futures import ThreadPoolExecutor
        import threading
        import requests
        spec=importlib.util.spec_from_file_location('concurrent_diagnostic_receptor',ROOT/'scripts/roverr_receptor.py')
        receiver=importlib.util.module_from_spec(spec);spec.loader.exec_module(receiver)
        original=receiver.CopyTaskHandler
        def reserve(*args):
            task=original(*args)
            task.start=Mock()
            return task
        server=ThreadingHTTPServer(('127.0.0.1',0),receiver.ReceptorServer)
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        source=self.source/'sample.mkv'
        comparison=receiver.inspect_files(str(source),str(self.destination),'Film (2026)')
        payload={'task_id':'a','source':str(source),'destination':str(self.destination),'folder_name':'Film (2026)',
                 'stage_all':True,'fingerprint':comparison['fingerprint']}
        try:
            url=f'http://127.0.0.1:{server.server_port}/copy'
            with patch.object(receiver,'CopyTaskHandler',side_effect=reserve) as admission,ThreadPoolExecutor(max_workers=2) as pool:
                futures=[pool.submit(requests.post,url,json=payload,timeout=5) for _ in range(2)]
                self.assertEqual(sorted(future.result().status_code for future in futures),[202,409])
                self.assertEqual(admission.call_count,1)
        finally:server.shutdown();server.server_close();worker.join(timeout=5)

    def test_receiver_filesystem_endpoint_probes_without_touching_movie_files(self):
        from http.server import HTTPServer
        import threading
        import requests
        spec=importlib.util.spec_from_file_location('diagnostic_receptor',ROOT/'scripts/roverr_receptor.py')
        receiver=importlib.util.module_from_spec(spec);spec.loader.exec_module(receiver)
        server=HTTPServer(('127.0.0.1',0),receiver.ReceptorServer)
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        try:
            base=f'http://127.0.0.1:{server.server_port}'
            self.assertTrue(requests.get(base+'/ping',timeout=5).json()['diagnostics'])
            response=requests.post(base+'/diagnostics',json={'source':str(self.source),'destination':str(self.destination)},timeout=5)
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json()['checks'][1]['status'],'ok')
            self.assertEqual(list(self.destination.iterdir()),[self.destination/'keep.nfo'])
            self.assertEqual((self.source/'sample.mkv').read_bytes(),b'source')
            self.assertEqual(requests.post(base+'/diagnostics',json={'source':[]},timeout=5).status_code,400)
            self.assertIn((ROOT/'app/filesystem_diagnostics.py').read_text(encoding='utf-8'),(ROOT/'scripts/roverr_receptor.py').read_text(encoding='utf-8'))
        finally:server.shutdown();server.server_close();worker.join(timeout=5)

if __name__=='__main__':unittest.main()
