import { useRef, useState } from "react";
import {
  Trophy,
  RotateCcw,
  Shuffle,
  Check,
  X,
  Pencil,
  ArrowRight,
} from "lucide-react";
import { useGame } from "../../context/GameContext";
import { Header, Modal, Scores, Empty, SuitIcon } from "../UI";
import {
  suits,
  playersFor,
  dealerFor,
  normalizeHistory,
  scoresFromHistory,
  appendRound,
} from "../../utils/tute.mjs";
const initialAuction = { teamId: null, bid: 70, suit: null };
function AuctionFields({ match, value, onChange }) {
  return (
    <>
      <fieldset>
        <legend>¿Quién subasta?</legend>
        <div className="choice-grid">
          {match.teams.map((team, i) => (
            <button
              type="button"
              key={team.id}
              className={`choice team-${i} ${value.teamId === team.id ? "selected" : ""}`}
              aria-pressed={value.teamId === team.id}
              onClick={() => onChange({ ...value, teamId: team.id })}
            >
              {team.name}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Puntos de la subasta</legend>
        <div className="bid-stepper">
          <button
            type="button"
            aria-label="Restar 5 puntos"
            disabled={value.bid <= 70}
            onClick={() => onChange({ ...value, bid: value.bid - 5 })}
          >
            −
          </button>
          <label>
            <select
              aria-label="Puntos de la subasta"
              value={value.bid}
              onChange={(e) =>
                onChange({ ...value, bid: Number(e.target.value) })
              }
            >
              {Array.from({ length: 33 }, (_, i) => 70 + i * 5).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>puntos</span>
          </label>
          <button
            type="button"
            aria-label="Sumar 5 puntos"
            disabled={value.bid >= 230}
            onClick={() => onChange({ ...value, bid: value.bid + 5 })}
          >
            +
          </button>
        </div>
        <div className="quick-bids">
          {[70, 100, 120, 150, 200].map((bid) => (
            <button
              type="button"
              key={bid}
              aria-pressed={value.bid === bid}
              className={value.bid === bid ? "selected" : ""}
              onClick={() => onChange({ ...value, bid })}
            >
              {bid}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Palo de triunfo</legend>
        <div className="suit-grid">
          {suits.map((s) => (
            <button
              type="button"
              key={s.id}
              className={`suit ${value.suit === s.id ? "selected" : ""}`}
              aria-pressed={value.suit === s.id}
              onClick={() => onChange({ ...value, suit: s.id })}
            >
              <SuitIcon suit={s.id} emoji={s.emoji} />
              {s.name}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}
export default function TuteSubastado({ matchId, onBack, isReadOnly = false }) {
  const { activeMatches, finishedMatches, updateMatchState, finishMatch } =
    useGame();
  const [auction, setAuction] = useState(initialAuction),
    [phase, setPhase] = useState("auction");
  const [modal, setModal] = useState(null),
    [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const lock = useRef(false);
  const match = (isReadOnly ? finishedMatches : activeMatches).find(
    (m) => m.id === matchId,
  );
  if (!match) return null;
  const target = match.settings?.targetScore || 1001,
    players = playersFor(match);
  const dealer = players[dealerFor(match)],
    nextDealer = players[dealerFor(match, match.history.length + 1)];
  const winner = match.teams.find((t) => t.score >= target);
  const valid =
    auction.teamId && auction.suit && auction.bid >= 70 && auction.bid <= 230;
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
  const record = (success, skipped = false) =>
    run(async () => {
      if (!skipped && !valid) return;
      await updateMatchState(
        matchId,
        appendRound(match, auction, success, skipped),
      );
      setAuction(initialAuction);
      setPhase("auction");
      setModal(null);
      setNotice(
        skipped
          ? "Reparto sin subasta guardado. Turno avanzado, sin sumar puntos."
          : "Resultado guardado. Listos para el siguiente reparto.",
      );
    });
  const removeRound = (round) =>
    run(async () => {
      const history = normalizeHistory(
        match,
        match.history.filter((r) => r.round !== round.round),
      );
      await updateMatchState(matchId, {
        history,
        teams: scoresFromHistory(match.teams, history),
      });
      setEditing(null);
      setModal(null);
      setPhase("auction");
      setAuction(initialAuction);
      setNotice("Reparto eliminado. Marcador y turnos recalculados.");
    });
  const saveEdit = () =>
    run(async () => {
      if (!editing.skipped && (!editing.teamId || !editing.suit)) return;
      const history = normalizeHistory(
        match,
        match.history.map((r) => (r.round === editing.round ? editing : r)),
      );
      await updateMatchState(matchId, {
        history,
        teams: scoresFromHistory(match.teams, history),
      });
      setEditing(null);
      setNotice("Reparto corregido. Marcador actualizado.");
    });
  return (
    <main
      className={`container game-page tute-game ${isReadOnly ? "read-only" : ""} animate-in`}
    >
      <Header
        title="Tute subastado"
        subtitle={
          isReadOnly ? "PARTIDA FINALIZADA" : `OBJETIVO · ${target} PUNTOS`
        }
        onBack={onBack}
        action={
          !isReadOnly && (
            <button
              className="button subtle"
              disabled={busy}
              onClick={() => setModal("finish")}
            >
              Finalizar
            </button>
          )
        }
      />
      {error && (
        <div role="alert" className="message error">
          No se ha podido guardar: {error}
        </div>
      )}
      <div
        className={`save-status ${!busy && !notice ? "idle" : ""}`}
        role="status"
      >
        {busy
          ? "Guardando…"
          : notice ||
            (isReadOnly
              ? "Consulta del resultado y los repartos"
              : "Los resultados se guardan al confirmar cada reparto")}
      </div>
      <Scores teams={match.teams} target={target} />
      {winner && !isReadOnly && (
        <section className="winner-banner">
          <Trophy size={28} />
          <div>
            <h2>¡{winner.name} gana!</h2>
            <p>Objetivo alcanzado con {winner.score} puntos.</p>
          </div>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => setModal("finish")}
          >
            Guardar y finalizar
          </button>
        </section>
      )}
      {!isReadOnly && !winner && (
        <>
          <div className="dealer-strip">
            <div className="dealer-icon">
              <Shuffle size={22} />
            </div>
            <div>
              <span className="eyebrow">
                REPARTO {match.history.length + 1}
              </span>
              <strong>
                {dealer ? `${dealer.name} reparte` : "Nuevo reparto"}
              </strong>
              <small>
                {nextDealer
                  ? `Después: ${nextDealer.name}`
                  : "Sin orden de jugadores configurado"}
              </small>
            </div>
            <span className="pill">
              {phase === "auction" ? "Subasta" : "Resultado"}
            </span>
          </div>
          <section className="panel auction-panel">
            <div className="section-heading">
              <h2>
                {phase === "auction"
                  ? "La subasta"
                  : "¿Se consiguió la subasta?"}
              </h2>
              <span className="muted">
                {phase === "auction" ? "01 / 02" : "02 / 02"}
              </span>
            </div>
            {phase === "auction" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (valid) {
                    setPhase("resolution");
                    setNotice("");
                  }
                }}
              >
                <AuctionFields
                  match={match}
                  value={auction}
                  onChange={setAuction}
                />
                <button
                  className="button primary full"
                  disabled={!valid || busy}
                >
                  Confirmar subasta <ArrowRight size={18} />
                </button>
                <button
                  type="button"
                  className="button secondary full"
                  disabled={busy}
                  onClick={() => setModal("skip")}
                >
                  <Shuffle size={18} /> Nadie subasta · volver a repartir
                </button>
              </form>
            ) : (
              <>
                <div className="auction-summary">
                  <span>
                    {match.teams.find((t) => t.id === auction.teamId)?.name}
                  </span>
                  <strong>
                    {auction.bid}
                    <small> puntos</small>
                  </strong>
                  <span>
                    {suits.find((s) => s.id === auction.suit)?.emoji}{" "}
                    {suits.find((s) => s.id === auction.suit)?.name}
                  </span>
                </div>
                <div className="choice-grid">
                  <button
                    className="result-button success"
                    disabled={busy}
                    onClick={() => record(true)}
                  >
                    <Check size={28} />
                    <strong>Conseguida</strong>
                    <small>+{auction.bid} al equipo que subasta</small>
                  </button>
                  <button
                    className="result-button failure"
                    disabled={busy}
                    onClick={() => record(false)}
                  >
                    <X size={28} />
                    <strong>No conseguida</strong>
                    <small>+{auction.bid} al otro equipo</small>
                  </button>
                </div>
                <button
                  className="button subtle full"
                  disabled={busy}
                  onClick={() => setPhase("auction")}
                >
                  Corregir subasta
                </button>
              </>
            )}
          </section>
        </>
      )}
      <section className="history-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LA PARTIDA, REPARTO A REPARTO</p>
            <h2>
              Historial <span className="count">{match.history.length}</span>
            </h2>
          </div>
          {!isReadOnly && match.history.length > 0 && (
            <button
              className="button subtle"
              disabled={busy}
              onClick={() => setModal("undo")}
            >
              <RotateCcw size={16} /> Deshacer
            </button>
          )}
        </div>
        {!match.history.length ? (
          <Empty title="La mesa está lista">
            El primer resultado aparecerá aquí. Los repartos sin subasta también
            quedan registrados.
          </Empty>
        ) : (
          <div className="history-list">
            {match.history.map((entry) => {
              const team = match.teams.find((t) => t.id === entry.teamId),
                scoring = match.teams.find((t) => t.id === entry.scoringTeamId);
              return (
                <article className="history-row" key={entry.round}>
                  <span
                    className={`round-icon ${entry.skipped ? "skipped" : entry.success ? "success" : "failure"}`}
                  >
                    {entry.skipped ? (
                      <Shuffle size={18} />
                    ) : entry.success ? (
                      <Check size={18} />
                    ) : (
                      <X size={18} />
                    )}
                  </span>
                  <div className="history-copy">
                    <strong>
                      {entry.skipped ? "Nadie subasta" : team?.name}
                    </strong>
                    <p>
                      Reparto {entry.round}
                      {entry.skipped
                        ? " · Sin puntos"
                        : ` · ${suits.find((s) => s.id === entry.suit)?.name || ""} · ${entry.success ? "Conseguida" : "No conseguida"}`}
                    </p>
                    <small>
                      {players[entry.dealerIndex]
                        ? `Repartió ${players[entry.dealerIndex].name}`
                        : ""}
                      {!entry.skipped && scoring
                        ? ` · +${entry.bid} para ${scoring.name}`
                        : ""}
                    </small>
                  </div>
                  <span className="history-points">
                    {entry.skipped ? "—" : `+${entry.bid}`}
                  </span>
                  {!isReadOnly && (
                    <button
                      className="icon-button"
                      disabled={busy}
                      aria-label={`Editar reparto ${entry.round}`}
                      onClick={() => setEditing({ ...entry })}
                    >
                      <Pencil size={17} />
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
      {modal && (
        <Modal
          title={
            modal === "skip"
              ? "¿Nadie subasta?"
              : modal === "undo"
                ? "¿Deshacer el último reparto?"
                : "¿Finalizar la partida?"
          }
          onClose={() => !busy && setModal(null)}
        >
          <p>
            {modal === "skip"
              ? `Se guardará este reparto sin puntos y ${nextDealer ? `${nextDealer.name} repartirá después` : "se avanzará el turno de repartir"}.`
              : modal === "undo"
                ? "Se quitará el último reparto y se recuperarán el marcador y el turno anteriores."
                : "El marcador y todos los repartos quedarán guardados en el historial de partidas terminadas."}
          </p>
          <div className="dialog-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              Cancelar
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                modal === "skip"
                  ? record(false, true)
                  : modal === "undo"
                    ? removeRound(match.history[0])
                    : run(async () => {
                        await finishMatch(matchId);
                        onBack();
                      })
              }
            >
              {busy
                ? "Guardando…"
                : modal === "skip"
                  ? "Volver a repartir"
                  : modal === "undo"
                    ? "Deshacer reparto"
                    : "Finalizar partida"}
            </button>
          </div>
        </Modal>
      )}
      {editing && (
        <Modal
          title={`Editar reparto ${editing.round}`}
          onClose={() => !busy && setEditing(null)}
        >
          {editing.skipped ? (
            <p>
              Reparto sin subasta. No sumó puntos y avanzó el turno de repartir.
            </p>
          ) : (
            <>
              <AuctionFields
                match={match}
                value={editing}
                onChange={setEditing}
              />
              <fieldset>
                <legend>Resultado</legend>
                <div className="choice-grid">
                  {[true, false].map((success) => (
                    <button
                      key={String(success)}
                      className={`choice ${editing.success === success ? "selected" : ""}`}
                      aria-pressed={editing.success === success}
                      onClick={() => setEditing({ ...editing, success })}
                    >
                      {success ? "Conseguida" : "No conseguida"}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          {error && (
            <p role="alert" className="message error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button danger"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "¿Eliminar este reparto y recalcular la partida?",
                  )
                )
                  removeRound(editing);
              }}
            >
              Eliminar reparto
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={saveEdit}
            >
              {busy ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
