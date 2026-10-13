import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, X } from "lucide-react";
export function Header({ title, subtitle, onBack, action }) {
  return (
    <header className="page-header">
      {onBack && (
        <button className="icon-button" onClick={onBack} aria-label="Volver">
          <ArrowLeft size={21} />
        </button>
      )}
      <div className="header-copy">
        <p className="eyebrow">{subtitle || "ROVER COUNTER"}</p>
        <h1>{title}</h1>
      </div>
      {action}
    </header>
  );
}
export function Empty({ title, children }) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">✦</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Modal({ title, children, onClose }) {
  const ref = useRef(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const keydown = (e) => {
      if (e.key === "Escape") close.current();
      if (e.key !== "Tab") return;
      const elements = [
        ...ref.current.querySelectorAll(
          'button:not(:disabled), input, select, [tabindex="0"]',
        ),
      ];
      const first = elements[0],
        last = elements.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === ref.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="section-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Cerrar" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
export function Scores({ teams, target }) {
  return (
    <div className="score-grid">
      {teams.map((team, i) => (
        <section className={`score-card team-${i % 2}`} key={team.id}>
          <span className="team-label">EQUIPO {i + 1}</span>
          <h2>{team.name}</h2>
          <p className="players-label">
            {team.players?.join(" · ") || "Equipo"}
          </p>
          <strong className="score-number">{team.score}</strong>
          {target > 0 && (
            <>
              <div
                className="score-track"
                role="progressbar"
                aria-label={`Puntos de ${team.name}`}
                aria-valuemin={0}
                aria-valuemax={target}
                aria-valuenow={Math.min(Math.max(team.score, 0), target)}
              >
                <span
                  style={{
                    width: `${Math.min(100, Math.max(0, (team.score / target) * 100))}%`,
                  }}
                />
              </div>
              <small>
                A {Math.max(0, target - team.score)} puntos del objetivo
              </small>
            </>
          )}
        </section>
      ))}
    </div>
  );
}
