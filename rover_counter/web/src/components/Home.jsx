import { useEffect, useState } from "react";
import { ArrowUpRight, Plus, History, Play, Spade, Users } from "lucide-react";
import { useGame } from "../context/GameContext";
import { Header } from "./UI";
import GameList from "./GameList";
import ActiveGamesList from "./ActiveGamesList";
import FinishedGamesList from "./FinishedGamesList";
export default function Home({
  onSelectGame,
  onResumeGame,
  onViewFinishedMatch,
  onTeams,
  initialView = "menu",
}) {
  const [view, setView] = useState(initialView);
  const { activeMatches, finishedMatches, teams } = useGame();
  useEffect(() => setView(initialView), [initialView]);
  if (view !== "menu")
    return (
      <main className="container animate-in">
        <Header
          onBack={() => setView("menu")}
          title={
            view === "new"
              ? "Elige tu juego"
              : view === "active"
                ? "En la mesa"
                : "Partidas terminadas"
          }
          subtitle="TU ESPACIO DE JUEGO"
        />
        {view === "new" ? (
          <GameList onSelectGame={onSelectGame} />
        ) : view === "active" ? (
          <ActiveGamesList onResume={onResumeGame} />
        ) : (
          <FinishedGamesList onViewMatch={onViewFinishedMatch} />
        )}
      </main>
    );
  return (
    <main className="container home-page animate-in">
      <div className="brand-bar">
        <span className="brand-mark">
          <Spade size={18} fill="currentColor" />
        </span>
        <strong>
          rover<span>counter</span>
        </strong>
        <span className="brand-tag">A jugar.</span>
      </div>
      <section className="home-hero">
        <p className="eyebrow">BUENA COMPAÑÍA. BUENAS PARTIDAS.</p>
        <h1>
          La mesa está
          <br />
          <em>lista.</em>
        </h1>
        <p>
          Tú pones las cartas.
          <br />
          Nosotros llevamos la cuenta.
        </p>
        <button className="button primary" onClick={() => setView("new")}>
          <Plus size={20} /> Nueva partida <ArrowUpRight size={19} />
        </button>
        <div className="hero-art" aria-hidden="true">
          <span>
            ♠<small>A</small>
          </span>
          <span>
            ♦<small>A</small>
          </span>
        </div>
      </section>
      <div className="home-stats">
        <button onClick={() => setView("active")}>
          <strong>{activeMatches.length}</strong>
          <span>En curso</span>
        </button>
        <button onClick={() => setView("finished")}>
          <strong>{finishedMatches.length}</strong>
          <span>Terminadas</span>
        </button>
        <button onClick={onTeams}>
          <strong>{teams.length}</strong>
          <span>Equipos</span>
        </button>
      </div>
      <section className="home-section">
        <div className="section-heading">
          <h2>Volver a la mesa</h2>
          <button className="text-button" onClick={() => setView("active")}>
            Ver todas <ArrowUpRight size={15} />
          </button>
        </div>
        {activeMatches.length ? (
          <ActiveGamesList onResume={onResumeGame} limit={2} />
        ) : (
          <div className="panel starter">
            <Play size={25} />
            <div>
              <strong>Tu próxima partida empieza aquí</strong>
              <p>Crea una partida y retómala cuando quieras.</p>
            </div>
          </div>
        )}
      </section>
      <div className="home-links">
        <button className="panel link-card" onClick={() => setView("finished")}>
          <History size={23} />
          <span>
            <strong>El historial</strong>
            <small>Cada partida cuenta</small>
          </span>
          <ArrowUpRight size={18} />
        </button>
        <button className="panel link-card" onClick={onTeams}>
          <Users size={23} />
          <span>
            <strong>Los equipos</strong>
            <small>Reúne a los tuyos</small>
          </span>
          <ArrowUpRight size={18} />
        </button>
      </div>
    </main>
  );
}
