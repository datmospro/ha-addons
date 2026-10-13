import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { teamsAPI, matchesAPI } from "../services/api";

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

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [teamsData, activeData, finishedData] = await Promise.all([
        teamsAPI.getAll(),
        matchesAPI.getAll("active"),
        matchesAPI.getAll("finished"),
      ]);
      setTeams(teamsData);
      setActiveMatches(activeData);
      setFinishedMatches(finishedData);
      setError(null);
    } catch (err) {
      setError(err.message);
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addTeam = async (name, players = []) => {
    try {
      const newTeam = await teamsAPI.create(name, players);
      setTeams((prev) => [...prev, newTeam]);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const deleteTeam = async (id) => {
    try {
      await teamsAPI.delete(id);
      setTeams((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateTeam = async (id, name, players = []) => {
    try {
      const updated = await teamsAPI.update(id, name, players);
      setTeams((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const startMatch = async (gameId, selectedTeamIds, settings = {}) => {
    try {
      const newMatch = await matchesAPI.create(
        gameId,
        selectedTeamIds,
        settings,
      );
      setActiveMatches((prev) => [newMatch, ...prev]);
      return newMatch.id;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const finishMatch = async (matchId) => {
    try {
      const match = activeMatches.find((m) => m.id === matchId);
      if (match) {
        const response = await matchesAPI.finish(matchId);
        // Merge the API response (which has endTime) with the existing match data (teams, history)
        // The API response only returns id, gameId, status, endTime
        const finishedMatch = {
          ...match,
          ...response,
          status: "finished",
        };
        setFinishedMatches((prev) => [finishedMatch, ...prev]);
        setActiveMatches((prev) => prev.filter((m) => m.id !== matchId));
      }
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const deleteMatch = async (matchId, type = "active") => {
    try {
      await matchesAPI.delete(matchId);
      if (type === "active") {
        setActiveMatches((prev) => prev.filter((m) => m.id !== matchId));
      } else {
        setFinishedMatches((prev) => prev.filter((m) => m.id !== matchId));
      }
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateMatchState = async (matchId, newState) => {
    try {
      const match = activeMatches.find((m) => m.id === matchId);
      if (!match)
        throw new Error(
          "La partida ya no está disponible. Vuelve a cargar la lista.",
        );

      const updatedMatch = { ...match, ...newState };

      // Only show the result as saved after the server confirms it.
      const saved = await matchesAPI.update(
        matchId,
        updatedMatch.teams,
        updatedMatch.history,
      );
      setActiveMatches((prev) =>
        prev.map((m) => (m.id === matchId ? saved : m)),
      );
      setError(null);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  return (
    <GameContext.Provider
      value={{
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
        refreshData: loadData,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}
