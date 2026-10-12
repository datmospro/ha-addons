"""Integrity and resumable transfer tests for addon and standalone receptor."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'app'))
from verified_copy import prepare_resume, source_identity, verify_copy
from modules import mover


class VerifiedTransferTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.source = self.base / 'Film (2026).mkv'
        self.source.write_bytes(b'original-content-' * 10000)
        self.final = self.base / 'library' / 'Film (2026).mkv'
        self.final.parent.mkdir()
        self.part = Path(str(self.final) + '.roverr-a.part')
        mover.QUEUE_PAUSED.clear()
        mover.COPY_PROGRESS.clear()
        mover.COPY_OUTPUTS.clear()
        mover.COPY_REPLACEMENTS.clear()
        mover.STOP_FLAGS.clear()

    def tearDown(self):
        mover.QUEUE_PAUSED.clear()
        mover.COPY_PROGRESS.clear()
        mover.COPY_OUTPUTS.clear()
        mover.COPY_REPLACEMENTS.clear()
        mover.STOP_FLAGS.clear()
        self.temp.cleanup()

    def seed(self, prefix=40000):
        prepare_resume(str(self.source),str(self.part),str(self.final),'a',lambda:None)
        self.part.write_bytes(self.source.read_bytes()[:prefix])

    def test_valid_partial_is_reused_and_full_content_is_verified(self):
        self.final.write_bytes(b'old destination')
        self.seed()
        mover.copy_with_progress(str(self.source),str(self.final),'a',overwrite=True)
        self.assertEqual(mover.COPY_PROGRESS['a']['resumed_bytes'],40000)
        self.assertEqual(self.part.read_bytes(),self.source.read_bytes())
        self.assertEqual(mover.COPY_PROGRESS['a']['sha256'],hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertEqual(self.final.read_bytes(),b'old destination')

    def test_corrupt_prefix_is_discarded_instead_of_appended(self):
        self.seed()
        self.part.write_bytes(b'wrong-prefix')
        mover.copy_with_progress(str(self.source),str(self.final),'a',overwrite=True)
        self.assertEqual(mover.COPY_PROGRESS['a']['resumed_bytes'],0)
        self.assertEqual(self.part.read_bytes(),self.source.read_bytes())

    def test_changed_source_invalidates_saved_resume_identity(self):
        self.seed()
        self.source.write_bytes(b'x'*self.source.stat().st_size)
        mover.copy_with_progress(str(self.source),str(self.final),'a',overwrite=True)
        self.assertEqual(mover.COPY_PROGRESS['a']['resumed_bytes'],0)
        self.assertEqual(self.part.read_bytes(),self.source.read_bytes())

    def test_unknown_or_oversized_partial_restarts_safely(self):
        self.part.write_bytes(b'unknown')
        offset,_=prepare_resume(str(self.source),str(self.part),str(self.final),'a',lambda:None)
        self.assertEqual(offset,0)
        self.assertFalse(self.part.exists())
        self.seed()
        self.part.write_bytes(b'x'*(self.source.stat().st_size+1))
        offset,_=prepare_resume(str(self.source),str(self.part),str(self.final),'a',lambda:None)
        self.assertEqual(offset,0)
        self.assertFalse(self.part.exists())

    def test_prefix_validation_propagates_stop_without_discarding_first(self):
        self.seed()
        calls=[]
        def cancel():
            calls.append(1)
            if len(calls)>=2:raise InterruptedError('stop')
        with self.assertRaises(InterruptedError):
            prepare_resume(str(self.source),str(self.part),str(self.final),'a',cancel)
        self.assertTrue(self.part.exists())
        self.assertEqual(self.part.stat().st_size,40000)

    def test_equal_size_corruption_fails_verification(self):
        identity=source_identity(str(self.source))
        self.part.write_bytes(b'x'*self.source.stat().st_size)
        with self.assertRaisesRegex(ValueError,'SHA-256'):
            verify_copy(str(self.source),str(self.part),identity,lambda:None)
        self.assertFalse(self.final.exists())

    def test_source_change_after_copy_is_not_published(self):
        identity=source_identity(str(self.source))
        self.part.write_bytes(self.source.read_bytes())
        self.source.write_bytes(b'changed')
        with self.assertRaises(ValueError):verify_copy(str(self.source),str(self.part),identity,lambda:None)

    def test_stop_during_verification_cleans_part_and_metadata(self):
        self.seed()
        self.final.write_bytes(b'old')
        def stopped(*args):
            mover.STOP_FLAGS.add('a')
            mover.check_copy_cancelled('a')
        with patch.object(mover,'verify_copy',side_effect=stopped):
            with self.assertRaises(InterruptedError):
                mover.copy_with_progress(str(self.source),str(self.final),'a',overwrite=True)
        mover.cleanup_copy_outputs('a')
        self.assertFalse(self.part.exists())
        self.assertFalse(Path(str(self.part)+'.json').exists())
        self.assertEqual(self.final.read_bytes(),b'old')

    def load_receptor(self):
        spec=importlib.util.spec_from_file_location('verified_receptor',ROOT/'scripts/roverr_receptor.py')
        remote=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(remote)
        return remote

    def test_receptor_resumes_partial_and_reports_verified_success(self):
        remote=self.load_receptor()
        self.seed()
        self.final.write_bytes(b'old')
        comparison=remote.inspect_files(str(self.source),str(self.final.parent),'Film (2026)')
        task=remote.CopyTaskHandler('a',str(self.source),str(self.final.parent),'Film (2026)',True,comparison['fingerprint'],True,'attempt-one')
        task.run()
        self.assertEqual(remote.TASKS['a']['status'],'done')
        self.assertTrue(remote.TASKS['a']['verified'])
        self.assertEqual(remote.TASKS['a']['resumed_bytes'],40000)
        self.assertEqual(remote.TASKS['a']['attempt_id'],'attempt-one')
        self.assertEqual(self.final.read_bytes(),self.source.read_bytes())
        self.assertFalse(self.part.exists())
        self.assertFalse(Path(str(self.part)+'.json').exists())

    def test_receptor_io_failure_retains_partial_for_validated_retry(self):
        remote=self.load_receptor()
        comparison=remote.inspect_files(str(self.source),str(self.final.parent),'Film (2026)')
        task=remote.CopyTaskHandler('a',str(self.source),str(self.final.parent),'Film (2026)',False,comparison['fingerprint'],True,'attempt-one')
        with patch.object(remote,'verify_copy',side_effect=OSError('disk temporarily unavailable')):task.run()
        self.assertEqual(remote.TASKS['a']['status'],'error')
        self.assertTrue(self.part.exists())
        self.assertFalse(self.final.exists())
        retry=remote.CopyTaskHandler('a',str(self.source),str(self.final.parent),'Film (2026)',False,comparison['fingerprint'],True,'attempt-two')
        retry.run()
        self.assertEqual(remote.TASKS['a']['status'],'done')
        self.assertEqual(remote.TASKS['a']['resumed_bytes'],self.source.stat().st_size)
        self.assertEqual(self.final.read_bytes(),self.source.read_bytes())

    def test_receptor_verification_failure_preserves_original(self):
        remote=self.load_receptor()
        self.final.write_bytes(b'old')
        comparison=remote.inspect_files(str(self.source),str(self.final.parent),'Film (2026)')
        task=remote.CopyTaskHandler('a',str(self.source),str(self.final.parent),'Film (2026)',True,comparison['fingerprint'],True)
        with patch.object(remote,'verify_copy',side_effect=ValueError('SHA-256 mismatch')):task.run()
        self.assertEqual(remote.TASKS['a']['status'],'error')
        self.assertEqual(self.final.read_bytes(),b'old')
        self.assertFalse(self.part.exists())

    def test_receptor_pause_resume_http_preserves_active_partial(self):
        from http.server import HTTPServer
        import threading
        import time
        import requests
        remote=self.load_receptor()
        remote.MAX_SPEED_MBPS=2
        self.source.write_bytes(b'x'*(3*1024*1024))
        self.final.write_bytes(b'old')
        comparison=remote.inspect_files(str(self.source),str(self.final.parent),'Film (2026)')
        task=remote.CopyTaskHandler('a',str(self.source),str(self.final.parent),'Film (2026)',True,comparison['fingerprint'],True)
        server=HTTPServer(('127.0.0.1',0),remote.ReceptorServer)
        worker=threading.Thread(target=server.serve_forever,daemon=True)
        worker.start()
        task.start()
        base=f'http://127.0.0.1:{server.server_port}'
        try:
            deadline=time.monotonic()+3
            while not self.part.exists() and time.monotonic()<deadline:time.sleep(.01)
            self.assertEqual(requests.post(base+'/pause/a',timeout=5).status_code,200)
            deadline=time.monotonic()+3
            while remote.TASKS['a'].get('phase')!='paused' and time.monotonic()<deadline:time.sleep(.01)
            self.assertEqual(remote.TASKS['a']['phase'],'paused')
            size=self.part.stat().st_size
            time.sleep(.15)
            self.assertEqual(self.part.stat().st_size,size)
            self.assertEqual(self.final.read_bytes(),b'old')
            self.assertEqual(requests.post(base+'/resume/a',timeout=5).status_code,200)
            task.join(timeout=5)
            self.assertFalse(task.is_alive())
            self.assertTrue(remote.TASKS['a']['verified'])
            self.assertEqual(self.final.read_bytes(),self.source.read_bytes())
        finally:
            remote.PAUSE_FLAGS.discard('a')
            remote.STOP_FLAGS.add('a')
            task.join(timeout=5)
            server.shutdown();server.server_close();worker.join(timeout=5)

    def test_receptor_stop_of_initially_paused_retry_removes_saved_partial(self):
        import time
        remote=self.load_receptor()
        self.seed()
        self.final.write_bytes(b'old')
        comparison=remote.inspect_files(str(self.source),str(self.final.parent),'Film (2026)')
        task=remote.CopyTaskHandler('a',str(self.source),str(self.final.parent),'Film (2026)',True,comparison['fingerprint'],True)
        remote.PAUSE_FLAGS.add('a')
        task.start()
        try:
            deadline=time.monotonic()+3
            while remote.TASKS['a'].get('phase')!='paused' and time.monotonic()<deadline:time.sleep(.01)
            self.assertEqual(remote.TASKS['a']['phase'],'paused')
            self.assertTrue(self.part.exists())
            remote.STOP_FLAGS.add('a')
            task.join(timeout=3)
            self.assertEqual(remote.TASKS['a']['status'],'cancelled')
            self.assertFalse(self.part.exists())
            self.assertFalse(Path(str(self.part)+'.json').exists())
            self.assertEqual(self.final.read_bytes(),b'old')
        finally:
            remote.PAUSE_FLAGS.discard('a')
            remote.STOP_FLAGS.add('a')
            task.join(timeout=3)

    def test_remote_cleanup_removes_only_owned_partials_and_rejects_escape(self):
        from http.server import HTTPServer
        import threading
        import requests
        remote=self.load_receptor()
        self.seed()
        self.final.write_bytes(b'original destination')
        unrelated=self.final.parent/'keep.nfo'
        unrelated.write_bytes(b'keep')
        server=HTTPServer(('127.0.0.1',0),remote.ReceptorServer)
        worker=threading.Thread(target=server.serve_forever,daemon=True)
        worker.start()
        url=f'http://127.0.0.1:{server.server_port}/cleanup'
        payload={'task_id':'a','destination':str(self.final.parent),'files':[str(self.final)]}
        try:
            remote.TASKS['a']={'status':'copying'}
            self.assertEqual(requests.post(url,json=payload,timeout=5).status_code,409)
            self.assertTrue(self.part.exists())
            remote.TASKS['a']={'status':'error'}
            escape=dict(payload,files=[str(self.base/'elsewhere.mkv')])
            self.assertEqual(requests.post(url,json=escape,timeout=5).status_code,400)
            self.assertTrue(self.part.exists())
            self.assertEqual(requests.post(url,json=payload,timeout=5).status_code,200)
            self.assertFalse(self.part.exists())
            self.assertFalse(Path(str(self.part)+'.json').exists())
            self.assertEqual(self.final.read_bytes(),b'original destination')
            self.assertEqual(unrelated.read_bytes(),b'keep')
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)

    def test_embedded_transfer_helpers_match_addon_source(self):
        standalone=(ROOT/'scripts/roverr_receptor.py').read_text(encoding='utf-8')
        self.assertIn((ROOT/'app/verified_copy.py').read_text(encoding='utf-8'),standalone)

if __name__=='__main__':unittest.main()
