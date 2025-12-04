const express = require('express');
const db = require('../db');
const router = express.Router();

// POST reset database (delete all data)
router.post('/reset', (req, res) => {
    try {
        // Delete all data in reverse order to respect foreign keys
        db.exec(`
            DELETE FROM match_history;
            DELETE FROM match_teams;
            DELETE FROM matches;
            DELETE FROM teams;
        `);

        res.json({ message: 'Database reset successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
