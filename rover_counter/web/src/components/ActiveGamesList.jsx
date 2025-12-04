import React from 'react';
import { Play, Trash2, Clock } from 'lucide-react';
import { useGame } from '../context/GameContext';

export default function ActiveGamesList({ onResume }) {
    const { activeMatches, deleteMatch } = useGame();

    if (activeMatches.length === 0) {
        return (
            <div className="card" style={{ textAlign: 'center', padding: '32px', opacity: 0.7 }}>
                <p>No hay partidas en curso</p>
            </div>
        );
    }

    return (
        <div style={{ display: 'grid', gap: '12px' }}>
            {activeMatches.map((match) => (
                <div key={match.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <span className="badge" style={{ textTransform: 'uppercase', fontSize: '10px' }}>
                                {match.gameId === 'tute' ? 'Tute' : 'Counter'}
                            </span>
                            <span style={{ fontSize: '12px', opacity: 0.5, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Clock size={12} />
                                {new Date(match.startTime).toLocaleDateString()}
                            </span>
                        </div>
                        <div style={{ fontSize: '14px' }}>
                            {match.teams.map(t => t.name).join(' vs ')}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={() => onResume(match.id)}
                            className="btn-icon"
                            style={{ background: 'rgba(0, 255, 100, 0.1)', color: '#00ff64' }}
                        >
                            <Play size={20} />
                        </button>
                        <button
                            onClick={() => {
                                if (confirm('¿Estás seguro de que quieres eliminar esta partida?')) {
                                    deleteMatch(match.id, 'active');
                                }
                            }}
                            className="btn-icon"
                            style={{ background: 'rgba(255, 50, 50, 0.1)', color: '#ff3232' }}
                        >
                            <Trash2 size={20} />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
