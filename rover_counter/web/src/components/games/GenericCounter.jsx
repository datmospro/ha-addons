import { useRef, useState } from "react";
import { Plus, Minus, Dices } from "lucide-react";
import { useGame } from "../../context/GameContext";
import { Header, Modal, Scores } from "../UI";
export default function GenericCounter({
  matchId,
  onBack,
  isReadOnly = false,
}) {
  const { activeMatches, finishedMatches, updateMatchState, finishMatch } =
    useGame();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [finish, setFinish] = useState(false),
    [dice, setDice] = useState([]);
  const lock = useRef(false);
  const match = (isReadOnly ? finishedMatches : activeMatches).find(
    (m) => m.id === matchId,
  );
  if (!match) return null;
  const run = async (action) => {
    if (isReadOnly || lock.current) return;
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
  const winner =
    match.settings.targetScore > 0
      ? match.teams.find((t) => t.score >= match.settings.targetScore)
      : null;
  return (
    <main className="container animate-in">
      <Header
        title="Contador libre"
        subtitle={
          isReadOnly
            ? "PARTIDA FINALIZADA"
            : match.settings.targetScore
              ? `OBJETIVO · ${match.settings.targetScore} PUNTOS`
              : "SIN LÍMITE DE PUNTOS"
        }
        onBack={onBack}
        action={
          !isReadOnly && (
            <button
              className="button subtle"
              onClick={() => setFinish(true)}
              disabled={busy}
            >
              Finalizar
            </button>
          )
        }
      />
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      <div role="status" className="save-status">
        {busy ? "Guardando…" : "Marcador guardado en el servidor"}
      </div>
      <Scores teams={match.teams} target={match.settings.targetScore} />
      {winner && (
        <section className="winner-banner">
          <div>
            <h2>¡{winner.name} ha alcanzado el objetivo!</h2>
            <p>
              {winner.score} puntos. Puedes corregir el marcador o finalizar la
              partida.
            </p>
          </div>
        </section>
      )}
      {!isReadOnly && (
        <>
          <div className="generic-controls">
            {match.teams.map((team) => (
              <section className="panel" key={team.id}>
                <h2>{team.name}</h2>
                <div className="score-controls">
                  {[-10, -1, 1, 10].map((delta) => (
                    <button
                      key={delta}
                      className={`button ${delta > 0 ? "primary" : "secondary"}`}
                      disabled={busy}
                      aria-label={`${delta > 0 ? "Sumar" : "Restar"} ${Math.abs(delta)} a ${team.name}`}
                      onClick={() =>
                        run(() =>
                          updateMatchState(matchId, {
                            teams: match.teams.map((t) =>
                              t.id === team.id
                                ? { ...t, score: t.score + delta }
                                : t,
                            ),
                          }),
                        )
                      }
                    >
                      {delta === 1 ? (
                        <Plus size={22} />
                      ) : delta === -1 ? (
                        <Minus size={22} />
                      ) : delta > 0 ? (
                        `+${delta}`
                      ) : (
                        delta
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <section className="panel dice-panel">
            <h2>
              <Dices size={21} /> Los dados
            </h2>
            <p className="muted">Un lanzamiento para desempatar o empezar.</p>
            <div className="choice-grid">
              <button
                className="button secondary"
                onClick={() => setDice([Math.ceil(Math.random() * 6)])}
              >
                Lanzar un dado
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  setDice([
                    Math.ceil(Math.random() * 6),
                    Math.ceil(Math.random() * 6),
                  ])
                }
              >
                Lanzar dos dados
              </button>
            </div>
            <div className="dice-result" role="status">
              {dice.map((n, i) => (
                <span key={i}>{n}</span>
              ))}
            </div>
          </section>
        </>
      )}
      {finish && (
        <Modal
          title="¿Finalizar la partida?"
          onClose={() => !busy && setFinish(false)}
        >
          <p>Se guardará en el historial con el marcador actual.</p>
          {error && (
            <p role="alert" className="message error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setFinish(false)}
            >
              Cancelar
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await finishMatch(matchId);
                  onBack();
                })
              }
            >
              Finalizar partida
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
