import React from 'react';
import { Trophy, Trash2, Calendar, Eye } from 'lucide-react';
import { useGame } from '../context/GameContext';

export default function FinishedGamesList({ onViewMatch }) {
    const { finishedMatches, deleteMatch } = useGame();

    if (finishedMatches.length === 0) {
        return (
            <div className="card" style={{ textAlign: 'center', padding: '32px', opacity: 0.7 }}>
                <p>No hay partidas terminadas aún</p>
            </div>
        );
    }

    return (
        <div style={{ display: 'grid', gap: '12px' }}>
            {finishedMatches.map((match) => {
                // Determine winner (simple logic: highest score)
                const winner = [...match.teams].sort((a, b) => b.score - a.score)[0];

                return (
                    <div
                        key={match.id}
                        onClick={() => onViewMatch && onViewMatch(match.id)}
                        className="card"
                        style={{
                            padding: '16px',
                            cursor: onViewMatch ? 'pointer' : 'default',
                            transition: 'background 0.2s',
                            position: 'relative'
                        }}
                        onMouseEnter={(e) => onViewMatch && (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                        onMouseLeave={(e) => onViewMatch && (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                            <span className="badge" style={{ textTransform: 'uppercase', fontSize: '10px', background: 'rgba(255, 255, 255, 0.1)' }}>
                                {match.gameId === 'tute' ? 'Tute' : 'Counter'}
                            </span>
                            <span style={{ fontSize: '12px', opacity: 0.5, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Calendar size={12} />
                                {new Date(match.endTime).toLocaleDateString()}
                            </span>
                            {onViewMatch && (
                                <span style={{ fontSize: '10px', opacity: 0.4, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Eye size={12} />
                                    Ver
                                </span>
                            )}
                        </div>

                        {/* Team scores */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                            {match.teams.map((team) => (
                                <div
                                    key={team.id}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '6px 8px',
                                        borderRadius: '8px',
                                        background: team.id === winner.id ? 'rgba(255, 215, 0, 0.1)' : 'rgba(255,255,255,0.03)',
                                        border: team.id === winner.id ? '1px solid rgba(255, 215, 0, 0.3)' : '1px solid transparent'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        {team.id === winner.id && <Trophy size={14} color="#ffd700" />}
                                        <span style={{
                                            fontWeight: team.id === winner.id ? 'bold' : 'normal',
                                            color: team.id === winner.id ? '#ffd700' : 'inherit'
                                        }}>
                                            {team.name}
                                        </span>
                                    </div>
                                    <span style={{
                                        fontWeight: 'bold',
                                        fontSize: '16px',
                                        color: team.id === winner.id ? '#ffd700' : 'inherit'
                                    }}>
                                        {team.score}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Delete button */}
                        <div style={{
                            borderTop: '1px solid rgba(255,255,255,0.1)',
                            marginTop: '8px',
                            paddingTop: '8px',
                            display: 'flex',
                            justifyContent: 'flex-end'
                        }}>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm('¿Eliminar este registro?')) {
                                        deleteMatch(match.id, 'finished');
                                    }
                                }}
                                className="btn-icon"
                                style={{ background: 'rgba(255, 50, 50, 0.1)', color: '#ff3232' }}
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
