import { useTheme } from "../context/ThemeContext";
import { themes } from "../utils/theme.mjs";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, X, Palette, Check } from "lucide-react";
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
      <ThemePicker />
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

export function ThemePicker() {
  const { theme, selectTheme, persisted } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="icon-button theme-trigger"
        aria-label="Cambiar estilo"
        title="Cambiar estilo"
        onClick={() => setOpen(true)}
      >
        <Palette size={19} />
      </button>
      {open && (
        <Modal title="Elige tu estilo" onClose={() => setOpen(false)}>
          <p>
            Cambia el aspecto sin salir de la partida. La elección se guarda
            solo en este navegador.
          </p>
          <div className="theme-options">
            {themes.map((option) => (
              <button
                className={`theme-option ${theme === option.id ? "chosen" : ""}`}
                key={option.id}
                aria-pressed={theme === option.id}
                onClick={() => selectTheme(option.id)}
              >
                <span
                  className={`theme-preview preview-${option.id}`}
                  aria-hidden="true"
                >
                  <span>420</span>
                  <span>350</span>
                </span>
                <span className="theme-option-copy">
                  <strong>{option.name}</strong>
                  <small>{option.description}</small>
                </span>
                {theme === option.id && <Check size={19} />}
              </button>
            ))}
          </div>
          {!persisted && (
            <p className="message error" role="status">
              Tu navegador no permite guardar preferencias. El estilo seguirá
              activo mientras mantengas abierta la aplicación.
            </p>
          )}
          <button
            className="button primary full"
            onClick={() => setOpen(false)}
          >
            Listo
          </button>
        </Modal>
      )}
    </>
  );
}
export function SuitIcon({ suit, emoji }) {
  return (
    <span className={`suit-art suit-art-${suit}`} aria-hidden="true">
      <span className="suit-emoji">{emoji}</span>
    </span>
  );
}
