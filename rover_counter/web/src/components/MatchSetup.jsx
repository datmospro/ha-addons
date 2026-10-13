import { useRef, useState } from "react";
import { Play, ArrowUp, ArrowDown, Check, Users } from "lucide-react";
import { useGame } from "../context/GameContext";
import { Header, Empty } from "./UI";
export default function MatchSetup({ gameId, onBack, onStart, onTeams }) {
  const { teams, startMatch } = useGame();
  const [selected, setSelected] = useState([]),
    [target, setTarget] = useState(gameId === "tute" ? 1001 : "");
  const [players, setPlayers] = useState([]),
    [dealer, setDealer] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    tute = gameId === "tute";
  const toggle = (id) => {
    const ids = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : tute && selected.length === 2
        ? [selected[1], id]
        : [...selected, id];
    setSelected(ids);
    setDealer(0);
    const chosen = ids.map((x) => teams.find((t) => t.id === x));
    const groups = chosen.map((t) =>
      (t.players || []).map((name, i) => ({
        name,
        teamId: t.id,
        key: `${t.id}-${i}`,
      })),
    );
    setPlayers(
      tute && groups.length === 2
        ? Array.from(
            { length: Math.max(...groups.map((x) => x.length)) },
            (_, i) => groups.map((g) => g[i]).filter(Boolean),
          ).flat()
        : groups.flat(),
    );
  };
  const move = (i, delta) => {
    const order = [...players],
      person = order[i];
    [order[i], order[i + delta]] = [order[i + delta], order[i]];
    const dealerKey = players[dealer]?.key;
    setPlayers(order);
    setDealer(order.findIndex((p) => p.key === dealerKey));
  };
  const valid =
    (tute ? selected.length === 2 : selected.length > 0) &&
    (tute ? Number(target) > 0 : target === "" || Number(target) >= 0) &&
    Number.isInteger(Number(target));
  const start = async () => {
    if (!valid || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const id = await startMatch(gameId, selected, {
        targetScore:
          target === "" || Number(target) === 0 ? null : Number(target),
        ...(tute
          ? {
              startingDealerIndex: dealer,
              playerOrder: players.map(({ name, teamId }) => ({
                name,
                teamId,
              })),
            }
          : {}),
      });
      onStart(id);
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <main className="container animate-in">
      <Header
        title="Prepara la mesa"
        subtitle={tute ? "TUTE SUBASTADO" : "CONTADOR LIBRE"}
        onBack={onBack}
      />
      <section className="panel">
        <div className="section-heading">
          <h2>Los equipos</h2>
          <span className="pill">
            {selected.length}
            {tute ? " / 2" : ""}
          </span>
        </div>
        <p className="muted">
          {tute
            ? "Elige los dos equipos que van a enfrentarse."
            : "Elige los equipos que van a jugar."}
        </p>
        {!teams.length ? (
          <>
            <Empty title="Faltan los protagonistas">
              Crea tus equipos antes de empezar.
            </Empty>
            <button className="button secondary full" onClick={onTeams}>
              <Users size={18} /> Crear equipos
            </button>
          </>
        ) : (
          <div className="team-options">
            {teams.map((team) => (
              <button
                key={team.id}
                className={`team-option ${selected.includes(team.id) ? "selected" : ""}`}
                onClick={() => toggle(team.id)}
                aria-pressed={selected.includes(team.id)}
              >
                <span className="avatar">
                  {team.name.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <strong>{team.name}</strong>
                  <small>{team.players?.join(" · ") || "Sin jugadores"}</small>
                </span>
                {selected.includes(team.id) && <Check size={20} />}
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <h2>El objetivo</h2>
        <label className="field-label" htmlFor="target">
          Puntos para ganar{!tute ? " · opcional" : ""}
        </label>
        <input
          id="target"
          type="number"
          inputMode="numeric"
          min={tute ? 1 : 0}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="Sin límite"
        />
        <p className="muted">
          {tute
            ? "Por defecto, la partida se juega a 1001 puntos."
            : "Déjalo vacío o a cero para jugar sin límite."}
        </p>
      </section>
      {tute && selected.length === 2 && players.length > 0 && (
        <section className="panel">
          <h2>El orden de la mesa</h2>
          <p className="muted">
            Orden de reparto. Usa las flechas para cambiar asientos y elige
            quién reparte primero.
          </p>
          <div className="seat-list">
            {players.map((player, i) => (
              <div
                className={`seat-row ${dealer === i ? "selected" : ""}`}
                key={player.key}
              >
                <span className="seat-number">{i + 1}</span>
                <button
                  className="seat-person"
                  onClick={() => setDealer(i)}
                  aria-pressed={dealer === i}
                >
                  <strong>{player.name}</strong>
                  <small>
                    {dealer === i
                      ? "Reparte primero"
                      : teams.find((t) => t.id === player.teamId)?.name}
                  </small>
                </button>
                <button
                  className="icon-button"
                  aria-label={`Subir a ${player.name}`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Bajar a ${player.name}`}
                  disabled={i === players.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={17} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      <button
        className="button primary full"
        disabled={!valid || busy}
        onClick={start}
      >
        <Play size={19} />
        {busy ? "Preparando…" : "Empezar partida"}
      </button>
    </main>
  );
}
