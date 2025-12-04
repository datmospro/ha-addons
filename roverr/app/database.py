from peewee import *
import datetime
import os

# Database file will be stored in /data to persist across restarts
db = SqliteDatabase('/data/history.db', pragmas={
    'journal_mode': 'wal',
    'cache_size': -1024 * 64,
    'foreign_keys': 1,
    'ignore_check_constraints': 0,
    'synchronous': 0
})

class BaseModel(Model):
    class Meta:
        database = db

class MoveHistory(BaseModel):
    torrent_name = CharField()
    source_path = CharField()
    dest_path = CharField()
    status = CharField() # 'success', 'skipped', 'error'
    message = TextField(null=True)
    timestamp = DateTimeField(default=datetime.datetime.now)

class Movie(BaseModel):
    torrent_hash = CharField(unique=True)
    title = CharField()
    year = CharField(null=True)
    poster_path = CharField(null=True) # Local path relative to static
    backdrop_path = CharField(null=True) # Local path relative to static
    overview = TextField(null=True)
    runtime = IntegerField(null=True)
    genres = CharField(null=True) # JSON string
    state = CharField(null=True) # downloading, paused, etc.
    progress = FloatField(default=0.0)
    size = IntegerField(default=0)
    added_at = DateTimeField(default=datetime.datetime.now)
    status = CharField(default='pending') # pending, moved, etc.
    
    # Cached metadata fields
    cast = TextField(null=True) # JSON string with cast data
    crew = TextField(null=True) # JSON string with crew data
    vote_average = FloatField(null=True) # TMDB rating
    vote_count = IntegerField(null=True) # TMDB vote count
    imdb_id = CharField(null=True) # IMDb ID
    imdb_rating = CharField(null=True) # IMDb rating
    imdb_votes = CharField(null=True) # IMDb vote count
    tmdb_id = IntegerField(null=True) # TMDB movie ID for unique identification
    metadata_updated_at = DateTimeField(null=True) # Last metadata update
    ignored = BooleanField(default=False) # If True, sync will skip this movie
    torrent_name = CharField(null=True) # Original torrent name for history linking
    watchlist = BooleanField(default=False) # If True, movie is in watchlist monitoring
    watchlist_expiry = DateTimeField(null=True) # Expiration date for watchlist

def migrate_db():
    """
    Migrates the database by adding new columns if they don't exist.
    Safe to run multiple times.
    """
    import logging
    logger = logging.getLogger("Database")
    
    # List of new columns to add to Movie table
    new_columns = [
        ('cast', 'TEXT'),
        ('crew', 'TEXT'),
        ('vote_average', 'REAL'),
        ('vote_count', 'INTEGER'),
        ('imdb_id', 'TEXT'),
        ('imdb_rating', 'TEXT'),
        ('imdb_votes', 'TEXT'),
        ('tmdb_id', 'INTEGER'),
        ('metadata_updated_at', 'DATETIME'),
        ('ignored', 'BOOLEAN'),
        ('torrent_name', 'TEXT'),
        ('watchlist', 'BOOLEAN'),
        ('watchlist_expiry', 'DATETIME')
    ]
    
    try:
        cursor = db.execute_sql("PRAGMA table_info(movie)")
        existing_columns = {row[1] for row in cursor.fetchall()}
        
        for column_name, column_type in new_columns:
            if column_name not in existing_columns:
                logger.info(f"Adding column '{column_name}' to Movie table")
                db.execute_sql(f"ALTER TABLE movie ADD COLUMN {column_name} {column_type}")
                logger.info(f"Successfully added column '{column_name}'")
    except Exception as e:
        logger.error(f"Error during migration: {e}")
        raise

def init_db():
    db.connect()
    db.execute_sql('PRAGMA busy_timeout = 5000')  # Wait up to 5 seconds if database is locked
    db.create_tables([MoveHistory, Movie])
    migrate_db()  # Run migration after creating tables

