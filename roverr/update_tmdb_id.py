#!/usr/bin/env python3
"""
Quick fix script to update tmdb_id for La familia McMullen
"""
import sys
import os

# Add app directory to path
sys.path.insert(0, '/app')

from database import db, Movie

# Connect to database
db.connect()

# Update La familia McMullen with correct TMDB ID
try:
    movie = Movie.get(Movie.torrent_hash == '3a20aba2ade2891732bbde0291d49dfeab26c4bd')
    print(f"Found movie: {movie.title} ({movie.year})")
    print(f"Current tmdb_id: {movie.tmdb_id}")
    
    # Update with correct TMDB ID from RSS
    movie.tmdb_id = 1548017
    movie.save()
    
    print(f"✅ Updated tmdb_id to: {movie.tmdb_id}")
    print(f"Manual search should now work with English fallback!")
    
except Exception as e:
    print(f"Error: {e}")
finally:
    db.close()
