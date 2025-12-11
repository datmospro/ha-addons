from peewee import *
import datetime
import os

# Database file will be stored in /data to persist across restarts
db = SqliteDatabase('/data/history.db', pragmas={
    'journal_mode': 'wal',
    'cache_size': -1024 * 64,
    'foreign_keys': 1,
    'ignore_check_constraints': 0,
    'synchronous': 1  # Changed from 0 to 1 - NORMAL mode for data safety
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
    country_code = CharField(null=True, max_length=2) # ISO 3166-1 country code (e.g., 'US', 'ES')
    ignored = BooleanField(default=False) # If True, sync will skip this movie
    torrent_name = CharField(null=True) # Original torrent name for history linking
    watchlist = BooleanField(default=False) # If True, movie is in watchlist monitoring
    watchlist_expiry = DateTimeField(null=True) # Expiration date for watchlist
    hidden = BooleanField(default=False) # If True, movie is hidden from dashboard (soft-ignored)

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
        ('country_code', 'TEXT'),
        ('ignored', 'BOOLEAN'),
        ('torrent_name', 'TEXT'),
        ('watchlist', 'BOOLEAN'),
        ('watchlist_expiry', 'DATETIME'),
        ('hidden', 'BOOLEAN')
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

def backup_database():
    """
    Creates a backup of the database.
    Should be called daily via scheduler to prevent data loss.
    
    Returns:
        tuple: (success: bool, message: str, backup_path: str)
    """
    import logging
    import shutil
    
    logger = logging.getLogger("Database")
    
    try:
        # Ensure backup directory exists
        backup_dir = "/data/backups"
        os.makedirs(backup_dir, exist_ok=True)
        
        # Backup filename with date
        backup_file = f"{backup_dir}/history_backup_{datetime.datetime.now():%Y%m%d_%H%M%S}.db"
        
        # Close any open connections and copy
        # WAL mode allows backup while database is in use
        shutil.copy2("/data/history.db", backup_file)
        
        # Also backup WAL file if it exists
        wal_file = "/data/history.db-wal"
        if os.path.exists(wal_file):
            shutil.copy2(wal_file, f"{backup_file}-wal")
        
        logger.info(f"Database backup created: {backup_file}")
        
        # Cleanup old backups (keep last 7)
        cleanup_old_backups(backup_dir, keep=7)
        
        return True, f"Backup created successfully", backup_file
        
    except Exception as e:
        logger.error(f"Error creating database backup: {e}")
        return False, f"Backup failed: {str(e)}", ""

def cleanup_old_backups(backup_dir, keep=7):
    """
    Remove old backup files, keeping only the most recent 'keep' backups.
    
    Args:
        backup_dir: Directory containing backup files
        keep: Number of most recent backups to keep (default: 7)
    """
    import logging
    logger = logging.getLogger("Database")
    
    try:
        # Get all backup files sorted by modification time (newest first)
        backups = []
        for filename in os.listdir(backup_dir):
            if filename.startswith("history_backup_") and filename.endswith(".db"):
                filepath = os.path.join(backup_dir, filename)
                backups.append((filepath, os.path.getmtime(filepath)))
        
        # Sort by modification time (newest first)
        backups.sort(key=lambda x: x[1], reverse=True)
        
        # Delete old backups beyond 'keep' limit
        for filepath, _ in backups[keep:]:
            try:
                os.remove(filepath)
                # Also remove WAL file if exists
                wal_filepath = f"{filepath}-wal"
                if os.path.exists(wal_filepath):
                    os.remove(wal_filepath)
                logger.info(f"Removed old backup: {os.path.basename(filepath)}")
            except Exception as e:
                logger.warning(f"Could not remove old backup {filepath}: {e}")
                
    except Exception as e:
        logger.error(f"Error cleaning old backups: {e}")

def restore_database_from_backup(backup_path):
    """
    Restores database from a backup file.
    WARNING: This will overwrite the current database!
    
    Args:
        backup_path: Path to the backup file to restore
        
    Returns:
        tuple: (success: bool, message: str)
    """
    import logging
    import shutil
    
    logger = logging.getLogger("Database")
    
    try:
        if not os.path.exists(backup_path):
            return False, f"Backup file not found: {backup_path}"
        
        # Close database connection
        db.close()
        
        # Backup current database before overwriting (safety measure)
        emergency_backup = f"/data/history_emergency_{datetime.datetime.now():%Y%m%d_%H%M%S}.db"
        if os.path.exists("/data/history.db"):
            shutil.copy2("/data/history.db", emergency_backup)
            logger.info(f"Created emergency backup: {emergency_backup}")
        
        # Restore from backup
        shutil.copy2(backup_path, "/data/history.db")
        
        # Restore WAL file if exists
        wal_backup = f"{backup_path}-wal"
        if os.path.exists(wal_backup):
            shutil.copy2(wal_backup, "/data/history.db-wal")
        
        # Reconnect to database
        db.connect()
        
        logger.info(f"Database restored from backup: {backup_path}")
        return True, f"Database restored successfully from {os.path.basename(backup_path)}"
        
    except Exception as e:
        logger.error(f"Error restoring database: {e}")
        return False, f"Restore failed: {str(e)}"

def get_backup_list():
    """
    Returns a list of available database backups.
    
    Returns:
        list: List of dicts with backup info (filename, size, date)
    """
    backup_dir = "/data/backups"
    backups = []
    
    try:
        if not os.path.exists(backup_dir):
            return backups
        
        for filename in os.listdir(backup_dir):
            if filename.startswith("history_backup_") and filename.endswith(".db"):
                filepath = os.path.join(backup_dir, filename)
                stat = os.stat(filepath)
                
                backups.append({
                    'filename': filename,
                    'path': filepath,
                    'size_mb': round(stat.st_size / (1024 * 1024), 2),
                    'created': datetime.datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    'timestamp': stat.st_mtime
                })
        
        # Sort by timestamp (newest first)
        backups.sort(key=lambda x: x['timestamp'], reverse=True)
        
    except Exception as e:
        import logging
        logging.getLogger("Database").error(f"Error getting backup list: {e}")
    
    return backups
