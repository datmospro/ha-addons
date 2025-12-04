const express = require('express');
const db = require('../db');
const router = express.Router();

// GET matches (with optional status filter)
router.get('/', (req, res) => {
    try {
        const { status } = req.query;
        let query = 'SELECT * FROM matches';
        const params = [];

        if (status) {
            query += ' WHERE status = ?';
            params.push(status);
        }

        query += ' ORDER BY start_time DESC';

        const matches = db.prepare(query).all(...params);

        // Enrich matches with teams and history
        const enrichedMatches = matches.map(match => {
            const teams = db.prepare(`
                SELECT t.id, t.name, t.players, t.created_at, mt.score 
                FROM match_teams mt
                JOIN teams t ON mt.team_id = t.id
                WHERE mt.match_id = ?
            `).all(match.id).map(team => ({
                ...team,
                players: team.players ? JSON.parse(team.players) : []
            }));

            const history = db.prepare(`
                SELECT * FROM match_history
                WHERE match_id = ?
                ORDER BY round DESC
            `).all(match.id).map(entry => ({
                round: entry.round,
                teamId: entry.team_id,
                bid: entry.bid,
                suit: entry.suit,
                success: entry.success === 1,
                scoringTeamId: entry.scoring_team_id,
                dealerIndex: entry.dealer_index,
                timestamp: entry.timestamp
            }));

            return {
                id: match.id,
                gameId: match.game_id,  // Transform to camelCase
                status: match.status,
                settings: match.settings ? JSON.parse(match.settings) : {},
                startTime: match.start_time,  // Transform to camelCase
                endTime: match.end_time,      // Transform to camelCase
                teams,
                history
            };
        });

        res.json(enrichedMatches);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST create match
router.post('/', (req, res) => {
    try {
        const { gameId, teamIds, settings } = req.body;
        const start_time = new Date().toISOString();

        const result = db.prepare(`
            INSERT INTO matches (game_id, status, settings, start_time)
            VALUES (?, 'active', ?, ?)
        `).run(gameId, JSON.stringify(settings || {}), start_time);

        const matchId = result.lastInsertRowid;

        // Add teams to match
        const insertTeam = db.prepare('INSERT INTO match_teams (match_id, team_id, score) VALUES (?, ?, 0)');
        teamIds.forEach(teamId => {
            insertTeam.run(matchId, teamId);
        });

        // Get full match data
        const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
        const teams = db.prepare(`
            SELECT t.id, t.name, t.players, t.created_at, mt.score 
            FROM match_teams mt
            JOIN teams t ON mt.team_id = t.id
            WHERE mt.match_id = ?
        `).all(matchId).map(team => ({
            ...team,
            players: team.players ? JSON.parse(team.players) : []
        }));

        res.status(201).json({
            id: match.id,
            gameId: match.game_id,
            status: match.status,
            settings: JSON.parse(match.settings),
            startTime: match.start_time,
            teams,
            history: []
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT update match (scores and history)
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { teams, history } = req.body;

        // Update team scores
        if (teams) {
            const updateScore = db.prepare('UPDATE match_teams SET score = ? WHERE match_id = ? AND team_id = ?');
            teams.forEach(team => {
                updateScore.run(team.score, id, team.id);
            });
        }

        // Update history (clear and re-insert)
        if (history) {
            db.prepare('DELETE FROM match_history WHERE match_id = ?').run(id);

            const insertHistory = db.prepare(`
                INSERT INTO match_history (match_id, round, team_id, bid, suit, success, scoring_team_id, dealer_index, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            history.forEach(entry => {
                insertHistory.run(
                    id,
                    entry.round,
                    entry.teamId,
                    entry.bid || null,
                    entry.suit || null,
                    entry.success !== undefined ? (entry.success ? 1 : 0) : null,
                    entry.scoringTeamId || null,
                    entry.dealerIndex !== undefined ? entry.dealerIndex : null,
                    entry.timestamp
                );
            });
        }

        // Get updated match
        const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
        const updatedTeams = db.prepare(`
            SELECT t.id, t.name, t.players, t.created_at, mt.score 
            FROM match_teams mt
            JOIN teams t ON mt.team_id = t.id
            WHERE mt.match_id = ?
        `).all(id).map(team => ({
            ...team,
            players: team.players ? JSON.parse(team.players) : []
        }));

        const updatedHistory = db.prepare('SELECT * FROM match_history WHERE match_id = ? ORDER BY round DESC').all(id).map(entry => ({
            round: entry.round,
            teamId: entry.team_id,
            bid: entry.bid,
            suit: entry.suit,
            success: entry.success === 1,
            scoringTeamId: entry.scoring_team_id,
            dealerIndex: entry.dealer_index,
            timestamp: entry.timestamp
        }));

        res.json({
            id: match.id,
            gameId: match.game_id,
            status: match.status,
            settings: JSON.parse(match.settings),
            startTime: match.start_time,
            endTime: match.end_time,
            teams: updatedTeams,
            history: updatedHistory
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST finish match
router.post('/:id/finish', (req, res) => {
    try {
        const { id } = req.params;
        const end_time = new Date().toISOString();

        db.prepare('UPDATE matches SET status = ?, end_time = ? WHERE id = ?').run('finished', end_time, id);

        const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
        res.json({
            id: match.id,
            gameId: match.game_id,
            status: match.status,
            endTime: match.end_time
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE match
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        db.prepare('DELETE FROM matches WHERE id = ?').run(id);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
