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
from modules import mover, tmdb, config, automation, indexers, rss, client as torrent_client
import main
from copy_conflicts import inspect_files


class CopyControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.db = SqliteDatabase(str(self.base / 'history.db'))
        self.db.bind([database.Movie, database.MoveHistory, database.CopyJob, database.CopyQueueControl])
        self.db.create_tables([database.Movie, database.MoveHistory, database.CopyJob, database.CopyQueueControl])
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
        mover.QUEUE_PAUSED.clear()
        mover.COPY_PROGRESS.clear()
        mover.STOP_FLAGS.clear()
        mover.COPY_OUTPUTS.clear()
        mover.COPY_DIRECTORIES.clear()
        mover.COPY_REPLACEMENTS.clear()
        mover.COPY_WAITING.clear()
        mover.COPY_ACTIVE.clear()
        mover.COPY_NAMES.clear()

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
            self.assertEqual(process.call_count, 2)
            self.assertEqual(process.call_args.args, (None,))

    def test_auto_copy_survives_consumed_status_transition(self):
        self.movie(status='pending', progress=1)
        with patch.object(automation, 'manual_move') as move:
            tmdb.sync_movies([self.torrent()], 'test-key')
            move.assert_called_once_with('a', automatic=True)

    def test_existing_and_new_completions_enter_automatic_queue(self):
        self.settings.pop('copy_recovery_453_done')
        self.movie(status='downloading', progress=.5)
        self.movie('b', status='downloading', progress=.5)
        with patch.object(automation, 'manual_move', return_value={'success': True}) as move:
            tmdb.sync_movies([self.torrent(), self.torrent('b', .5, 'downloading')], 'key')
            move.assert_called_once_with('a', automatic=True)
            self.assertFalse(database.Movie.get_by_id(1).copy_paused)
            database.MoveHistory.create(torrent_name='Film (2026).mkv',source_path='',dest_path='',status='manual')
            # b uses a distinct torrent name for this test.
            movie_b=database.Movie.get(database.Movie.torrent_hash=='b'); movie_b.torrent_name='Second (2026).mkv'; movie_b.save()
            move.reset_mock()
            second=self.torrent('b'); second['name']='Second (2026).mkv'
            tmdb.sync_movies([self.torrent(), second], 'key')
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
        with patch.object(automation, 'manual_move') as move:
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
                task.assert_called_once_with('a', str(source), str(dst.parent), 'Film (2026)', True, comparison['fingerprint'], False, None)
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

    def test_queue_positions_follow_fifo_and_update_after_cancel(self):
        for hash in ('a', 'b', 'c', 'd'):
            self.movie(hash, status='pending', progress=1)
        entered = threading.Event()
        release = threading.Event()
        processed = []
        def process(qb, torrent, settings):
            processed.append(torrent.hash)
            if torrent.hash == 'a':
                entered.set()
                release.wait(3)
        qb = Mock()
        qb.torrents_info.side_effect = lambda torrent_hashes: [SimpleNamespace(**self.torrent(torrent_hashes))]
        with patch.object(mover, 'get_qb_client', return_value=qb), patch.object(mover, 'process_single_torrent', side_effect=process):
            try:
                mover.manual_move('a')
                self.assertTrue(entered.wait(2))
                for hash in ('b', 'c', 'd'):
                    mover.manual_move(hash)
                snapshot = mover.get_copy_progress()
                self.assertEqual([snapshot[h]['queue_position'] for h in ('b', 'c', 'd')], [1, 2, 3])
                self.assertEqual(snapshot['b']['queue_total'], 3)
                self.assertEqual(snapshot['b']['active_copy'], 'Film')
                snapshot['b']['status'] = 'changed'
                self.assertEqual(mover.COPY_PROGRESS['b']['status'], 'queued')
                mover.stop_copy('c')
                self.wait_for(lambda: 'c' not in mover.COPY_PROGRESS)
                self.assertEqual(mover.get_copy_progress()['d']['queue_position'], 2)
            finally:
                release.set()
            self.wait_for(lambda: not mover.COPY_PROGRESS)
        self.assertEqual(processed, ['a', 'b', 'd'])

    def test_worker_notifications_reach_server_event_loop(self):
        async def check():
            event = asyncio.Event()
            with patch.object(main, 'MOVIES_UPDATE_LOOP', asyncio.get_running_loop()), patch.object(main, 'MOVIES_UPDATE_EVENT', event):
                worker = threading.Thread(target=main.trigger_movies_broadcast)
                worker.start()
                worker.join(2)
                await asyncio.wait_for(event.wait(), 1)
                event.clear()
                token = main.IN_MOVIES_BROADCAST.set(True)
                try:
                    main.trigger_movies_broadcast()
                    await asyncio.sleep(0)
                    self.assertFalse(event.is_set())
                finally:
                    main.IN_MOVIES_BROADCAST.reset(token)
        asyncio.run(check())

    def test_completion_never_broadcasts_old_progress_after_final_snapshot(self):
        qb = Mock()
        qb.torrents_info.return_value = []
        snapshots = [{'a': {'status': 'copying', 'percent': 90}},
                     {'a': {'status': 'done', 'percent': 100}, 'b': {'status': 'copying', 'percent': 0}}]
        sleeps = 0
        async def sleep(_):
            nonlocal sleeps
            sleeps += 1
            if sleeps == 2:
                raise asyncio.CancelledError
        main.manager.active_connections.append(Mock())
        try:
            with patch.object(main, 'get_qb_client', return_value=qb), patch.object(main, 'get_copy_progress', side_effect=snapshots), \
                 patch.object(main, 'process_torrents'), patch.object(main, 'load_settings', return_value=self.settings), \
                 patch.object(main, 'broadcast_movies_update', new_callable=AsyncMock) as final, \
                 patch.object(main.manager, 'broadcast', new_callable=AsyncMock) as progress, \
                 patch.object(main.asyncio, 'sleep', side_effect=sleep):
                with self.assertRaises(asyncio.CancelledError):
                    asyncio.run(main.ws_progress_broadcast_task())
                final.assert_awaited_once()
                self.assertEqual(progress.await_count, 1)
                self.assertEqual(list(progress.call_args.args[0]['progress']), ['a'])
        finally:
            main.manager.active_connections.clear()

    def test_rss_placeholder_merges_with_real_torrent(self):
        real = self.movie(status='pending', year='2026', tmdb_id=10)
        placeholder = self.movie('rss', state='rss', status='new', year='2026', tmdb_id=10,
                                 rss_feed_name='Test feed', auto_copy_requested=True,
                                 status_reason='Torrent client did not respond')
        automation.reconcile_rss_movies([self.torrent()])
        self.assertIsNone(database.Movie.get_or_none(database.Movie.id == placeholder.id))
        saved = database.Movie.get_by_id(real.id)
        self.assertEqual(saved.rss_feed_name, 'Test feed')
        self.assertTrue(saved.auto_copy_requested)

    def test_reconciliation_preserves_ignored_rows_and_distinct_tmdb_ids(self):
        self.movie(status='pending', year='2026', tmdb_id=10)
        self.movie('ignored-rss', state='rss', year='2026', tmdb_id=10, ignored=True)
        self.movie('different-rss', state='rss', year='2026', tmdb_id=20)
        automation.reconcile_rss_movies([self.torrent()])
        self.assertEqual(database.Movie.select().count(), 3)

    def test_reconciliation_preserves_manual_hold_and_watchlist(self):
        self.movie(status='pending', year='2026', tmdb_id=10)
        self.movie('rss', state='rss', year='2026', tmdb_id=10, copy_paused=True,
                   copy_pause_reason='manual', watchlist=True)
        automation.reconcile_rss_movies([self.torrent()])
        real = database.Movie.get(database.Movie.torrent_hash == 'a')
        self.assertTrue(real.copy_paused)
        self.assertEqual(real.copy_pause_reason, 'manual')
        self.assertTrue(real.watchlist)

    def test_legacy_recovery_hold_is_released_for_eligible_pending_copy(self):
        self.movie(status='pending', progress=1, copy_paused=True)
        with patch.object(automation, 'manual_move', return_value={'success': True}) as move:
            automation.queue_completed_movies([self.torrent()], self.settings)
            move.assert_called_once_with('a', automatic=True)
        self.assertFalse(database.Movie.get(database.Movie.torrent_hash == 'a').copy_paused)

    def test_cancelled_history_never_auto_releases_legacy_hold(self):
        self.movie(status='pending', progress=1, copy_paused=True)
        database.MoveHistory.create(torrent_name='Film (2026).mkv',source_path='',dest_path='',status='cancelled')
        with patch.object(automation, 'manual_move') as move:
            automation.queue_completed_movies([self.torrent()], self.settings)
            move.assert_not_called()
        self.assertIn('manualmente', database.Movie.get(database.Movie.torrent_hash == 'a').status_reason)

    def test_feed_origin_queues_completed_movie_even_without_tags(self):
        self.movie(status='pending', progress=1, rss_feed_name='Feed')
        self.settings['rss_feeds']=[{'name':'Feed','auto_copy':True,'enabled':True}]
        torrent=self.torrent();torrent['tags']=''
        with patch.object(automation, 'manual_move', return_value={'success':True}) as move:
            automation.queue_completed_movies([torrent], self.settings)
            move.assert_called_once_with('a', automatic=True)

    def test_feed_disabled_does_not_queue_and_shows_reason(self):
        self.movie(status='pending', progress=1, rss_feed_name='Feed')
        self.settings['rss_feeds']=[{'name':'Feed','auto_copy':False}]
        with patch.object(automation, 'manual_move') as move:
            automation.queue_completed_movies([self.torrent()], self.settings)
            move.assert_not_called()
        self.assertIn('no está habilitada', database.Movie.get(database.Movie.torrent_hash == 'a').status_reason)

    def test_manual_admission_failure_is_visible_and_retryable(self):
        self.movie(status='pending', progress=1)
        with patch.object(automation, 'manual_move', return_value={'success':False,'message':'Receptor offline'}):
            automation.queue_completed_movies([self.torrent()], self.settings)
        saved=database.Movie.get(database.Movie.torrent_hash == 'a')
        self.assertEqual(saved.status_reason,'Receptor offline')
        self.assertFalse(saved.copy_paused)

    def test_first_seen_complete_torrent_is_queued_in_same_sync(self):
        self.settings['telegram_notify_on_new_movie']=False
        with patch.object(tmdb,'fetch_complete_movie_metadata',return_value={'title':'Film','year':'2026'}), \
             patch.object(automation,'manual_move',return_value={'success':True}) as move:
            tmdb.sync_movies([self.torrent()], 'key')
            move.assert_called_once_with('a', automatic=True)

    def test_completed_download_queues_without_tmdb_connection(self):
        with patch.object(automation,'manual_move',return_value={'success':True}) as move:
            tmdb.sync_movies([self.torrent()], None)
            move.assert_called_once_with('a', automatic=True)

    def test_reuses_existing_exact_torrent_instead_of_adding_again(self):
        existing={'hash':'a'*40,'name':'Film (2026).mkv'}
        qb=Mock();qb.torrents_info.return_value=[existing]
        release={'title':'Film (2026)','download_url':'magnet:?xt=urn:btih:'+'a'*40,'size_mb':1}
        with patch.object(indexers,'load_settings',return_value=self.settings), \
             patch.object(indexers,'search_indexers',return_value=[release]), \
             patch.object(indexers,'select_best_torrent',return_value=release), \
             patch.object(indexers,'get_qb_client',return_value=qb):
            result=indexers.auto_download_movie('Film','2026',1,2,label='films')
        self.assertEqual(result[0],'a'*40)
        qb.torrents_add.assert_not_called()
        qb.torrents_add_tags.assert_called_once()

    def test_never_assigns_unrelated_new_torrent_to_requested_movie(self):
        qb=Mock();qb.torrents_info.side_effect=[[]]+[[{'hash':'b'*40,'name':'Other (2025).mkv'}]]*15
        release={'title':'Film (2026)','download_url':'https://example.invalid/torrent','size_mb':1}
        with patch.object(indexers,'load_settings',return_value=self.settings), \
             patch.object(indexers,'search_indexers',return_value=[release]), \
             patch.object(indexers,'select_best_torrent',return_value=release), \
             patch.object(indexers,'get_qb_client',return_value=qb), patch.object(indexers.time,'sleep'):
            result=indexers.auto_download_movie('Film','2026',1,2)
        self.assertIsNone(result[0])
        self.assertIn('confirmación',result[2])

    def test_confirmation_detects_late_matching_torrent(self):
        qb=Mock();qb.torrents_info.side_effect=[[],[],[],[{'hash':'a'*40,'name':'Film (2026).mkv'}]]
        release={'title':'Film (2026)','download_url':'https://example.invalid/torrent','size_mb':1}
        with patch.object(indexers,'load_settings',return_value=self.settings), \
             patch.object(indexers,'search_indexers',return_value=[release]), \
             patch.object(indexers,'select_best_torrent',return_value=release), \
             patch.object(indexers,'get_qb_client',return_value=qb), patch.object(indexers.time,'sleep'):
            result=indexers.auto_download_movie('Film','2026',1,2)
        self.assertEqual(result[0],'a'*40)

    def test_rss_uncertain_addition_retries_and_updates_same_record(self):
        placeholder=self.movie('rss',state='rss',status='new',year='2026',status_reason='Torrent client did not respond')
        with patch.object(rss,'auto_download_movie',return_value=('a','Film (2026).mkv',None)):
            result=rss.retry_rss_confirmation(placeholder,{'name':'Feed','auto_add':True,'auto_copy':True})
        self.assertTrue(result)
        self.assertEqual(database.Movie.select().count(),1)
        saved=database.Movie.get_by_id(placeholder.id)
        self.assertEqual(saved.torrent_hash,'a')
        self.assertEqual(saved.state,'downloading')
        self.assertEqual(saved.rss_feed_name,'Feed')
        self.assertIsNone(saved.status_reason)

    def test_rss_confirmation_retries_merge_existing_real_record(self):
        real=self.movie(status='pending')
        placeholder=self.movie('rss',state='rss',status='new',year='2026',status_reason='Torrent client did not respond')
        with patch.object(rss,'auto_download_movie',return_value=('a','Film (2026).mkv',None)):
            rss.retry_rss_confirmation(placeholder,{'name':'Feed','auto_add':True,'auto_copy':True})
        self.assertEqual(database.Movie.select().count(),1)
        self.assertEqual(database.Movie.select().get().id,real.id)

    def test_migration_adds_feed_and_hold_reason_columns_without_losing_rows(self):
        self.movie(status='pending')
        for field in ('rss_feed_name','auto_copy_requested','copy_pause_reason'):
            self.db.execute_sql('ALTER TABLE movie DROP COLUMN '+field)
        with patch.object(database,'db',self.db):
            database.migrate_db()
            database.migrate_db()
        saved=database.Movie.get(database.Movie.torrent_hash=='a')
        self.assertFalse(saved.auto_copy_requested)
        self.assertIsNone(saved.copy_pause_reason)

    def test_complete_downloads_queue_in_order_without_any_browser(self):
        self.settings['tmdb_api_key']='key'
        for hash in ('a','b','c'):
            self.movie(hash,status='pending',progress=1)
        qb=Mock()
        def torrents(torrent_hashes=None):
            hashes=[torrent_hashes] if torrent_hashes else ['a','b','c']
            return [SimpleNamespace(**self.torrent(hash)) for hash in hashes]
        qb.torrents_info.side_effect=torrents
        entered=threading.Event();release=threading.Event()
        def process(qb,torrent,settings):
            if torrent.hash=='a':
                entered.set();release.wait(5)
        async def end_iteration(_):
            raise asyncio.CancelledError
        main.manager.active_connections.clear()
        with patch.object(main,'get_qb_client',return_value=qb), \
             patch.object(main,'load_settings',return_value=self.settings), \
             patch.object(torrent_client,'load_settings',return_value=self.settings), \
             patch.object(torrent_client,'get_qb_client',return_value=qb), \
             patch.object(mover,'get_qb_client',return_value=qb), \
             patch.object(mover,'process_single_torrent',side_effect=process), \
             patch.object(main.asyncio,'sleep',side_effect=end_iteration):
            try:
                with self.assertRaises(asyncio.CancelledError):
                    asyncio.run(main.ws_progress_broadcast_task())
                self.assertTrue(entered.wait(2))
                snapshot=mover.get_copy_progress()
                self.assertEqual(snapshot['a']['status'],'copying')
                self.assertEqual(snapshot['b']['queue_position'],1)
                self.assertEqual(snapshot['c']['queue_position'],2)
            finally:
                release.set()
            self.wait_for(lambda:not mover.COPY_PROGRESS)

    def saved_job(self, hash='a', remote=False):
        torrent=SimpleNamespace(**self.torrent(hash))
        comparison=mover.inspect_torrent_copy(torrent,self.settings)
        options=dict(self.settings, _stage_all=True,
                     _copy_destinations=[row['destination']['path'] for row in comparison['files']],
                     _copy_fingerprint=comparison['fingerprint'])
        if remote:
            options.update(receptor_enabled=True,receptor_host='127.0.0.1',receptor_port=8095)
        return mover.save_copy_job(torrent,options)

    def reset_queue_memory(self):
        mover.COPY_PROGRESS.clear();mover.COPY_WAITING.clear();mover.COPY_ACTIVE.clear()
        mover.COPY_NAMES.clear();mover.STOP_FLAGS.clear()
        mover.COPY_OUTPUTS.clear();mover.COPY_REPLACEMENTS.clear();mover.COPY_DIRECTORIES.clear()

    def test_persistent_queue_restores_saved_order_and_deduplicates(self):
        for hash in ('a','b','c'):
            self.movie(hash,status='pending',progress=1)
            self.saved_job(hash)
        self.db.close()
        with patch.object(mover.threading,'Thread') as worker:
            self.assertEqual(mover.recover_copy_jobs(),3)
            self.assertEqual(mover.COPY_WAITING,['a','b','c'])
            self.assertEqual(mover.get_copy_progress()['c']['queue_position'],3)
            self.assertEqual(mover.recover_copy_jobs(),0)
            self.assertEqual(worker.call_count,3)

    def test_persistent_jobs_never_store_credentials(self):
        self.settings.update(qb_pass='do-not-save',telegram_bot_token='do-not-save')
        job=self.saved_job()
        self.assertNotIn('do-not-save',job.options_json)
        self.assertNotIn('qb_pass',job.options_json)

    def test_cancelled_waiting_job_does_not_return_after_restart(self):
        self.movie(status='pending',progress=1)
        job=self.saved_job()
        mover.register_copy_job(job)
        mover.stop_copy('a')
        self.assertEqual(database.CopyJob.get_by_id(job.id).state,'cancelled')
        self.reset_queue_memory();self.db.close()
        self.assertEqual(mover.recover_copy_jobs(),0)
        self.assertFalse(mover.COPY_PROGRESS)

    def test_active_remote_job_reattaches_without_starting_another_copy(self):
        self.movie(status='pending',progress=1)
        job=self.saved_job(remote=True)
        database.CopyJob.update(state='running').where(database.CopyJob.id==job.id).execute()
        job=database.CopyJob.get_by_id(job.id);mover.register_copy_job(job)
        first=Mock(status_code=200);first.json.return_value={'status':'copying','percent':50}
        done=Mock(status_code=200);done.json.return_value={'status':'done'}
        with patch.object(mover.requests,'get',side_effect=[first,done]), \
             patch.object(mover.requests,'post') as post, patch.object(mover,'process_single_torrent') as start, \
             patch.object(mover.time,'sleep'):
            mover.run_copy_job(job.id)
            post.assert_not_called();start.assert_not_called()
        self.assertEqual(database.CopyJob.get_by_id(job.id).state,'completed')

    def test_remote_recovery_keeps_other_movies_waiting_while_unreachable(self):
        import requests
        self.movie(status='pending',progress=1);self.movie('b',status='pending',progress=1)
        job=self.saved_job(remote=True);other=self.saved_job('b')
        database.CopyJob.update(state='running').where(database.CopyJob.id==job.id).execute()
        with patch.object(mover.threading,'Thread'):
            mover.recover_copy_jobs()
        copying=Mock(status_code=200);copying.json.return_value={'status':'copying'}
        done=Mock(status_code=200);done.json.return_value={'status':'done'}
        events=[requests.Timeout('offline'),copying,done]
        def status(*args,**kwargs):
            self.assertEqual(mover.COPY_ACTIVE,{'a'})
            self.assertEqual(mover.COPY_WAITING,['b'])
            event=events.pop(0)
            if isinstance(event,Exception):raise event
            return event
        with patch.object(mover.requests,'get',side_effect=status), patch.object(mover.time,'sleep'), \
             patch.object(mover,'process_single_torrent') as start:
            mover.run_copy_job(job.id)
            start.assert_not_called()
        self.assertEqual(database.CopyJob.get_by_id(other.id).state,'queued')
        self.assertEqual(mover.get_copy_progress()['b']['queue_position'],1)

    def test_stop_request_for_active_remote_job_survives_restart(self):
        self.movie(status='pending',progress=1)
        job=self.saved_job(remote=True)
        database.CopyJob.update(state='running',stop_requested=True).where(database.CopyJob.id==job.id).execute()
        job=database.CopyJob.get_by_id(job.id);mover.register_copy_job(job)
        copying=Mock(status_code=200);copying.json.return_value={'status':'copying'}
        cancelled=Mock(status_code=200);cancelled.json.return_value={'status':'cancelled'}
        response=Mock(status_code=200)
        with patch.object(mover.requests,'get',side_effect=[copying,cancelled]), \
             patch.object(mover.requests,'post',return_value=response) as stop, patch.object(mover.time,'sleep'):
            mover.run_copy_job(job.id)
            stop.assert_called_once()
        self.assertEqual(database.CopyJob.get_by_id(job.id).state,'cancelled')

    def test_queue_pause_blocks_admission_and_is_persisted(self):
        self.movie(status='pending',progress=1)
        job=self.saved_job()
        mover.set_copy_queue_paused(True)
        entered=threading.Event()
        def worker():
            try:
                with mover.copy_turn('a'):entered.set()
            finally:database.Movie._meta.database.close()
        mover.register_copy_job(job)
        thread=threading.Thread(target=worker)
        thread.start()
        try:
            self.assertFalse(entered.wait(.15))
            self.assertTrue(database.CopyQueueControl.get_by_id(1).paused)
            snapshot=mover.get_copy_queue_snapshot()
            self.assertTrue(snapshot['paused'])
            self.assertEqual(snapshot['entries'][0]['queue_position'],1)
            mover.set_copy_queue_paused(False)
            self.assertTrue(entered.wait(2))
        finally:
            mover.QUEUE_PAUSED.clear()
            with mover.COPY_CONDITION:mover.COPY_CONDITION.notify_all()
            thread.join(timeout=3)

    def test_pause_active_local_copy_preserves_partial_and_resumes(self):
        self.movie(status='pending',progress=1)
        source=Path(self.settings['local_source_path'])/'Film (2026).mkv'
        source.write_bytes(b'x'*(3*1024*1024))
        self.settings['copy_speed_limit']=2
        with self.fake_qb():
            mover.manual_move('a')
            self.wait_for(lambda:bool(list(Path(self.settings['local_dest_path']).rglob('*.part'))))
            mover.set_copy_queue_paused(True)
            try:
                self.wait_for(lambda:mover.COPY_PROGRESS.get('a',{}).get('phase')=='paused')
                partial=next(Path(self.settings['local_dest_path']).rglob('*.part'))
                size=partial.stat().st_size
                time.sleep(.15)
                self.assertEqual(partial.stat().st_size,size)
                self.assertGreater(size,0)
                self.assertFalse(partial.with_name('Film (2026).mkv').exists())
                self.assertEqual(mover.get_copy_queue_snapshot()['entries'][0]['phase'],'paused')
            finally:mover.set_copy_queue_paused(False)
            self.wait_for(lambda:not mover.COPY_PROGRESS)
        destination=Path(self.settings['local_dest_path'])/'Film (2026)'/'Film (2026).mkv'
        self.assertEqual(destination.read_bytes(),source.read_bytes())
        self.assertEqual(database.CopyJob.get(database.CopyJob.torrent_hash=='a').state,'completed')

    def test_stop_remains_responsive_while_local_copy_is_paused(self):
        self.movie(status='pending',progress=1)
        source=Path(self.settings['local_source_path'])/'Film (2026).mkv'
        source.write_bytes(b'x'*(3*1024*1024))
        self.settings['copy_speed_limit']=2
        with self.fake_qb():
            mover.manual_move('a')
            self.wait_for(lambda:bool(list(Path(self.settings['local_dest_path']).rglob('*.part'))))
            mover.set_copy_queue_paused(True)
            try:
                self.wait_for(lambda:mover.COPY_PROGRESS.get('a',{}).get('phase')=='paused')
                mover.stop_copy('a')
                self.wait_for(lambda:not mover.COPY_PROGRESS)
                self.assertFalse(list(Path(self.settings['local_dest_path']).rglob('*.part')))
                self.assertEqual(database.CopyJob.get(database.CopyJob.torrent_hash=='a').state,'cancelled')
            finally:mover.set_copy_queue_paused(False)

    def test_priority_changes_memory_and_saved_fifo_order(self):
        for hash_value in ('a','b','c'):
            self.movie(hash_value,status='pending',progress=1)
            mover.register_copy_job(self.saved_job(hash_value))
        snapshot=mover.change_copy_priority('c','first')
        self.assertEqual(mover.COPY_WAITING,['c','a','b'])
        self.assertEqual([entry['torrent_hash'] for entry in snapshot['entries']],['c','a','b'])
        self.assertEqual([job.torrent_hash for job in database.CopyJob.select().order_by(database.CopyJob.queue_order)],['c','a','b'])
        mover.change_copy_priority('a','down')
        self.assertEqual(mover.COPY_WAITING,['c','b','a'])
        mover.COPY_ACTIVE.add('c')
        with self.assertRaises(ValueError):mover.change_copy_priority('c','down')
        mover.COPY_ACTIVE.clear()
        with self.assertRaises(ValueError):mover.change_copy_priority('missing','first')

    def test_pause_and_priority_survive_independent_process_restart(self):
        import subprocess
        for hash_value in ('a','b','c'):
            self.movie(hash_value,status='pending',progress=1)
            mover.register_copy_job(self.saved_job(hash_value))
        mover.change_copy_priority('c','first')
        mover.set_copy_queue_paused(True)
        self.reset_queue_memory()
        self.db.close()
        script="""import sys,time
sys.path.insert(0,sys.argv[2])
import database
from peewee import SqliteDatabase
db=SqliteDatabase(sys.argv[1]);db.bind([database.Movie,database.MoveHistory,database.CopyJob,database.CopyQueueControl])
from modules import mover
mover.load_settings=lambda:{}
mover.recover_copy_jobs()
time.sleep(.2)
assert mover.QUEUE_PAUSED.is_set()
assert not mover.COPY_ACTIVE
assert mover.COPY_WAITING==['c','a','b'],mover.COPY_WAITING
assert all(job.state=='queued' for job in database.CopyJob.select())
assert mover.get_copy_queue_snapshot()['paused']
print('PAUSED_ORDER_RESTORED')
"""
        child=subprocess.run([sys.executable,'-c',script,self.db.database,str(ROOT/'app')],capture_output=True,text=True,timeout=10)
        self.assertEqual(child.returncode,0,child.stderr)
        self.assertIn('PAUSED_ORDER_RESTORED',child.stdout)
        mover.set_copy_queue_paused(False)

    def test_paused_order_restores_without_dispatch_after_restart(self):
        for hash_value in ('a','b','c'):
            self.movie(hash_value,status='pending',progress=1)
            mover.register_copy_job(self.saved_job(hash_value))
        mover.change_copy_priority('c','first')
        mover.set_copy_queue_paused(True)
        self.reset_queue_memory()
        mover.QUEUE_PAUSED.clear()
        with patch.object(mover.threading,'Thread') as spawn:
            mover.recover_copy_jobs()
        self.assertTrue(mover.QUEUE_PAUSED.is_set())
        self.assertEqual(mover.COPY_WAITING,['c','a','b'])
        self.assertEqual(spawn.call_count,3)
        mover.set_copy_queue_paused(False)

    def test_queue_snapshot_exposes_eta_but_not_saved_options(self):
        self.movie(status='pending',progress=1)
        job=self.saved_job()
        mover.register_copy_job(job)
        mover.COPY_ACTIVE.add('a')
        mover.COPY_WAITING.remove('a')
        mover.COPY_PROGRESS['a'].update(status='copying',percent=25,speed=2,file_size=8*1024*1024,copied_bytes=2*1024*1024)
        snapshot=mover.get_copy_queue_snapshot()
        self.assertEqual(snapshot['entries'][0]['eta_seconds'],3)
        self.assertNotIn('options_json',str(snapshot))
        mover.COPY_PROGRESS['a']['phase']='verifying'
        self.assertIsNone(mover.get_copy_queue_snapshot()['entries'][0]['eta_seconds'])
        mover.COPY_ACTIVE.clear()

    def test_pause_racing_remote_completion_does_not_block_final_status(self):
        self.movie(status='pending',progress=1)
        torrent=SimpleNamespace(**self.torrent('a'))
        mover.QUEUE_PAUSED.set()
        finished=Mock(status_code=200)
        finished.json.return_value={'status':'done'}
        inactive=Mock(status_code=404)
        inactive.raise_for_status.side_effect=AssertionError('Read final status instead of rejecting an inactive pause')
        with patch.object(mover.requests,'post',return_value=inactive),patch.object(mover.requests,'get',return_value=finished),patch.object(mover.time,'sleep'):
            mover._poll_receptor_status(torrent,'localhost',8095,'src','dst',self.settings,'Film','2026')
        self.assertEqual(database.MoveHistory.select().get().status,'success')
        mover.QUEUE_PAUSED.clear()

    def test_queue_controls_reject_bad_payloads_and_old_active_receptor(self):
        self.assertFalse(main.pause_copy_queue_endpoint({'paused':'yes'})['success'])
        self.assertFalse(main.prioritize_copy_endpoint({'torrent_hash':'a','direction':'bad'})['success'])
        self.movie(status='pending',progress=1)
        job=self.saved_job(remote=True)
        mover.COPY_ACTIVE.add('a')
        old=Mock(status_code=200)
        old.json.return_value={'version':'4.5.12'}
        with patch.object(mover.requests,'get',return_value=old):
            result=main.pause_copy_queue_endpoint({'paused':True})
        self.assertFalse(result['success'])
        self.assertIn('4.5.13',result['message'])
        self.assertFalse(mover.QUEUE_PAUSED.is_set())
        mover.COPY_ACTIVE.clear()

    def test_activity_tolerates_an_unreadable_terminal_job(self):
        self.movie(status='pending',progress=1)
        job=self.saved_job()
        database.CopyJob.update(state='error',torrent_json='broken json').where(database.CopyJob.id==job.id).execute()
        snapshot=mover.get_copy_queue_snapshot()
        self.assertEqual(snapshot['recent'][0]['torrent_hash'],'a')

    def test_stopped_paused_remote_task_does_not_send_another_pause(self):
        self.movie(status='pending',progress=1)
        torrent=SimpleNamespace(**self.torrent('a'))
        mover.QUEUE_PAUSED.set()
        mover.STOP_FLAGS.add('a')
        response=Mock(status_code=200)
        response.json.return_value={'status':'cancelled'}
        with patch.object(mover.requests,'post',return_value=Mock(status_code=200)) as control,patch.object(mover.requests,'get',return_value=response):
            mover._poll_receptor_status(torrent,'localhost',8095,'src','dst',self.settings,'Film','2026')
        self.assertEqual(control.call_count,1)
        self.assertTrue(control.call_args.args[0].endswith('/stop/a'))
        mover.QUEUE_PAUSED.clear()

    def test_resume_space_reservation_credits_existing_owned_partial(self):
        source=Path(self.settings['local_source_path'])/'Film (2026).mkv'
        source.write_bytes(b'x'*100)
        with patch.object(mover,'get_disk_free_space',return_value=60):
            ok,_,details=mover.check_and_reserve_disk_space(str(source),self.settings['local_dest_path'],safety_buffer_percent=0,min_buffer_mb=0,existing_bytes=50)
        self.assertTrue(ok)
        self.assertEqual(details['required_bytes'],50)
        mover.release_disk_space_reservation(self.settings['local_dest_path'],50)

    def test_failed_cleanup_remains_persisted_until_retry_succeeds(self):
        self.movie(status='pending',progress=1)
        job=self.saved_job()
        database.CopyJob.update(state='running',stop_requested=True).where(database.CopyJob.id==job.id).execute()
        job=database.CopyJob.get_by_id(job.id)
        mover.register_copy_job(job)
        with patch.object(mover,'discard_local_job_temporaries',side_effect=PermissionError('file busy')):
            mover.run_copy_job(job.id)
        self.assertEqual(database.CopyJob.get_by_id(job.id).state,'running')
        job=database.CopyJob.get_by_id(job.id)
        mover.register_copy_job(job)
        with patch.object(mover,'discard_local_job_temporaries') as cleanup:
            mover.run_copy_job(job.id)
            cleanup.assert_called_once()
        self.assertEqual(database.CopyJob.get_by_id(job.id).state,'cancelled')

    def test_stopping_failed_resumable_local_job_cleans_saved_partial(self):
        from verified_copy import prepare_resume
        self.movie(status='error',progress=1)
        job=self.saved_job()
        import json
        options=json.loads(job.options_json)
        options['_verification_required']=True
        database.CopyJob.update(state='error',options_json=json.dumps(options)).where(database.CopyJob.id==job.id).execute()
        source=Path(self.settings['local_source_path'])/'Film (2026).mkv'
        destination=Path(self.settings['local_dest_path'])/'Film (2026)'/'Film (2026).mkv'
        destination.parent.mkdir(parents=True)
        partial=str(destination)+'.roverr-a.part'
        prepare_resume(str(source),partial,str(destination),'a',lambda:None)
        Path(partial).write_bytes(b'')
        mover.stop_copy('a')
        self.wait_for(lambda:not mover.COPY_PROGRESS)
        self.assertFalse(Path(partial).exists())
        self.assertFalse(Path(partial+'.json').exists())
        self.assertEqual(database.CopyJob.get_by_id(job.id).state,'cancelled')

    def test_saved_remote_stop_cleans_partial_even_when_receptor_restarted(self):
        import json
        self.movie(status='error',progress=1)
        job=self.saved_job(remote=True)
        options=json.loads(job.options_json)
        options['_verification_required']=True
        database.CopyJob.update(state='running',stop_requested=True,options_json=json.dumps(options)).where(database.CopyJob.id==job.id).execute()
        job=database.CopyJob.get_by_id(job.id)
        mover.register_copy_job(job)
        not_found=Mock(status_code=404)
        cleaned=Mock(status_code=200)
        with patch.object(mover.requests,'get',return_value=not_found),patch.object(mover.requests,'post',return_value=cleaned) as cleanup:
            mover.run_copy_job(job.id)
        self.assertTrue(cleanup.call_args.args[0].endswith('/cleanup'))
        self.assertEqual(cleanup.call_args.kwargs['json']['files'],options['_copy_destinations'])
        self.assertEqual(database.CopyJob.get_by_id(job.id).state,'cancelled')

    def test_new_remote_attempt_ignores_old_terminal_response(self):
        self.movie(status='pending',progress=1)
        job=self.saved_job(remote=True)
        torrent=SimpleNamespace(**self.torrent('a'))
        settings=dict(self.settings,receptor_enabled=True,receptor_host='127.0.0.1',_copy_attempt_id='new')
        mover.COPY_PROGRESS['a']={'status':'copying'}
        for state in ('done','error','cancelled'):
            response=Mock(status_code=200)
            response.json.return_value={'status':state,'attempt_id':'old'}
            with patch.object(mover.requests,'get',return_value=response), patch.object(mover,'_poll_receptor_status') as polling:
                self.assertFalse(mover.recover_remote_copy(torrent,settings))
                polling.assert_not_called()

    def test_unverified_remote_completion_is_not_recorded_as_success(self):
        self.movie(status='pending',progress=1)
        torrent=SimpleNamespace(**self.torrent('a'))
        response=Mock(status_code=200)
        response.json.return_value={'status':'done','attempt_id':'new','verified':False}
        with patch.object(mover.requests,'get',return_value=response):
            mover._poll_receptor_status(torrent,'localhost',8095,'src','dst',dict(self.settings,_verification_required=True,_copy_attempt_id='new'),'Film','2026')
        self.assertEqual(database.MoveHistory.select().get().status,'error')

    def test_restored_local_job_resumes_valid_partial(self):
        from verified_copy import prepare_resume
        self.movie(status='pending',progress=1)
        source=Path(self.settings['local_source_path'])/'Film (2026).mkv'
        source.write_bytes(b'complete-source'*1000)
        job=self.saved_job()
        destination=Path(self.settings['local_dest_path'])/'Film (2026)'/'Film (2026).mkv'
        destination.parent.mkdir(parents=True)
        temporary=str(destination)+'.roverr-a.part'
        prepare_resume(str(source),temporary,str(destination),'a',lambda:None)
        Path(temporary).write_bytes(source.read_bytes()[:4000])
        mover.register_copy_job(job)
        original=mover.verify_copy
        observed=[]
        def verified(*args):
            observed.append(mover.COPY_PROGRESS['a']['resumed_bytes'])
            return original(*args)
        with patch.object(mover,'verify_copy',side_effect=verified):mover.run_copy_job(job.id)
        self.assertEqual(observed,[4000])
        self.assertEqual(destination.read_bytes(),source.read_bytes())
        self.assertEqual(database.CopyJob.get_by_id(job.id).state,'completed')

    def test_interrupted_local_job_restarts_temporary_file_and_finishes(self):
        self.movie(status='pending',progress=1)
        source=Path(self.settings['local_source_path'])/'Film (2026).mkv'
        source.write_bytes(b'complete-source')
        job=self.saved_job()
        database.CopyJob.update(state='running').where(database.CopyJob.id==job.id).execute()
        destination=Path(self.settings['local_dest_path'])/'Film (2026)'/'Film (2026).mkv'
        destination.parent.mkdir(parents=True)
        temporary=Path(str(destination)+'.roverr-a.part');temporary.write_bytes(b'partial')
        mover.register_copy_job(database.CopyJob.get_by_id(job.id))
        with patch.object(mover,'get_qb_client',side_effect=AssertionError('Recovery must use saved source, not require qBittorrent')):
            mover.run_copy_job(job.id)
        self.assertEqual(destination.read_bytes(),source.read_bytes())
        self.assertFalse(temporary.exists())
        self.assertEqual(database.CopyJob.get_by_id(job.id).state,'completed')

    def test_restored_job_preserves_destination_changed_while_stopped(self):
        self.movie(status='pending',progress=1)
        job=self.saved_job();destination=self.existing_destination(b'new external file')
        mover.register_copy_job(job)
        with patch.object(mover,'process_single_torrent') as start:
            mover.run_copy_job(job.id)
            start.assert_not_called()
        self.assertEqual(destination.read_bytes(),b'new external file')
        self.assertEqual(database.CopyJob.get_by_id(job.id).state,'error')
        self.assertEqual(database.Movie.get(database.Movie.torrent_hash=='a').copy_pause_reason,'conflict')

    def test_completed_history_recovers_crash_before_job_completion_commit(self):
        self.movie(status='pending',progress=1)
        job=self.saved_job(remote=True)
        database.CopyJob.update(state='running').where(database.CopyJob.id==job.id).execute()
        database.MoveHistory.create(torrent_name='Film (2026).mkv',source_path='',dest_path='',status='success',copy_job_id=job.id)
        mover.register_copy_job(database.CopyJob.get_by_id(job.id))
        with patch.object(mover.requests,'get') as status, patch.object(mover,'process_single_torrent') as start:
            mover.run_copy_job(job.id)
            status.assert_not_called();start.assert_not_called()
        self.assertEqual(database.CopyJob.get_by_id(job.id).state,'completed')

    def test_receptor_stages_normal_copy_until_final_commit(self):
        remote=self.load_receptor()
        source=Path(self.settings['local_source_path'])/'Film (2026).mkv'
        destination=Path(self.settings['local_dest_path'])/'Film (2026)'/'Film (2026).mkv'
        info=remote.inspect_files(str(source),str(destination.parent),'Film (2026)')
        task=remote.CopyTaskHandler('a',str(source),str(destination.parent),'Film (2026)',False,info['fingerprint'],True)
        original=task._copy_file
        def staged(*args):
            original(*args)
            self.assertFalse(destination.exists())
            self.assertTrue(list(destination.parent.glob('*.part')))
        with patch.object(task,'_copy_file',side_effect=staged):task.run()
        self.assertEqual(remote.TASKS['a']['status'],'done')
        self.assertEqual(destination.read_bytes(),source.read_bytes())

    def test_valid_partial_resumes_after_independent_process_restore(self):
        import subprocess
        from verified_copy import prepare_resume
        self.movie(status='pending',progress=1)
        source=Path(self.settings['local_source_path'])/'Film (2026).mkv'
        source.write_bytes(b'resume-after-restart'*5000)
        job=self.saved_job()
        database.CopyJob.update(state='running').where(database.CopyJob.id==job.id).execute()
        destination=Path(self.settings['local_dest_path'])/'Film (2026)'/'Film (2026).mkv'
        destination.parent.mkdir(parents=True)
        temporary=str(destination)+'.roverr-a.part'
        prepare_resume(str(source),temporary,str(destination),'a',lambda:None)
        Path(temporary).write_bytes(source.read_bytes()[:32768])
        self.db.close()
        script="""import sys,time
sys.path.insert(0,sys.argv[2])
import database
from peewee import SqliteDatabase
db=SqliteDatabase(sys.argv[1]);db.bind([database.Movie,database.MoveHistory,database.CopyJob,database.CopyQueueControl])
from modules import mover
mover.load_settings=lambda:{'telegram_notify_on_move':False}
original=mover.verify_copy
observed=[]
def verify(*args):
    observed.append(mover.COPY_PROGRESS['a']['resumed_bytes'])
    return original(*args)
mover.verify_copy=verify
mover.recover_copy_jobs()
deadline=time.monotonic()+10
while mover.COPY_PROGRESS and time.monotonic()<deadline:time.sleep(.05)
assert not mover.COPY_PROGRESS
assert observed==[32768],observed
assert database.CopyJob.select().get().state=='completed'
db.close()
print('RESUMED_AND_VERIFIED')
"""
        child=subprocess.run([sys.executable,'-c',script,self.db.database,str(ROOT/'app')],capture_output=True,text=True,timeout=20)
        self.assertEqual(child.returncode,0,child.stderr)
        self.assertIn('RESUMED_AND_VERIFIED',child.stdout)
        self.assertEqual(destination.read_bytes(),source.read_bytes())

    def test_persistent_local_job_restores_from_an_independent_process(self):
        import subprocess
        self.movie(status='pending',progress=1)
        job=self.saved_job()
        database.CopyJob.update(state='running').where(database.CopyJob.id==job.id).execute()
        self.db.close()
        script='''import sys,time
sys.path.insert(0,sys.argv[2])
import database
from peewee import SqliteDatabase
db=SqliteDatabase(sys.argv[1])
db.bind([database.Movie,database.MoveHistory,database.CopyJob,database.CopyQueueControl])
from modules import mover
mover.load_settings=lambda:{'telegram_notify_on_move':False}
mover.recover_copy_jobs()
deadline=time.monotonic()+10
while mover.COPY_PROGRESS and time.monotonic()<deadline:time.sleep(.05)
assert not mover.COPY_PROGRESS
assert database.CopyJob.select().get().state=='completed'
db.close()
print('RECOVERED')
'''
        child=subprocess.run([sys.executable,'-c',script,self.db.database,str(ROOT/'app')],capture_output=True,text=True,timeout=20)
        self.assertEqual(child.returncode,0,child.stderr)
        self.assertIn('RECOVERED',child.stdout)
        destination=Path(self.settings['local_dest_path'])/'Film (2026)'/'Film (2026).mkv'
        self.assertEqual(destination.read_bytes(),b'x')
        self.assertEqual(database.CopyJob.get_by_id(job.id).state,'completed')

    def test_migration_adds_job_history_link_without_losing_old_history(self):
        database.MoveHistory.create(torrent_name='Old film',source_path='',dest_path='',status='success')
        self.db.execute_sql('ALTER TABLE movehistory DROP COLUMN copy_job_id')
        with patch.object(database,'db',self.db):database.migrate_db()
        row=database.MoveHistory.select().get()
        self.assertEqual(row.torrent_name,'Old film')
        self.assertIsNone(row.copy_job_id)

    def test_history_for_another_job_cannot_complete_restored_job(self):
        self.movie(status='pending',progress=1)
        job=self.saved_job()
        database.MoveHistory.create(torrent_name='Film (2026).mkv',source_path='',dest_path='',status='success',copy_job_id=job.id+100)
        mover.register_copy_job(job)
        with patch.object(mover,'process_single_torrent') as start:
            mover.run_copy_job(job.id)
            start.assert_called_once()


if __name__ == '__main__':
    unittest.main()
