import sys
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from peewee import SqliteDatabase
from database import Movie
from modules import rss, config
import main

class RSSYearTests(unittest.TestCase):
    def test_minimum_boundary_and_unknown_year(self):
        for year, minimum, expected in [('1999',2000,False),('2000','2000',True),('2026',2000,True),(None,2000,False),('',2000,False),('bad',2000,False),('2000','bad',False),(None,'',True)]:
            with self.subTest(year=year, minimum=minimum):
                self.assertEqual(rss.rss_year_allowed(year,{'min_year':minimum}), expected)

    def test_existing_uncertain_download_cannot_bypass_year_filter(self):
        movie=SimpleNamespace(state='rss',ignored=False,copy_paused=False,year='1999',status_reason='Torrent client did not respond')
        with patch.object(rss,'auto_download_movie') as download:
            self.assertFalse(rss.retry_rss_confirmation(movie,{'auto_add':True,'min_year':2000}))
            download.assert_not_called()

    def test_settings_api_roundtrip_preserves_year(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(config,'SETTINGS_FILE',str(Path(temp)/'settings.json')):
            settings={'local_source_path':'source','local_dest_path':'dest','rss_feeds':[{'name':'RSS','min_year':2000}]}
            self.assertTrue(main.update_settings(settings)['success'])
            self.assertEqual(main.get_settings()['rss_feeds'][0]['min_year'],2000)

    def test_old_rss_entry_never_reaches_download(self):
        db=SqliteDatabase(':memory:')
        with db.bind_ctx([Movie]):
            db.create_tables([Movie])
            feed={'name':'RSS','url':'https://example.test/feed','enabled':True,'auto_add':True,'min_year':2000}
            entry={'title':'Old Film (1999)','link':'https://example.test/film'}
            with patch.object(rss,'load_settings',return_value={'rss_feeds':[feed]}), patch('feedparser.parse',return_value=SimpleNamespace(entries=[entry])), patch.object(rss,'auto_download_movie') as download:
                rss.fetch_rss_movies()
                download.assert_not_called()
                self.assertEqual(Movie.select().count(),0)
        db.close()
