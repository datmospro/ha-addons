import datetime
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from peewee import SqliteDatabase
from database import Movie, MoveHistory
from modules import search_downloads as search
import main

HASH='a'*40
RELEASE='La película (2026) [1080p].mkv'

class SearchDownloadsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.db=SqliteDatabase(str(Path(self.temp.name)/'history.db'))
        self.db.bind([Movie,MoveHistory]);self.db.create_tables([Movie,MoveHistory])
        self.movie=Movie.create(torrent_hash=HASH,title='La película',year='2026',tmdb_id=42,
                                ignored=True,ignored_at=datetime.datetime.now(),torrent_name=RELEASE,
                                copy_paused=True,copy_pause_reason='conflict')
        self.qb=Mock();self.qb.torrents_info.return_value=[];self.qb.torrents_add.return_value='Ok.'
        self.payload={'url':'magnet:?xt=urn:btih:'+HASH,'title':RELEASE,
                      'movie_title':'La película','movie_year':'2026','tmdb_id':42}
        self.sleep=patch.object(search.time,'sleep');self.sleep.start()
    def tearDown(self):
        self.sleep.stop();self.db.close();self.temp.cleanup()
    def run_download(self,**changes):
        return search.download_requested({**self.payload,**changes},self.qb,True,'manual-search')
    def test_ignored_download_requires_explicit_action_before_contacting_client(self):
        for consent in (None,False,'true',1):
            result=self.run_download(restore_ignored=consent)
            self.assertEqual(result['status'],'ignored')
        self.qb.auth_log_in.assert_not_called();self.qb.torrents_add.assert_not_called()
        self.assertTrue(Movie.get_by_id(self.movie.id).ignored)
    def test_restore_existing_torrent_keeps_history_and_copy_decisions(self):
        self.qb.torrents_info.return_value=[{'hash':HASH,'name':RELEASE,'added_on':1}]
        MoveHistory.create(torrent_name=RELEASE,status='success',source_path='source',dest_path='keep')
        result=self.run_download(restore_ignored=True)
        self.assertEqual(result['hash'],HASH);self.assertEqual(result['restored'],1)
        restored=Movie.get_by_id(self.movie.id)
        self.assertFalse(restored.ignored);self.assertIsNone(restored.ignored_at)
        self.assertTrue(restored.copy_paused);self.assertEqual(restored.copy_pause_reason,'conflict')
        self.assertEqual(MoveHistory.select().count(),1)
        self.qb.torrents_add.assert_not_called()
        self.qb.torrents_add_tags.assert_called_once_with(torrent_hashes=HASH,tags='manual-search')
    def test_failed_client_add_does_not_restore(self):
        self.qb.torrents_add.side_effect=ConnectionError()
        with self.assertRaises(ConnectionError):self.run_download(restore_ignored=True)
        self.assertTrue(Movie.get_by_id(self.movie.id).ignored)
    def test_rejected_torrent_does_not_restore(self):
        self.qb.torrents_add.return_value='Fails.'
        self.assertFalse(self.run_download(restore_ignored=True)['success'])
        self.assertTrue(Movie.get_by_id(self.movie.id).ignored)
    def test_client_login_failure_does_not_restore(self):
        self.qb.auth_log_in.side_effect=ConnectionError()
        with self.assertRaises(ConnectionError):self.run_download(restore_ignored=True)
        self.assertTrue(Movie.get_by_id(self.movie.id).ignored)
    def test_restores_all_ignored_versions_of_same_movie_only(self):
        second=Movie.create(torrent_hash='b'*40,title='Otro idioma',year='2026',tmdb_id=42,ignored=True)
        remake=Movie.create(torrent_hash='c'*40,title='La película',year='2026',tmdb_id=99,ignored=True)
        result=self.run_download(restore_ignored=True)
        self.assertEqual(result['restored'],2)
        self.assertFalse(Movie.get_by_id(second.id).ignored);self.assertTrue(Movie.get_by_id(remake.id).ignored)
    def test_fallback_requires_title_and_year_and_normalizes_accents(self):
        self.movie.tmdb_id=None;self.movie.save()
        self.assertTrue(search.ignored_matches('La pelicula','2026',42))
        self.assertFalse(search.ignored_matches('La pelicula','2025',42))
        self.assertFalse(search.ignored_matches('La pelicula',None,42))
        self.assertFalse(search.ignored_matches('Otra pelicula','2026',42))
    def test_unrelated_recent_torrent_never_becomes_requested_hash(self):
        self.qb.torrents_info.return_value=[{'hash':'b'*40,'name':RELEASE,'added_on':9999999999}]
        result=self.run_download(restore_ignored=True)
        self.assertTrue(result['success']);self.assertIsNone(result['hash'])
        self.assertTrue(result['pending_confirmation']);self.assertFalse(Movie.get_by_id(self.movie.id).ignored)
    def test_late_confirmation_uses_exact_hash(self):
        self.qb.torrents_info.side_effect=[[],[{'hash':'b'*40,'name':'Unrelated'}],[{'hash':HASH,'name':RELEASE}]]
        self.assertEqual(self.run_download(restore_ignored=True)['hash'],HASH)
    def test_auto_copy_setting_is_respected(self):
        self.qb.torrents_info.return_value=[{'hash':HASH,'name':RELEASE}]
        result=search.download_requested({**self.payload,'restore_ignored':True},self.qb,False,'manual-search')
        self.assertTrue(result['success']);self.qb.torrents_add_tags.assert_not_called()
    def test_nonignored_download_needs_no_restore(self):
        self.movie.ignored=False;self.movie.save()
        self.qb.torrents_info.side_effect=[[],[{'hash':HASH,'name':RELEASE}]]
        result=self.run_download()
        self.assertTrue(result['success']);self.assertEqual(result['restored'],0)
        self.qb.torrents_add.assert_called_once_with(urls=self.payload['url'],tags='manual-search')
    def test_tmdb_results_are_annotated_without_restoring(self):
        response=Mock(status_code=200)
        response.json.return_value={'results':[{'id':42,'title':'La película','release_date':'2026-01-01'},
                                              {'id':99,'title':'La película','release_date':'2026-01-01'}]}
        with patch('logic.load_settings',return_value={'tmdb_api_key':'test'}),patch('requests.get',return_value=response),patch('logic.get_language',return_value='es-ES'):
            result=main.search_tmdb('pelicula')
        self.assertTrue(result['results'][0]['ignored']);self.assertFalse(result['results'][1]['ignored'])
        self.assertTrue(Movie.get_by_id(self.movie.id).ignored)
    def test_indexer_results_include_ignore_notice(self):
        with patch('logic.load_settings',return_value={}),patch('logic.search_indexers',return_value=[{'title':RELEASE}]):
            result=main.search_movies('pelicula',42,'La película','2026')
        self.assertTrue(result['ignored']);self.assertTrue(result['results'][0]['ignored'])
        self.assertTrue(Movie.get_by_id(self.movie.id).ignored)


    def test_confirmed_download_keeps_selected_identity_even_when_release_title_differs(self):
        self.movie.delete_instance()
        torrent = {'hash':HASH,'name':'Malas manzanas (2026).mkv','progress':1,'state':'stalledUP','size':80}
        self.qb.torrents_info.side_effect=[[],[torrent]]
        result=self.run_download(movie_title='Bad Apples',movie_year='2026',tmdb_id=1198654)
        self.assertTrue(result['success'])
        movie=Movie.get(Movie.torrent_hash==HASH)
        self.assertEqual(movie.tmdb_id,1198654)
        self.assertEqual(movie.title,'Bad Apples')
        self.assertEqual(movie.status,'pending')
        self.assertEqual(movie.vote_average,0)
        self.assertFalse(movie.ignored)

    def test_confirmed_download_preserves_existing_identity_and_clears_watchlist(self):
        self.movie.ignored=False;self.movie.watchlist=True;self.movie.save()
        self.qb.torrents_info.return_value=[{'hash':HASH,'name':RELEASE}]
        self.run_download(tmdb_id=99)
        movie=Movie.get_by_id(self.movie.id)
        self.assertEqual(movie.tmdb_id,42)
        self.assertFalse(movie.watchlist)
        self.assertTrue(movie.copy_paused)

if __name__=='__main__':unittest.main()
