import { useState } from "react";
import { GameProvider, useGame } from "./context/GameContext";
import Home from "./components/Home";
import TeamManager from "./components/TeamManager";
import MatchSetup from "./components/MatchSetup";
import GenericCounter from "./components/games/GenericCounter";
import TuteSubastado from "./components/games/TuteSubastado";
import { Users, Spade, RefreshCw } from "lucide-react";
function GameRouter() {
  const { activeMatches, finishedMatches, loading, error, refreshData } =
    useGame();
  const [view, setView] = useState("home"),
    [homeView, setHomeView] = useState("menu"),
    [gameId, setGameId] = useState(null),
    [matchId, setMatchId] = useState(null),
    [readOnly, setReadOnly] = useState(false);
  const match = (readOnly ? finishedMatches : activeMatches).find(
    (m) => m.id === matchId,
  );
  const open = (id, finished) => {
    setMatchId(id);
    setReadOnly(finished);
    setHomeView(finished ? "finished" : "active");
    setView("game");
  };
  if (loading)
    return (
      <main className="container loading-state">
        <RefreshCw className="spin" size={32} />
        <h1>Preparando la mesa…</h1>
      </main>
    );
  if (error && activeMatches.length === 0 && finishedMatches.length === 0)
    return (
      <main className="container">
        <h1>No se ha podido cargar la mesa</h1>
        <p role="alert" className="message error">
          {error}
        </p>
        <button className="button primary" onClick={refreshData}>
          Reintentar
        </button>
      </main>
    );
  if (view === "game" && match) {
    const Game = match.gameId === "tute" ? TuteSubastado : GenericCounter;
    return (
      <Game
        key={match.id}
        matchId={match.id}
        isReadOnly={readOnly}
        onBack={() => setView("home")}
      />
    );
  }
  return (
    <>
      <div className="app-shell">
        {view === "teams" ? (
          <TeamManager onBack={() => setView("home")} />
        ) : view === "setup" ? (
          <MatchSetup
            gameId={gameId}
            onBack={() => setView("home")}
            onTeams={() => setView("teams")}
            onStart={(id) => {
              setMatchId(id);
              setReadOnly(false);
              setView("game");
            }}
          />
        ) : (
          <Home
            initialView={homeView}
            onTeams={() => setView("teams")}
            onSelectGame={(id) => {
              setGameId(id);
              setHomeView("new");
              setView("setup");
            }}
            onResumeGame={(id) => open(id, false)}
            onViewFinishedMatch={(id) => open(id, true)}
          />
        )}
      </div>
      <nav className="bottom-nav" aria-label="Navegación principal">
        <button
          className={`nav-item ${view === "home" ? "active" : ""}`}
          onClick={() => {
            setView("home");
            setHomeView("menu");
          }}
        >
          <Spade size={21} />
          <span>La mesa</span>
        </button>
        <button
          className={`nav-item ${view === "teams" ? "active" : ""}`}
          onClick={() => setView("teams")}
        >
          <Users size={21} />
          <span>Equipos</span>
        </button>
      </nav>
    </>
  );
}
export default function App() {
  return (
    <GameProvider>
      <GameRouter />
    </GameProvider>
  );
}
