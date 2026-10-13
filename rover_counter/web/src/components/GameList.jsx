import { Spade, Calculator, ArrowUpRight } from "lucide-react";
export default function GameList({ onSelectGame }) {
  return (
    <div className="game-list">
      {[
        {
          id: "tute",
          name: "Tute subastado",
          tag: "EL CLÁSICO DE LA MESA",
          description: "Subasta, triunfo y marcador. Dos equipos, un objetivo.",
          icon: Spade,
        },
        {
          id: "generic",
          name: "Contador libre",
          tag: "A TU MANERA",
          description:
            "Puntos y dados para cualquier juego. Tú eliges las reglas.",
          icon: Calculator,
        },
      ].map((game) => (
        <button
          key={game.id}
          className={`game-tile ${game.id}`}
          onClick={() => onSelectGame(game.id)}
        >
          <game.icon size={34} />
          <p className="eyebrow">{game.tag}</p>
          <h2>{game.name}</h2>
          <p>{game.description}</p>
          <span>
            Preparar la partida <ArrowUpRight size={18} />
          </span>
        </button>
      ))}
    </div>
  );
}
