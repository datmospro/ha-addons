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
        def cancel_after_first(*args):
            original(*args)
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


if __name__ == '__main__':
    unittest.main()
