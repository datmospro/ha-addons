import gzip
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch
import requests
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from modules import imdb_ratings as ratings

DATA=b'tconst\taverageRating\tnumVotes\ntt0111161\t9.3\t10000\n'

class ImdbRatingsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.file=Path(self.temp.name)/'ratings.gz'
        self.path=patch.object(ratings,'CACHE_FILE',self.file);self.path.start()
        self.attempt=patch.object(ratings,'_last_attempt',0);self.attempt.start()
        ratings._values.clear();ratings._stamp=None
    def tearDown(self):
        self.path.stop();self.attempt.stop();self.temp.cleanup()
    def write(self):
        self.file.write_bytes(gzip.compress(DATA))
    def test_official_dataset_cached_and_read_without_network(self):
        self.write()
        with patch.object(ratings.requests,'get') as get:
            result=ratings.get_rating('tt0111161')
            self.assertEqual(result['rating'],'9.3');self.assertEqual(result['votes'],'10000')
            self.assertEqual(ratings.cached_rating('tt0111161'),('9.3','10000'))
            get.assert_not_called()
    def test_unrated_is_distinct_from_service_failure(self):
        self.write()
        self.assertEqual(ratings.get_rating('tt9999999')['status'],'unrated')
        self.file.unlink()
        with patch.object(ratings.requests,'get',side_effect=requests.ConnectionError):
            self.assertEqual(ratings.get_rating('tt9999999')['status'],'unavailable')
    def test_rejects_invalid_id_without_network(self):
        with patch.object(ratings.requests,'get') as get:
            self.assertEqual(ratings.get_rating('../admin')['status'],'unidentified')
            get.assert_not_called()
    def test_download_atomically_replaces_dataset(self):
        response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        response.iter_content.return_value=[gzip.compress(DATA)]
        with patch.object(ratings.requests,'get',return_value=response):
            self.assertEqual(ratings.get_rating('tt0111161')['rating'],'9.3')
        self.assertEqual(list(self.file.parent.glob('*.tmp')),[])
    def test_truncated_download_preserves_previous_dataset(self):
        self.write();os.utime(self.file,(time.time()-90000,)*2);original=self.file.read_bytes()
        response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        response.iter_content.return_value=[gzip.compress(DATA)[:-8]]
        with patch.object(ratings.requests,'get',return_value=response):
            result=ratings.get_rating('tt0111161')
        self.assertEqual(result['rating'],'9.3');self.assertEqual(result['status'],'cached')
        self.assertEqual(self.file.read_bytes(),original)
    def test_metadata_lookup_never_downloads_or_scans(self):
        with patch.object(ratings.requests,'get') as get:
            self.assertEqual(ratings.cached_rating('tt0111161'),(None,None))
            get.assert_not_called()

    def test_metadata_lookup_does_not_wait_for_dataset_download(self):
        with ratings._lock:
            self.assertEqual(ratings.cached_rating('tt0111161'),(None,None))
