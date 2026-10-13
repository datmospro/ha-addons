import { useState } from "react";
import { Play, Trash2, Eye } from "lucide-react";
import { useGame } from "../context/GameContext";
import { Empty, Modal } from "./UI";
export function MatchList({ finished = false, onOpen, limit }) {
  const { activeMatches, finishedMatches, deleteMatch } = useGame();
  const [pending, setPending] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const matches = finished ? finishedMatches : activeMatches;
  if (!matches.length)
    return (
      <Empty
        title={finished ? "Aún no hay resultados" : "Ninguna partida en curso"}
      >
        {finished
          ? "Cuando finalices una partida, podrás consultar aquí su marcador y sus repartos."
          : "Empieza una nueva partida para reunir a tus equipos."}
      </Empty>
    );
  return (
    <>
      <div className="match-list">
        {matches.slice(0, limit || matches.length).map((match) => (
          <article className="match-card" key={match.id}>
            <div className="match-meta">
              <span className="pill">
                {match.gameId === "tute" ? "Tute subastado" : "Contador libre"}
              </span>
              <time>
                {new Date(
                  finished ? match.endTime : match.startTime,
                ).toLocaleDateString("es-ES", {
                  day: "numeric",
                  month: "short",
                })}
              </time>
            </div>
            <button
              className="match-open"
              onClick={() => onOpen(match.id)}
              aria-label={`${finished ? "Ver" : "Continuar"} ${match.teams.map((t) => t.name).join(" contra ")}`}
            >
              <div className="match-teams">
                {match.teams.map((team, i) => (
                  <div key={team.id}>
                    <span className={`team-dot team-${i % 2}`} />
                    <strong>{team.name}</strong>
                    <b>{team.score}</b>
                  </div>
                ))}
              </div>
            </button>
            <div className="match-footer">
              <small>
                {match.history.length} repartos
                {finished ? " · Finalizada" : " · En curso"}
              </small>
              <button
                className="icon-button danger"
                aria-label="Eliminar partida"
                onClick={() => {
                  setPending(match);
                  setError("");
                }}
              >
                <Trash2 size={16} />
              </button>
              <button
                className="button subtle"
                onClick={() => onOpen(match.id)}
              >
                {finished ? <Eye size={16} /> : <Play size={16} />}
                {finished ? "Ver partida" : "Continuar"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {pending && (
        <Modal
          title="¿Eliminar esta partida?"
          onClose={() => !busy && setPending(null)}
        >
          <p>
            Se eliminarán el marcador y el historial de{" "}
            {pending.teams.map((t) => t.name).join(" y ")}. Los equipos se
            conservarán.
          </p>
          {error && (
            <p role="alert" className="message error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancelar
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await deleteMatch(
                    pending.id,
                    finished ? "finished" : "active",
                  );
                  setPending(null);
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Eliminando…" : "Eliminar partida"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export default function ActiveGamesList({ onResume, limit }) {
  return <MatchList onOpen={onResume} limit={limit} />;
}
