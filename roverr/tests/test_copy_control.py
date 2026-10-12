"""Regression tests; no real qBittorrent, TMDB or media library is used.

Run with: python -m unittest discover -s roverr/tests -v
"""
import asyncio
import importlib.util
import logging
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'app'))
import database
from peewee import SqliteDatabase
from modules import mover, tmdb, config
import main
from copy_conflicts import inspect_files


class CopyControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.db = SqliteDatabase(str(self.base / 'history.db'))
        self.db.bind([database.Movie, database.MoveHistory])
        self.db.create_tables([database.Movie, database.MoveHistory])
        self.settings = {
            'local_source_path': str(self.base / 'source'),
            'local_dest_path': str(self.base / 'library'),
            'copy_speed_limit': 0,
            'copy_recovery_453_done': True,
            'telegram_notify_on_move': False,
            'telegram_notify_on_download_complete': False,
            'telegram_notify_on_new_movie': False,
            'rss_feeds': [{'label': 'films', 'auto_copy': True}],
        }
        Path(self.settings['local_source_path']).mkdir()
        (Path(self.settings['local_source_path']) / 'Film (2026).mkv').write_bytes(b'x')
        self.patches = [
            patch.object(mover, 'load_settings', return_value=self.settings),
            patch.object(tmdb, 'load_settings', return_value=self.settings),
            patch.object(tmdb, 'save_settings', side_effect=lambda s: self.settings.update(s)),
            patch.object(tmdb, 'enrich_missing_metadata_background'),
            patch.object(tmdb, 'trigger_movies_update_callback'),
            patch.object(mover, 'trigger_movies_update_callback'),
            patch.object(mover, 'send_telegram_notification'),
        ]
        for p in self.patches:
            p.start()
        mover.COPY_PROGRESS.clear()
        mover.STOP_FLAGS.clear()
        mover.COPY_OUTPUTS.clear()
        mover.COPY_DIRECTORIES.clear()
        mover.COPY_REPLACEMENTS.clear()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.db.close()
        self.temp.cleanup()

    def movie(self, hash='a', **kwargs):
        return database.Movie.create(torrent_hash=hash, title='Film',
                                     torrent_name='Film (2026).mkv', **kwargs)

    def torrent(self, hash='a', progress=1, state='uploading'):
        return dict(hash=hash, name='Film (2026).mkv', progress=progress,
                    state=state, size=1, tags='films', category='',
                    content_path='Film (2026).mkv')

    def wait_for(self, predicate, timeout=3):
        deadline = time.monotonic() + timeout
        while not predicate():
            if time.monotonic() > deadline:
                self.fail('Timed out waiting for copy worker')
            time.sleep(0.01)

    def test_completion_without_websocket_clients(self):
        qb = Mock()
        first = SimpleNamespace(hash='a', progress=.5, state='downloading',
                                dlspeed=1, eta=1)
        last = SimpleNamespace(hash='a', progress=1, state='uploading')
        qb.torrents_info.side_effect = [[first], [last]]
        calls = 0
        async def sleep(_):
            nonlocal calls
            calls += 1
            if calls >= 2:
                raise asyncio.CancelledError
        main.manager.active_connections.clear()
        with patch.object(main, 'get_qb_client', return_value=qb), \
             patch.object(main, 'load_settings', return_value=self.settings), \
             patch.object(main, 'get_copy_progress', return_value={}), \
             patch.object(main, 'process_torrents') as process, \
             patch.object(main, 'broadcast_movies_update', new_callable=AsyncMock), \
             patch.object(main.asyncio, 'sleep', side_effect=sleep):
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(main.ws_progress_broadcast_task())
            process.assert_called_once_with(None)

    def test_auto_copy_survives_consumed_status_transition(self):
        self.movie(status='pending', progress=1)
        with patch.object(tmdb, 'manual_move') as move:
            tmdb.sync_movies([self.torrent()], 'test-key')
            move.assert_called_once_with('a', automatic=True)

    def test_upgrade_holds_backlog_but_not_future_completions(self):
        self.settings.pop('copy_recovery_453_done')
        self.movie(status='downloading', progress=.5)
        self.movie('b', status='downloading', progress=.5)
        with patch.object(tmdb, 'manual_move') as move:
            tmdb.sync_movies([self.torrent(), self.torrent('b', .5, 'downloading')], 'key')
            move.assert_not_called()
            self.assertTrue(database.Movie.get_by_id(1).copy_paused)
            self.assertFalse(database.Movie.get_by_id(2).copy_paused)
            tmdb.sync_movies([self.torrent(), self.torrent('b')], 'key')
            move.assert_called_once_with('b', automatic=True)

    def test_empty_snapshot_does_not_consume_upgrade_recovery(self):
        self.settings.pop('copy_recovery_453_done')
        tmdb.sync_movies([], 'key')
        self.assertNotIn('copy_recovery_453_done', self.settings)

    def test_existing_database_migrates_hold_column_idempotently(self):
        self.movie(status='pending')
        self.db.execute_sql('ALTER TABLE movie DROP COLUMN copy_paused')
        with patch.object(database, 'db', self.db):
            database.migrate_db()
            database.migrate_db()
        self.assertFalse(database.Movie.get(database.Movie.torrent_hash == 'a').copy_paused)

    def test_stop_persists_hold_across_sync_and_connection_reopen(self):
        self.movie(status='pending', progress=1)
        self.assertTrue(mover.stop_copy('a'))
        self.db.close()
        with patch.object(tmdb, 'manual_move') as move:
            tmdb.sync_movies([self.torrent()], 'key')
            move.assert_not_called()
        self.assertTrue(database.Movie.get(database.Movie.torrent_hash == 'a').copy_paused)

    def test_stale_metadata_writer_cannot_clear_cancellation_hold(self):
        old_instance = self.movie(status='pending')
        mover.stop_copy('a')
        old_instance.overview = 'Metadata loaded before cancellation'
        old_instance.save()
        saved = database.Movie.get(database.Movie.torrent_hash == 'a')
        self.assertTrue(saved.copy_paused)
        self.assertEqual(saved.overview, old_instance.overview)

    def test_local_cancel_deletes_output_directory_and_never_succeeds(self):
        self.movie(status='pending', progress=1)
        src = Path(self.settings['local_source_path']) / 'Film (2026).mkv'
        src.write_bytes(b'x' * (2 * 1024 * 1024))
        self.settings['copy_speed_limit'] = .1
        qb = Mock()
        qb.torrents_info.return_value = [SimpleNamespace(**self.torrent())]
        dst = Path(self.settings['local_dest_path']) / 'Film (2026)'
        with patch.object(mover, 'get_qb_client', return_value=qb):
            self.assertTrue(mover.manual_move('a')['success'])
            self.wait_for(lambda: dst.exists() and any(dst.iterdir()))
            self.assertTrue(mover.stop_copy('a'))
            self.wait_for(lambda: 'a' not in mover.COPY_PROGRESS)
        self.assertFalse(dst.exists())
        self.assertTrue(src.exists())
        self.assertEqual([h.status for h in database.MoveHistory.select()], ['cancelled'])

    def test_multifile_cancel_removes_all_task_outputs_preserves_existing(self):
        src = Path(self.settings['local_source_path']) / 'Film (2026)'
        src.mkdir()
        (src / 'first.mkv').write_bytes(b'a')
        (src / 'second.mp4').write_bytes(b'b')
        dst = Path(self.settings['local_dest_path']) / 'Film (2026)'
        dst.mkdir(parents=True)
        sentinel = dst / 'existing.txt'
        sentinel.write_text('keep')
        original = mover.copy_with_progress
        def cancel_after_first(*args, **kwargs):
            original(*args, **kwargs)
            mover.STOP_FLAGS.add('a')
        torrent = SimpleNamespace(hash='a', name='Film (2026)', content_path='Film (2026)')
        with patch.object(mover, 'copy_with_progress', side_effect=cancel_after_first):
            mover.process_single_torrent(Mock(), torrent, self.settings)
        self.assertEqual(list(dst.iterdir()), [sentinel])
        self.assertEqual(database.MoveHistory.select().get().status, 'cancelled')

    def test_serial_queue_deduplicates_and_cancels_waiting_copy(self):
        self.movie(status='pending', progress=1)
        self.movie('b', status='pending', progress=1)
        entered = threading.Event()
        release = threading.Event()
        processed = []
        def process(qb, torrent, settings):
            processed.append(torrent.hash)
            entered.set()
            release.wait(3)
        qb = Mock()
        qb.torrents_info.side_effect = lambda torrent_hashes: [SimpleNamespace(**self.torrent(torrent_hashes))]
        with patch.object(mover, 'get_qb_client', return_value=qb), \
             patch.object(mover, 'process_single_torrent', side_effect=process):
            try:
                mover.manual_move('a')
                self.assertTrue(entered.wait(2))
                mover.manual_move('a')
                mover.manual_move('b')
                self.assertEqual(mover.COPY_PROGRESS['b']['status'], 'queued')
                mover.stop_copy('b')
            finally:
                release.set()
            self.wait_for(lambda: not mover.COPY_PROGRESS)
        self.assertEqual(processed, ['a'])

    def test_manual_start_clears_hold_auto_start_does_not(self):
        self.movie(status='pending', progress=1, copy_paused=True)
        qb = Mock()
        qb.torrents_info.return_value = [SimpleNamespace(**self.torrent())]
        with patch.object(mover, 'get_qb_client', return_value=qb), \
             patch.object(mover, 'process_single_torrent'):
            self.assertFalse(mover.manual_move('a', automatic=True)['success'])
            self.assertTrue(mover.manual_move('a')['success'])
            self.wait_for(lambda: not mover.COPY_PROGRESS)
        self.assertFalse(database.Movie.get(database.Movie.torrent_hash == 'a').copy_paused)

    def test_batch_stop_holds_pending_and_queued_skips_completed(self):
        self.movie(status='pending')
        self.movie('b', status='moved')
        mover.COPY_PROGRESS['a'] = {'status': 'queued'}
        result = main.batch_stop_copies({'torrent_hashes': ['a', 'a', 'b', 'missing']})
        self.assertEqual(result['stopped'], 1)
        self.assertEqual(result['skipped'], 2)
        self.assertIn('a', mover.STOP_FLAGS)
        self.assertFalse(database.Movie.get(database.Movie.torrent_hash == 'b').copy_paused)

    def test_settings_saved_from_old_tab_preserve_recovery_marker(self):
        with patch.object(main, 'load_settings', return_value=self.settings), \
             patch.object(main, 'save_settings') as save:
            main.update_settings({'local_source_path': '/source', 'local_dest_path': '/library'})
            self.assertTrue(save.call_args.args[0]['copy_recovery_453_done'])

    def test_remote_cancel_waits_for_cleanup_confirmation(self):
        torrent = SimpleNamespace(hash='a', name='Film (2026)')
        mover.STOP_FLAGS.add('a')
        stop = Mock(status_code=200)
        responses = [Mock(status_code=200), Mock(status_code=200)]
        responses[0].json.return_value = {'status': 'copying', 'percent': 5}
        responses[1].json.return_value = {'status': 'cancelled'}
        with patch.object(mover.requests, 'post', return_value=stop) as post, \
             patch.object(mover.requests, 'get', side_effect=responses), \
             patch.object(mover.time, 'sleep'):
            mover._poll_receptor_status(torrent, 'localhost', 8095, 'src', 'dst', self.settings, 'Film', '2026')
            post.assert_called_once()
        self.assertEqual(database.MoveHistory.select().get().status, 'cancelled')

    def test_receptor_cancel_cleans_outputs(self):
        spec = importlib.util.spec_from_file_location('test_receptor', ROOT / 'scripts/roverr_receptor.py')
        remote = importlib.util.module_from_spec(spec)
        with patch.object(logging, 'FileHandler', return_value=logging.NullHandler()):
            spec.loader.exec_module(remote)
        source = self.base / 'Film (2026).mkv'
        source.write_bytes(b'x')
        dest = self.base / 'remote-library' / 'Film (2026)'
        task = remote.CopyTaskHandler('a', str(source), str(dest), 'Film (2026)')
        original = task._copy_file
        def cancel(src, dst):
            original(src, dst)
            remote.STOP_FLAGS.add('a')
        with patch.object(task, '_copy_file', side_effect=cancel):
            task.run()
        self.assertEqual(remote.TASKS['a']['status'], 'cancelled')
        self.assertFalse(dest.exists())
        self.assertTrue(source.exists())

    def existing_destination(self, content=b'old'):
        dest = Path(self.settings['local_dest_path']) / 'Film (2026)' / 'Film (2026).mkv'
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)
        return dest

    def fake_qb(self):
        qb = Mock()
        qb.torrents_info.return_value = [SimpleNamespace(**self.torrent())]
        return patch.object(mover, 'get_qb_client', return_value=qb)

    def test_inspection_compares_exact_sizes_and_dates(self):
        src = Path(self.settings['local_source_path']) / 'Film (2026).mkv'
        src.write_bytes(b'123456789')
        dst = self.existing_destination(b'123')
        result = inspect_files(str(src), str(dst.parent), 'Film (2026)')
        row = result['files'][0]
        self.assertTrue(result['conflict'])
        self.assertEqual(row['source']['size'], 9)
        self.assertEqual(row['destination']['size'], 3)
        self.assertEqual(row['difference_bytes'], -6)
        self.assertFalse(row['same_size'])
        self.assertTrue(row['destination']['modified'])

    def test_existing_file_returns_decision_without_copying(self):
        self.movie(status='error')
        dst = self.existing_destination()
        with self.fake_qb():
            result = mover.manual_move('a')
        self.assertEqual(result['status'], 'conflict')
        self.assertEqual(result['comparison']['files'][0]['destination']['path'], str(dst))
        self.assertEqual(dst.read_bytes(), b'old')
        self.assertFalse(mover.COPY_PROGRESS)

    def test_manual_copy_http_route_returns_conflict_then_accepts_keep(self):
        from fastapi.testclient import TestClient
        self.movie(status='error')
        dst = self.existing_destination()
        client = TestClient(main.app)
        def request_copy(*args, **kwargs):
            try:
                return mover.manual_move(*args, **kwargs)
            finally:
                # The temporary test database must release the connection
                # owned by FastAPI's request worker before Windows removes it.
                database.Movie._meta.database.close()
        try:
            with self.fake_qb(), patch.object(main, 'manual_move', side_effect=request_copy):
                response = client.post('/api/move/a')
                self.assertEqual(response.status_code, 200)
                comparison = response.json()['comparison']
                response = client.post('/api/move/a', json={'action': 'keep', 'fingerprint': comparison['fingerprint']})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['status'], 'marked')
            self.assertEqual(dst.read_bytes(), b'old')
        finally:
            client.close()

    def test_keep_marks_copied_without_changing_existing_file(self):
        self.movie(status='error')
        dst = self.existing_destination()
        with self.fake_qb():
            comparison = mover.manual_move('a')['comparison']
            result = mover.manual_move('a', decision={'action': 'keep', 'fingerprint': comparison['fingerprint']})
        self.assertEqual(result['status'], 'marked')
        self.assertEqual(dst.read_bytes(), b'old')
        self.assertEqual(database.Movie.get(database.Movie.torrent_hash == 'a').status, 'moved_manually')
        self.assertEqual(database.MoveHistory.select().get().status, 'manual')

    def test_overwrite_replaces_file_after_success(self):
        self.movie(status='error')
        dst = self.existing_destination()
        with self.fake_qb():
            comparison = mover.manual_move('a')['comparison']
            result = mover.manual_move('a', decision={'action': 'overwrite', 'fingerprint': comparison['fingerprint']})
            self.assertEqual(result['status'], 'started')
            self.wait_for(lambda: not mover.COPY_PROGRESS)
        self.assertEqual(dst.read_bytes(), b'x')
        self.assertEqual(database.MoveHistory.select().get().status, 'success')
        self.assertFalse(list(dst.parent.glob('*.part')))

    def test_cancel_overwrite_preserves_original_and_removes_temporary(self):
        self.movie(status='error')
        dst = self.existing_destination()
        src = Path(self.settings['local_source_path']) / 'Film (2026).mkv'
        src.write_bytes(b'x' * (2 * 1024 * 1024))
        self.settings['copy_speed_limit'] = .1
        with self.fake_qb():
            comparison = mover.manual_move('a')['comparison']
            mover.manual_move('a', decision={'action': 'overwrite', 'fingerprint': comparison['fingerprint']})
            self.wait_for(lambda: bool(list(dst.parent.glob('*.part'))))
            self.assertEqual(dst.read_bytes(), b'old')
            mover.stop_copy('a')
            self.wait_for(lambda: not mover.COPY_PROGRESS)
        self.assertEqual(dst.read_bytes(), b'old')
        self.assertFalse(list(dst.parent.glob('*.part')))
        self.assertEqual(database.MoveHistory.select().get().status, 'cancelled')

    def test_stale_decision_reopens_comparison_instead_of_overwriting(self):
        self.movie(status='pending')
        dst = self.existing_destination()
        with self.fake_qb():
            comparison = mover.manual_move('a')['comparison']
            dst.write_bytes(b'changed-after-dialog')
            result = mover.manual_move('a', decision={'action': 'overwrite', 'fingerprint': comparison['fingerprint']})
        self.assertEqual(result['status'], 'conflict')
        self.assertNotEqual(result['comparison']['fingerprint'], comparison['fingerprint'])
        self.assertEqual(dst.read_bytes(), b'changed-after-dialog')
        self.assertFalse(mover.COPY_PROGRESS)

    def test_external_destination_change_during_copy_is_preserved(self):
        self.movie(status='pending')
        dst = self.existing_destination()
        original = mover.copy_with_progress
        def external_change(*args, **kwargs):
            original(*args, **kwargs)
            dst.write_bytes(b'external-change')
        with self.fake_qb(), patch.object(mover, 'copy_with_progress', side_effect=external_change):
            comparison = mover.manual_move('a')['comparison']
            mover.manual_move('a', decision={'action': 'overwrite', 'fingerprint': comparison['fingerprint']})
            self.wait_for(lambda: not mover.COPY_PROGRESS)
        self.assertEqual(dst.read_bytes(), b'external-change')
        self.assertFalse(list(dst.parent.glob('*.part')))
        self.assertEqual(database.MoveHistory.select().get().status, 'error')

    def test_automatic_conflict_holds_without_overwriting(self):
        self.movie(status='pending')
        dst = self.existing_destination()
        with self.fake_qb():
            result = mover.manual_move('a', automatic=True)
        self.assertEqual(result['status'], 'conflict')
        self.assertTrue(database.Movie.get(database.Movie.torrent_hash == 'a').copy_paused)
        self.assertEqual(dst.read_bytes(), b'old')

    def test_inspection_rejects_source_equals_destination(self):
        source = Path(self.settings['local_source_path']) / 'Film (2026).mkv'
        with self.assertRaisesRegex(ValueError, 'same file'):
            inspect_files(str(source), str(source.parent), 'Film (2026)')

    def load_receptor(self):
        spec = importlib.util.spec_from_file_location('test_receptor_conflicts', ROOT / 'scripts/roverr_receptor.py')
        remote = importlib.util.module_from_spec(spec)
        with patch.object(logging, 'FileHandler', return_value=logging.NullHandler()):
            spec.loader.exec_module(remote)
        return remote

    def test_receptor_overwrite_replaces_after_success(self):
        remote = self.load_receptor()
        source = Path(self.settings['local_source_path']) / 'Film (2026).mkv'
        dst = self.existing_destination()
        comparison = remote.inspect_files(str(source), str(dst.parent), 'Film (2026)')
        task = remote.CopyTaskHandler('a', str(source), str(dst.parent), 'Film (2026)', True, comparison['fingerprint'])
        task.run()
        self.assertEqual(remote.TASKS['a']['status'], 'done')
        self.assertEqual(dst.read_bytes(), b'x')

    def test_receptor_cancel_overwrite_preserves_existing_file(self):
        remote = self.load_receptor()
        source = Path(self.settings['local_source_path']) / 'Film (2026).mkv'
        dst = self.existing_destination()
        comparison = remote.inspect_files(str(source), str(dst.parent), 'Film (2026)')
        task = remote.CopyTaskHandler('a', str(source), str(dst.parent), 'Film (2026)', True, comparison['fingerprint'])
        original = task._copy_file
        def cancel(src, target):
            original(src, target)
            remote.STOP_FLAGS.add('a')
        with patch.object(task, '_copy_file', side_effect=cancel):
            task.run()
        self.assertEqual(remote.TASKS['a']['status'], 'cancelled')
        self.assertEqual(dst.read_bytes(), b'old')
        self.assertFalse(list(dst.parent.glob('*.part')))

    def test_receptor_http_inspect_and_explicit_overwrite_protocol(self):
        from http.server import HTTPServer
        import requests
        remote = self.load_receptor()
        source = Path(self.settings['local_source_path']) / 'Film (2026).mkv'
        dst = self.existing_destination()
        server = HTTPServer(('127.0.0.1', 0), remote.ReceptorServer)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}'
        payload = {'task_id': 'a', 'source': str(source), 'destination': str(dst.parent), 'folder_name': 'Film (2026)'}
        try:
            result = requests.post(url + '/inspect', json=payload, timeout=3)
            self.assertEqual(result.status_code, 200)
            comparison = result.json()
            self.assertTrue(comparison['conflict'])
            self.assertEqual(requests.post(url + '/copy', json=payload, timeout=3).status_code, 409)
            self.assertEqual(requests.post(url + '/copy', json=dict(payload, overwrite=True), timeout=3).status_code, 409)
            with patch.object(remote, 'CopyTaskHandler') as task:
                response = requests.post(url + '/copy', json=dict(payload, overwrite=True, fingerprint=comparison['fingerprint']), timeout=3)
                self.assertEqual(response.status_code, 202)
                task.assert_called_once_with('a', str(source), str(dst.parent), 'Film (2026)', True, comparison['fingerprint'])
                task.return_value.start.assert_called_once()
            self.assertEqual(dst.read_bytes(), b'old')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)

    def test_batch_error_movie_returns_comparison_for_decision(self):
        import logic
        self.movie(status='error')
        with patch.object(logic, 'manual_move', return_value={'status': 'conflict', 'comparison': {'torrent_hash': 'a'}}):
            result = main.batch_copy_movies({'torrent_hashes': ['a']}, Mock())
        self.assertEqual(result['copied'], 0)
        self.assertEqual(result['conflicts'], [{'torrent_hash': 'a'}])


if __name__ == '__main__':
    unittest.main()
