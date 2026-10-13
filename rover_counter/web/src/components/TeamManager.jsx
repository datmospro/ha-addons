import { useRef, useState } from "react";
import { Plus, Pencil, Trash2, Users, X } from "lucide-react";
import { useGame } from "../context/GameContext";
import { Header, Empty, Modal } from "./UI";
export default function TeamManager({ onBack }) {
  const { teams, addTeam, updateTeam, deleteTeam, refreshData } = useGame();
  const [editor, setEditor] = useState(null),
    [remove, setRemove] = useState(null),
    [reset, setReset] = useState(false),
    [resetText, setResetText] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const run = async (action) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const open = (team) => {
    setError("");
    setEditor(
      team
        ? {
            ...team,
            players: team.players?.length ? [...team.players] : ["", ""],
          }
        : { name: "", players: ["", ""] },
    );
  };
  return (
    <main className="container animate-in">
      <Header
        title="Los equipos"
        subtitle="LOS PROTAGONISTAS"
        onBack={onBack}
        action={
          <button className="button primary" onClick={() => open(null)}>
            <Plus size={18} /> Nuevo
          </button>
        }
      />
      <p className="intro muted">
        Guarda los equipos y sus jugadores. Estarán listos para tu próxima
        partida.
      </p>
      {!teams.length ? (
        <Empty title="Reúne a los tuyos">
          Añade el primer equipo y sus jugadores para empezar.
        </Empty>
      ) : (
        <div className="team-cards">
          {teams.map((team, i) => (
            <article className="panel team-card" key={team.id}>
              <span className={`avatar team-${i % 2}`}>
                {team.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="team-copy">
                <h2>{team.name}</h2>
                <p>{team.players?.join(" · ") || "Sin jugadores asignados"}</p>
              </div>
              <button
                className="icon-button"
                aria-label={`Editar ${team.name}`}
                onClick={() => open(team)}
              >
                <Pencil size={18} />
              </button>
              <button
                className="icon-button danger"
                aria-label={`Eliminar ${team.name}`}
                onClick={() => {
                  setError("");
                  setRemove(team);
                }}
              >
                <Trash2 size={18} />
              </button>
            </article>
          ))}
        </div>
      )}
      <details className="advanced">
        <summary>Mantenimiento</summary>
        <p className="muted">
          Reiniciar elimina todos los equipos y todas las partidas.
        </p>
        <button
          className="button danger"
          onClick={() => {
            setError("");
            setResetText("");
            setReset(true);
          }}
        >
          Reiniciar datos
        </button>
      </details>
      {editor && (
        <Modal
          title={editor.id ? "Editar equipo" : "Nuevo equipo"}
          onClose={() => !busy && setEditor(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const players = editor.players
                  .map((p) => p.trim())
                  .filter(Boolean);
                if (editor.id)
                  await updateTeam(editor.id, editor.name.trim(), players);
                else await addTeam(editor.name.trim(), players);
                setEditor(null);
              });
            }}
          >
            <label className="field-label" htmlFor="team-name">
              Nombre del equipo
            </label>
            <input
              id="team-name"
              autoFocus
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              placeholder="Por ejemplo, Los ases"
              required
              maxLength={100}
            />
            <fieldset>
              <legend>Jugadores</legend>
              {editor.players.map((p, i) => (
                <div className="player-input" key={i}>
                  <input
                    aria-label={`Jugador ${i + 1}`}
                    value={p}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        players: editor.players.map((x, j) =>
                          j === i ? e.target.value : x,
                        ),
                      })
                    }
                    placeholder={`Jugador ${i + 1}`}
                    maxLength={100}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Quitar jugador ${i + 1}`}
                    onClick={() =>
                      setEditor({
                        ...editor,
                        players: editor.players.filter((_, j) => j !== i),
                      })
                    }
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="button secondary full"
                onClick={() =>
                  setEditor({ ...editor, players: [...editor.players, ""] })
                }
              >
                <Users size={18} /> Añadir jugador
              </button>
            </fieldset>
            {error && (
              <p className="message error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button primary full"
              disabled={busy || !editor.name.trim()}
            >
              {busy ? "Guardando…" : "Guardar equipo"}
            </button>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal
          title="¿Eliminar equipo?"
          onClose={() => !busy && setRemove(null)}
        >
          <p>
            Se eliminará {remove.name}. Si participa en partidas guardadas, el
            servidor puede impedir su eliminación.
          </p>
          {error && (
            <p className="message error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setRemove(null)}
            >
              Cancelar
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await deleteTeam(remove.id);
                  await refreshData();
                  setRemove(null);
                })
              }
            >
              {busy ? "Eliminando…" : "Eliminar equipo"}
            </button>
          </div>
        </Modal>
      )}
      {reset && (
        <Modal
          title="Reiniciar todos los datos"
          onClose={() => !busy && setReset(false)}
        >
          <p>
            Se borrarán permanentemente todos los equipos y partidas. Escribe
            BORRAR para confirmar.
          </p>
          <input
            aria-label="Confirmación de borrado"
            value={resetText}
            onChange={(e) => setResetText(e.target.value)}
          />
          {error && (
            <p role="alert" className="message error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setReset(false)}
            >
              Cancelar
            </button>
            <button
              className="button danger"
              disabled={busy || resetText !== "BORRAR"}
              onClick={() =>
                run(async () => {
                  const r = await fetch("/api/admin/reset", { method: "POST" });
                  if (!r.ok)
                    throw Error("No se han podido reiniciar los datos.");
                  await refreshData();
                  setReset(false);
                })
              }
            >
              Borrar todo
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
