const express = require('express');
const db = require('../db');
const router = express.Router();

// GET all teams
router.get('/', (req, res) => {
    try {
        const teams = db.prepare('SELECT * FROM teams ORDER BY created_at DESC').all();
        const teamsWithPlayers = teams.map(team => ({
            ...team,
            players: team.players ? JSON.parse(team.players) : []
        }));
        res.json(teamsWithPlayers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST create team
router.post('/', (req, res) => {
    try {
        const { name, players } = req.body;
        const created_at = new Date().toISOString();
        const playersJson = JSON.stringify(players || []);

        const result = db.prepare('INSERT INTO teams (name, players, created_at) VALUES (?, ?, ?)').run(name, playersJson, created_at);

        const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json({
            ...team,
            players: team.players ? JSON.parse(team.players) : []
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT update team
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, players } = req.body;
        const playersJson = JSON.stringify(players || []);

        db.prepare('UPDATE teams SET name = ?, players = ? WHERE id = ?').run(name, playersJson, id);

        const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
        res.json({
            ...team,
            players: team.players ? JSON.parse(team.players) : []
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE team
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        db.prepare('DELETE FROM teams WHERE id = ?').run(id);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
