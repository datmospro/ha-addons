import React, { createContext, useContext, useState, useEffect } from 'react';
import { teamsAPI, matchesAPI } from '../services/api';

const GameContext = createContext();

export function useGame() {
    return useContext(GameContext);
}

export function GameProvider({ children }) {
    const [teams, setTeams] = useState([]);
    const [activeMatches, setActiveMatches] = useState([]);
    const [finishedMatches, setFinishedMatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Load initial data from API
    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [teamsData, activeData, finishedData] = await Promise.all([
                teamsAPI.getAll(),
                matchesAPI.getAll('active'),
                matchesAPI.getAll('finished')
            ]);
            setTeams(teamsData);
            setActiveMatches(activeData);
            setFinishedMatches(finishedData);
            setError(null);
        } catch (err) {
            setError(err.message);
            console.error('Failed to load data:', err);
        } finally {
            setLoading(false);
        }
    };

    const addTeam = async (name, players = []) => {
        try {
            const newTeam = await teamsAPI.create(name, players);
            setTeams([...teams, newTeam]);
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    const deleteTeam = async (id) => {
        try {
            await teamsAPI.delete(id);
            setTeams(teams.filter(t => t.id !== id));
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    const updateTeam = async (id, name, players = []) => {
        try {
            const updated = await teamsAPI.update(id, name, players);
            setTeams(teams.map(t => t.id === id ? updated : t));
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    const startMatch = async (gameId, selectedTeamIds, settings = {}) => {
        try {
            const newMatch = await matchesAPI.create(gameId, selectedTeamIds, settings);
            setActiveMatches([newMatch, ...activeMatches]);
            return newMatch.id;
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    const finishMatch = async (matchId) => {
        try {
            const match = activeMatches.find(m => m.id === matchId);
            if (match) {
                const response = await matchesAPI.finish(matchId);
                // Merge the API response (which has endTime) with the existing match data (teams, history)
                // The API response only returns id, gameId, status, endTime
                const finishedMatch = {
                    ...match,
                    ...response,
                    status: 'finished'
                };
                setFinishedMatches([finishedMatch, ...finishedMatches]);
                setActiveMatches(activeMatches.filter(m => m.id !== matchId));
            }
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    const deleteMatch = async (matchId, type = 'active') => {
        try {
            await matchesAPI.delete(matchId);
            if (type === 'active') {
                setActiveMatches(activeMatches.filter(m => m.id !== matchId));
            } else {
                setFinishedMatches(finishedMatches.filter(m => m.id !== matchId));
            }
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    const updateMatchState = async (matchId, newState) => {
        try {
            const match = activeMatches.find(m => m.id === matchId);
            if (!match) return;

            const updatedMatch = { ...match, ...newState };

            // Update local state IMMEDIATELY (Optimistic UI)
            setActiveMatches(prevMatches => prevMatches.map(m =>
                m.id === matchId ? updatedMatch : m
            ));

            // Update on server
            await matchesAPI.update(matchId, updatedMatch.teams, updatedMatch.history);
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    return (
        <GameContext.Provider value={{
            teams,
            addTeam,
            deleteTeam,
            updateTeam,
            activeMatches,
            finishedMatches,
            startMatch,
            finishMatch,
            deleteMatch,
            updateMatchState,
            loading,
            error,
            refreshData: loadData
        }}>
            {children}
        </GameContext.Provider>
    );
}
