const Database = require('better-sqlite3');
const path = require('path');

// Database file location (persistent in /data directory)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'game_counter.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database schema
// Initialize database schema
function initDatabase() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('active', 'finished')),
            settings TEXT,
            start_time TEXT NOT NULL,
            end_time TEXT
        );

        CREATE TABLE IF NOT EXISTS match_teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL,
            team_id INTEGER NOT NULL,
            score INTEGER DEFAULT 0,
            FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
            FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS match_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL,
            round INTEGER NOT NULL,
            team_id INTEGER NOT NULL,
            bid INTEGER,
            suit TEXT,
            success INTEGER,
            scoring_team_id INTEGER,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
            FOREIGN KEY (team_id) REFERENCES teams(id),
            FOREIGN KEY (scoring_team_id) REFERENCES teams(id)
        );
    `);

    // Migration: Add players column to teams if it doesn't exist
    try {
        const tableInfo = db.prepare("PRAGMA table_info(teams)").all();
        const hasPlayersColumn = tableInfo.some(col => col.name === 'players');

        if (!hasPlayersColumn) {
            console.log('Migrating: Adding players column to teams table');
            db.exec(`ALTER TABLE teams ADD COLUMN players TEXT DEFAULT '[]'`);
            // Update existing rows to have empty array
            db.exec(`UPDATE teams SET players = '[]' WHERE players IS NULL`);
        }
    } catch (error) {
        console.error('Migration error (players column):', error);
    }

    // Migration: Add dealer_index column to match_history if it doesn't exist
    try {
        const tableInfo = db.prepare("PRAGMA table_info(match_history)").all();
        const hasDealerIndexColumn = tableInfo.some(col => col.name === 'dealer_index');

        if (!hasDealerIndexColumn) {
            console.log('Migrating: Adding dealer_index column to match_history table');
            db.exec(`ALTER TABLE match_history ADD COLUMN dealer_index INTEGER`);
        }
    } catch (error) {
        console.error('Migration error (dealer_index column):', error);
    }
}

initDatabase();

module.exports = db;

