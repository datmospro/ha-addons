import React from 'react';
import { Calculator, Dices, ChevronRight } from 'lucide-react';

export default function GameList({ onSelectGame }) {
    const games = [
        {
            id: 'generic',
            name: 'Contador',
            icon: Calculator,
            description: 'Contador simple para cualquier juego'
        },
        {
            id: 'tute',
            name: 'Tute Subastado',
            icon: Dices,
            description: '2 Equipos. Puntuación objetivo. Por rondas.'
        },
    ];

    return (
        <div className="container animate-in">
            <div className="header" style={{ display: 'block', textAlign: 'center', marginBottom: '40px' }}>
                <h1 className="header-title" style={{ fontSize: '32px', marginBottom: '8px' }}>Rover Counter</h1>
                <p className="text-sm">SELECCIONA TU DESAFÍO</p>
            </div>

            <div style={{ display: 'grid', gap: '16px' }}>
                {games.map((game, idx) => (
                    <button
                        key={game.id}
                        onClick={() => onSelectGame(game.id)}
                        className="card"
                        style={{ animationDelay: `${idx * 0.1}s` }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{
                                background: 'rgba(0, 210, 255, 0.1)',
                                padding: '12px',
                                borderRadius: '12px',
                                color: '#00d2ff'
                            }}>
                                <game.icon size={24} />
                            </div>
                            <div>
                                <h3 className="text-lg">{game.name}</h3>
                                <p className="text-sm" style={{ marginTop: '4px' }}>{game.description}</p>
                            </div>
                        </div>
                        <ChevronRight size={20} style={{ opacity: 0.5 }} />
                    </button>
                ))}
            </div>
        </div>
    );
}
