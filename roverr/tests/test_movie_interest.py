import sys
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import requests
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from modules import movie_interest as interest

class MovieInterestTests(unittest.TestCase):
    def setUp(self): interest._cache.clear()
    def response(self,**values):
        return Mock(json=Mock(return_value={'id':42,'popularity':23,'vote_count':1200,'budget':0,'revenue':0,**values}))
    def test_details_cached_and_unknown_budget_not_zero(self):
        with patch.object(interest.requests,'get',return_value=self.response()) as get:
            first=interest.get_interest(42,'secret');second=interest.get_interest(42,'secret')
            self.assertEqual(first,second);get.assert_called_once()
            self.assertEqual(first['votes'],1200);self.assertIsNone(first['budget'])
            self.assertNotIn('secret',str(first))
    def test_expired_data_preserved_if_source_fails(self):
        with patch.object(interest.requests,'get',return_value=self.response(budget=50000000)):
            interest.get_interest(42,'key')
        old=interest._cache[42];interest._cache[42]=(0,old[1],old[2])
        with patch.object(interest.requests,'get',side_effect=requests.ConnectionError):
            result=interest.get_interest(42,'key')
            self.assertEqual(result['status'],'cached');self.assertEqual(result['budget'],50000000)
    def test_identity_mismatch_and_missing_settings_fail_closed(self):
        with patch.object(interest.requests,'get',return_value=self.response(id=99)):
            self.assertEqual(interest.get_interest(42,'key')['status'],'unavailable')
        with patch.object(interest.requests,'get') as get:
            self.assertEqual(interest.get_interest(None,'key')['status'],'unidentified')
            self.assertEqual(interest.get_interest(42,'')['status'],'unavailable');get.assert_not_called()
    def test_invalid_numbers_are_not_low_interest(self):
        for value in (None,'bad',float('nan'),float('inf'),-1):
            self.assertIsNone(interest.number(value))
import datetime
from peewee import SqliteDatabase
from database import Movie

class PersistentInterestTests(unittest.TestCase):
    def setUp(self):
        interest._retry_after.clear()
        self.db=SqliteDatabase(':memory:')
        self.binding=self.db.bind_ctx([Movie]);self.binding.__enter__();self.db.create_tables([Movie])
        self.movie=Movie.create(torrent_hash='a'*40,title='Film',tmdb_id=42,vote_average=0,vote_count=0)
    def tearDown(self):
        self.binding.__exit__(None,None,None);self.db.close()
    def test_worker_updates_dashboard_without_opening_details(self):
        snapshot={'status':'ok','popularity':100.1,'vote_average':6.2,'votes':27,'updated_at':int(interest.time.time())}
        with patch.object(interest,'get_interest',return_value=snapshot),patch('modules.config.trigger_movies_update_callback') as notify:
            interest._update_movies([42],'key')
            notify.assert_called_once()
        current=Movie.get_by_id(self.movie.id)
        self.assertEqual(current.tmdb_popularity,100.1);self.assertEqual(current.vote_count,27);self.assertEqual(current.vote_average,6.2)
        self.assertIsNotNone(current.interest_updated_at)
    def test_failed_lookup_preserves_saved_signal(self):
        self.movie.tmdb_popularity=100.1;self.movie.save()
        self.assertFalse(interest.save_interest(42,{'status':'unavailable'}))
        self.assertEqual(Movie.get_by_id(self.movie.id).tmdb_popularity,100.1)
    def test_dashboard_schedules_without_network_on_request_thread(self):
        with patch.object(interest.threading,'Thread') as thread:
            interest.schedule_interest_updates([{'tmdb_id':42}], 'key')
            thread.assert_called_once();thread.return_value.start.assert_called_once()
        interest._worker_running=False
