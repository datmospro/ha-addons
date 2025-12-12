import React, { useState } from 'react';
import { useGame } from '../../context/GameContext';
import { Trophy, History, CheckCircle, XCircle, ChevronLeft, Edit2, Trash2, Save, X } from 'lucide-react';

export default function TuteSubastado({ matchId, onBack, isReadOnly = false }) {
    const { activeMatches, finishedMatches, updateMatchState, finishMatch } = useGame();
    const activeMatch = isReadOnly
        ? finishedMatches.find(m => m.id === matchId)
        : activeMatches.find(m => m.id === matchId);

    // Round phase: 'auction' or 'resolution'
    const [phase, setPhase] = useState('auction');
    const [currentAuction, setCurrentAuction] = useState({
        teamId: null,
        bid: 70,
        suit: null
    });
    const [animateScore, setAnimateScore] = useState(null);
    const [editingRound, setEditingRound] = useState(null);

    if (!activeMatch) return null;

    const targetScore = activeMatch.settings.targetScore || 1001;
    const winner = activeMatch.teams.find(t => t.score >= targetScore);
    const [showFinishConfirm, setShowFinishConfirm] = useState(false);

    const suits = [
        { id: 'oros', name: 'Oros', emoji: '💰', color: '#fbbf24' },
        { id: 'copas', name: 'Copas', emoji: '🏆', color: '#ef4444' },
        { id: 'espadas', name: 'Espadas', emoji: '⚔️', color: '#3b82f6' },
        { id: 'bastos', name: 'Bastos', emoji: '🎋', color: '#10b981' }
    ];

    // Get all players from both teams
    const getAllPlayers = () => {
        // Use saved player order if available (for consistent dealer rotation)
        if (activeMatch.settings.playerOrder && activeMatch.settings.playerOrder.length > 0) {
            return activeMatch.settings.playerOrder.map(p => {
                const team = activeMatch.teams.find(t => t.id === p.teamId);
                return {
                    name: p.name,
                    teamName: team ? team.name : '',
                    teamId: p.teamId
                };
            });
        }

        // Fallback to old method if no playerOrder saved
        const allPlayers = [];
        activeMatch.teams.forEach(team => {
            if (team.players && team.players.length > 0) {
                team.players.forEach(playerName => {
                    allPlayers.push({
                        name: playerName,
                        teamName: team.name,
                        teamId: team.id
                    });
                });
            }
        });
        return allPlayers;
    };

    const allPlayers = getAllPlayers();
    const hasPlayers = allPlayers.length > 0;

    // Calculate current dealer
    const getCurrentDealer = () => {
        if (!hasPlayers) return null;
        const startingDealerIndex = activeMatch.settings.startingDealerIndex || 0;
        const currentRound = activeMatch.history.length;
        const currentDealerIndex = (startingDealerIndex + currentRound) % allPlayers.length;
        return allPlayers[currentDealerIndex];
    };

    const currentDealer = getCurrentDealer();

    const handleAuctionSubmit = (e) => {
        e.preventDefault();
        if (isReadOnly) return; // Prevent actions in read-only mode
        if (!currentAuction.teamId || !currentAuction.bid || !currentAuction.suit) return;
        setPhase('resolution');
    };



    const handleResolution = (success) => {
        if (isReadOnly) return; // Prevent actions in read-only mode
        const bid = parseInt(currentAuction.bid);
        const winningTeamId = currentAuction.teamId;
        const losingTeamId = activeMatch.teams.find(t => t.id !== winningTeamId)?.id;

        // Determine who gets the points
        const scoringTeamId = success ? winningTeamId : losingTeamId;

        // Trigger animation
        setAnimateScore(scoringTeamId);
        setTimeout(() => setAnimateScore(null), 1000);

        const newTeams = activeMatch.teams.map(t =>
            t.id === scoringTeamId ? { ...t, score: t.score + bid } : t
        );

        // Calculate dealer index for this round
        const startingDealerIndex = activeMatch.settings.startingDealerIndex || 0;
        const currentRound = activeMatch.history.length;
        const dealerIndex = hasPlayers ? (startingDealerIndex + currentRound) % allPlayers.length : null;

        const newHistory = [
            {
                round: activeMatch.history.length + 1,
                teamId: winningTeamId,
                bid: bid,
                suit: currentAuction.suit,
                success: success,
                scoringTeamId: scoringTeamId,
                dealerIndex: dealerIndex,
                timestamp: new Date().toISOString()
            },
            ...activeMatch.history
        ];

        updateMatchState(matchId, { teams: newTeams, history: newHistory });

        // Reset for next round
        setCurrentAuction({ teamId: null, bid: 70, suit: null });
        setPhase('auction');
    };

    // Helper to recalculate all scores from history
    const recalculateTeams = (history, currentTeams) => {
        // Reset scores
        const resetTeams = currentTeams.map(t => ({ ...t, score: 0 }));

        // Replay history
        history.forEach(round => {
            const bid = parseInt(round.bid);
            const scoringTeamId = round.success ? round.teamId : (
                // Find the other team
                resetTeams.find(t => t.id !== round.teamId)?.id
            );

            const teamIndex = resetTeams.findIndex(t => t.id === scoringTeamId);
            if (teamIndex !== -1) {
                resetTeams[teamIndex].score += bid;
            }
        });

        return resetTeams;
    };

    const handleUpdateRound = (updatedRound) => {
        const newHistory = activeMatch.history.map(r =>
            r.round === updatedRound.round ? updatedRound : r
        );

        const newTeams = recalculateTeams(newHistory, activeMatch.teams);
        updateMatchState(matchId, { teams: newTeams, history: newHistory });
        setEditingRound(null);
    };

    const handleDeleteRound = (roundToDelete) => {
        if (!window.confirm('¿Seguro que quieres eliminar esta ronda?')) return;

        const newHistory = activeMatch.history.filter(r => r.round !== roundToDelete.round);

        // Re-number rounds to keep consistency (optional but good for display)
        // Note: If we re-number, we might change "round 5" to "round 4" if we deleted 3.
        // Let's keep it simple for now and re-number to ensure continuity.
        const reorderedHistory = newHistory.map((r, index) => ({
            ...r,
            round: newHistory.length - index // Assuming new-to-old order
        }));

        const newTeams = recalculateTeams(reorderedHistory, activeMatch.teams);
        updateMatchState(matchId, { teams: newTeams, history: reorderedHistory });
        setEditingRound(null);
    };

    if (winner && !isReadOnly) {
        return (
            <div style={{
                position: 'fixed', inset: 0, zIndex: 50,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(20px)'
            }} className="animate-in">
                <Trophy size={120} color="#facc15" style={{ marginBottom: '32px', filter: 'drop-shadow(0 0 30px rgba(250,204,21,0.6))' }} />
                <h2 style={{ fontSize: '48px', fontWeight: 'bold', color: '#facc15', marginBottom: '16px' }}>
                    ¡{winner.name} Gana!
                </h2>
                <p style={{ fontSize: '24px', color: 'rgba(254,240,138,0.6)', marginBottom: '48px', fontFamily: 'monospace' }}>
                    PUNTUACIÓN: {winner.score}
                </p>
                <div style={{ display: 'flex', gap: '16px' }}>
                    <button
                        onClick={onBack}
                        className="btn"
                        style={{ background: 'rgba(255,255,255,0.1)', color: 'white', padding: '16px 32px', borderRadius: '50px', fontSize: '18px' }}
                    >
                        Volver al Menú
                    </button>
                    <button
                        onClick={() => {
                            finishMatch(matchId);
                            onBack();
                        }}
                        className="btn"
                        style={{ background: 'white', color: 'black', padding: '16px 48px', borderRadius: '50px', fontSize: '20px' }}
                    >
                        Finalizar Juego
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="container animate-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', paddingBottom: '60px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '4px' }}>
                        <ChevronLeft size={20} />
                    </button>
                    <h2 style={{ marginLeft: '8px', fontSize: '16px', fontWeight: 'bold' }}>
                        Tute Subastado
                        {isReadOnly && <span style={{ fontSize: '10px', opacity: 0.5, marginLeft: '8px' }}>(Finalizada)</span>}
                    </h2>
                </div>
                {!isReadOnly && !winner && (
                    <button
                        onClick={() => setShowFinishConfirm(true)}
                        className="btn-icon"
                        style={{ background: 'rgba(139, 92, 246, 0.2)', color: '#a78bfa', fontSize: '10px', padding: '6px 12px', borderRadius: '8px' }}
                    >
                        Finalizar
                    </button>
                )}
            </div>

            {/* Edit Round Modal */}
            {editingRound && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 100,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)'
                }}>
                    <div className="glass-panel" style={{ width: '90%', maxWidth: '400px', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Editar Ronda #{editingRound.round}</h3>
                            <button onClick={() => setEditingRound(null)} style={{ background: 'none', border: 'none', color: 'white', opacity: 0.5 }}>
                                <X size={24} />
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* Team Selection */}
                            <div>
                                <label className="text-xs" style={{ display: 'block', marginBottom: '8px', opacity: 0.6 }}>EQUIPO</label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    {activeMatch.teams.map(team => (
                                        <button
                                            key={team.id}
                                            onClick={() => setEditingRound({ ...editingRound, teamId: team.id })}
                                            className="btn"
                                            style={{
                                                flex: 1,
                                                padding: '10px',
                                                background: editingRound.teamId === team.id ? 'linear-gradient(90deg, #3b82f6, #2563eb)' : 'rgba(255,255,255,0.05)',
                                                border: editingRound.teamId === team.id ? '1px solid #60a5fa' : '1px solid rgba(255,255,255,0.1)'
                                            }}
                                        >
                                            {team.name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Bid Input */}
                            <div>
                                <label className="text-xs" style={{ display: 'block', marginBottom: '8px', opacity: 0.6 }}>APUESTA</label>
                                <input
                                    type="number"
                                    value={editingRound.bid}
                                    onChange={(e) => setEditingRound({ ...editingRound, bid: parseInt(e.target.value) || 0 })}
                                    style={{
                                        width: '100%',
                                        background: 'rgba(0,0,0,0.3)',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '8px',
                                        padding: '12px',
                                        fontSize: '24px',
                                        textAlign: 'center',
                                        color: 'white',
                                        fontFamily: 'monospace'
                                    }}
                                />
                            </div>

                            {/* Suit Selection */}
                            <div>
                                <label className="text-xs" style={{ display: 'block', marginBottom: '8px', opacity: 0.6 }}>PALO</label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                                    {suits.map(suit => (
                                        <button
                                            key={suit.id}
                                            type="button"
                                            onClick={() => setEditingRound({ ...editingRound, suit: suit.id })}
                                            style={{
                                                padding: '10px 4px',
                                                background: editingRound.suit === suit.id ? `${suit.color}30` : 'rgba(255,255,255,0.05)',
                                                border: editingRound.suit === suit.id ? `2px solid ${suit.color}` : '1px solid rgba(255,255,255,0.1)',
                                                borderRadius: '8px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                gap: '2px'
                                            }}
                                        >
                                            <span style={{ fontSize: '20px' }}>{suit.emoji}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Success Toggle */}
                            <div>
                                <label className="text-xs" style={{ display: 'block', marginBottom: '8px', opacity: 0.6 }}>RESULTADO</label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button
                                        onClick={() => setEditingRound({ ...editingRound, success: true })}
                                        className="btn"
                                        style={{
                                            flex: 1,
                                            padding: '12px',
                                            background: editingRound.success ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.05)',
                                            color: editingRound.success ? '#34d399' : '#9ca3af',
                                            border: editingRound.success ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                                        }}
                                    >
                                        <CheckCircle size={20} /> Conseguido
                                    </button>
                                    <button
                                        onClick={() => setEditingRound({ ...editingRound, success: false })}
                                        className="btn"
                                        style={{
                                            flex: 1,
                                            padding: '12px',
                                            background: !editingRound.success ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255,255,255,0.05)',
                                            color: !editingRound.success ? '#f87171' : '#9ca3af',
                                            border: !editingRound.success ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.1)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                                        }}
                                    >
                                        <XCircle size={20} /> Fracasado
                                    </button>
                                </div>
                            </div>

                            {/* Actions */}
                            <div style={{ display: 'flex', gap: '12px', marginTop: '12px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                                <button
                                    onClick={() => handleDeleteRound(editingRound)}
                                    className="btn"
                                    style={{
                                        padding: '12px',
                                        background: 'rgba(239, 68, 68, 0.1)',
                                        color: '#ef4444',
                                        border: '1px solid rgba(239, 68, 68, 0.2)'
                                    }}
                                >
                                    <Trash2 size={20} />
                                </button>
                                <button
                                    onClick={() => handleUpdateRound(editingRound)}
                                    className="btn"
                                    style={{
                                        flex: 1,
                                        padding: '12px',
                                        background: 'linear-gradient(90deg, #8b5cf6, #a78bfa)',
                                        color: 'white',
                                        fontWeight: 'bold',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                                    }}
                                >
                                    <Save size={20} /> Guardar Cambios
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Finish Confirmation Dialog */}
            {showFinishConfirm && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 100,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)'
                }}>
                    <div className="glass-panel" style={{ maxWidth: '400px', padding: '24px', textAlign: 'center' }}>
                        <h3 style={{ fontSize: '18px', marginBottom: '12px' }}>¿Finalizar Partida?</h3>
                        <p style={{ fontSize: '14px', opacity: 0.7, marginBottom: '24px' }}>
                            Esto terminará la partida y la guardará en partidas finalizadas.
                        </p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                            <button
                                onClick={() => setShowFinishConfirm(false)}
                                className="btn"
                                style={{ background: 'rgba(255,255,255,0.1)', padding: '12px 24px' }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    finishMatch(matchId);
                                    setShowFinishConfirm(false);
                                    onBack();
                                }}
                                className="btn"
                                style={{ background: 'linear-gradient(90deg, #8b5cf6, #a78bfa)', padding: '12px 24px' }}
                            >
                                Finalizar Partida
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Scoreboard */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                {activeMatch.teams.map((team) => {
                    const isWinning = team.score >= targetScore * 0.9;
                    const progress = Math.min((team.score / targetScore) * 100, 100);

                    return (
                        <div
                            key={team.id}
                            className="glass-panel"
                            style={{
                                position: 'relative', overflow: 'hidden', textAlign: 'center', padding: '12px 8px',
                                borderColor: isWinning ? '#ef4444' : 'rgba(255,255,255,0.1)',
                                background: isWinning ? 'rgba(127,29,29,0.5)' : 'rgba(255,255,255,0.05)'
                            }}
                        >
                            <div style={{
                                position: 'absolute', bottom: 0, left: 0, height: '3px',
                                background: 'linear-gradient(90deg, #3b82f6, #a855f7)',
                                width: `${progress}%`, transition: 'width 1s ease'
                            }} />

                            <h3 className="text-xs" style={{ marginBottom: '4px', fontSize: '10px' }}>{team.name}</h3>
                            <div style={{
                                fontSize: '32px', fontWeight: 'bold', fontFamily: 'monospace', lineHeight: 1,
                                color: animateScore === team.id ? '#60a5fa' : 'white',
                                transform: animateScore === team.id ? 'scale(1.2)' : 'scale(1)',
                                transition: 'all 0.3s'
                            }}>
                                {team.score}
                            </div>
                            <div className="text-xs" style={{ marginTop: '4px', opacity: 0.5, fontSize: '9px' }}>OBJETIVO: {targetScore}</div>
                        </div>
                    );
                })}
            </div>

            {/* AUCTION PHASE */}
            {!isReadOnly && phase === 'auction' && (
                <form onSubmit={handleAuctionSubmit} className="glass-panel" style={{ marginBottom: '12px', padding: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <h3 className="text-sm" style={{ opacity: 0.8, fontSize: '12px' }}>SUBASTA - Ronda #{activeMatch.history.length + 1}</h3>
                        {currentDealer && (
                            <div style={{
                                fontSize: '10px',
                                padding: '4px 8px',
                                background: 'rgba(251, 191, 36, 0.2)',
                                border: '1px solid rgba(251, 191, 36, 0.3)',
                                borderRadius: '12px',
                                color: '#fbbf24',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}>
                                🃏 {currentDealer.name}
                            </div>
                        )}
                    </div>

                    {/* Team Selection */}
                    <div style={{ marginBottom: '12px' }}>
                        <label className="text-xs" style={{ display: 'block', marginBottom: '6px', opacity: 0.6, fontSize: '10px' }}>EQUIPO GANADOR</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                            {activeMatch.teams.map(team => (
                                <button
                                    key={team.id}
                                    type="button"
                                    onClick={() => setCurrentAuction({ ...currentAuction, teamId: team.id })}
                                    className="btn"
                                    style={{
                                        padding: '8px',
                                        fontSize: '13px',
                                        background: currentAuction.teamId === team.id ? 'linear-gradient(90deg, #2563eb, #3b82f6)' : 'rgba(255,255,255,0.05)',
                                        color: currentAuction.teamId === team.id ? 'white' : '#9ca3af',
                                        border: currentAuction.teamId === team.id ? '2px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)'
                                    }}
                                >
                                    {team.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Bid Points - Scroll Picker */}
                    <div style={{ marginBottom: '12px' }}>
                        <label className="text-xs" style={{ display: 'block', marginBottom: '6px', opacity: 0.6, textAlign: 'center', fontSize: '10px' }}>PUNTOS APOSTADOS</label>
                        <div style={{
                            position: 'relative',
                            height: '120px',
                            overflow: 'hidden',
                            background: 'rgba(0, 0, 0, 0.2)',
                            borderRadius: '12px',
                            border: '1px solid rgba(255, 255, 255, 0.1)'
                        }}>
                            {/* Selection highlight */}
                            <div style={{
                                position: 'absolute',
                                top: '50%',
                                left: '0',
                                right: '0',
                                height: '40px',
                                transform: 'translateY(-50%)',
                                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.3), rgba(139, 92, 246, 0.3))',
                                border: '2px solid rgba(59, 130, 246, 0.5)',
                                borderRadius: '8px',
                                pointerEvents: 'none',
                                zIndex: 1
                            }} />

                            {/* Scrollable container */}
                            <div
                                style={{
                                    height: '100%',
                                    overflowY: 'scroll',
                                    scrollSnapType: 'y mandatory',
                                    paddingTop: '40px',
                                    paddingBottom: '40px',
                                    WebkitOverflowScrolling: 'touch'
                                }}
                                onScroll={(e) => {
                                    const scrollTop = e.target.scrollTop;
                                    const itemHeight = 40;
                                    const index = Math.round(scrollTop / itemHeight);
                                    const newBid = 70 + (index * 5);
                                    if (newBid >= 70 && newBid <= 230 && newBid !== currentAuction.bid) {
                                        setCurrentAuction({ ...currentAuction, bid: newBid });
                                    }
                                }}
                            >
                                {Array.from({ length: 33 }, (_, i) => {
                                    const value = 70 + (i * 5);
                                    const isSelected = value === currentAuction.bid;
                                    return (
                                        <div
                                            key={value}
                                            style={{
                                                height: '40px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                scrollSnapAlign: 'center',
                                                fontSize: isSelected ? '28px' : '18px',
                                                fontWeight: isSelected ? 'bold' : 'normal',
                                                color: isSelected ? 'white' : 'rgba(255, 255, 255, 0.4)',
                                                fontFamily: 'monospace',
                                                transition: 'all 0.2s',
                                                opacity: isSelected ? 1 : 0.5,
                                                cursor: 'pointer'
                                            }}
                                            onClick={() => {
                                                const container = document.querySelector('[data-scroll-picker]');
                                                if (container) {
                                                    container.scrollTop = i * 40;
                                                }
                                            }}
                                        >
                                            {value}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Gradient overlays */}
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                height: '40px',
                                background: 'linear-gradient(to bottom, rgba(30, 30, 50, 1), transparent)',
                                pointerEvents: 'none'
                            }} />
                            <div style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                height: '40px',
                                background: 'linear-gradient(to top, rgba(30, 30, 50, 1), transparent)',
                                pointerEvents: 'none'
                            }} />
                        </div>
                    </div>

                    {/* Suit Selection */}
                    <div style={{ marginBottom: '12px' }}>
                        <label className="text-xs" style={{ display: 'block', marginBottom: '6px', opacity: 0.6, fontSize: '10px' }}>PALO</label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                            {suits.map(suit => (
                                <button
                                    key={suit.id}
                                    type="button"
                                    onClick={() => setCurrentAuction({ ...currentAuction, suit: suit.id })}
                                    style={{
                                        padding: '10px 4px',
                                        background: currentAuction.suit === suit.id ? `${suit.color}30` : 'rgba(255,255,255,0.05)',
                                        border: currentAuction.suit === suit.id ? `2px solid ${suit.color}` : '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '8px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '2px',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <span style={{ fontSize: '22px' }}>{suit.emoji}</span>
                                    <span style={{ fontSize: '9px', fontWeight: '600', color: currentAuction.suit === suit.id ? suit.color : '#9ca3af' }}>
                                        {suit.name}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={!currentAuction.teamId || !currentAuction.bid || !currentAuction.suit}
                        className="btn btn-primary"
                        style={{ width: '100%' }}
                    >
                        Confirmar Subasta
                    </button>
                </form>
            )}

            {/* RESOLUTION PHASE */}
            {!isReadOnly && phase === 'resolution' && (
                <div className="glass-panel" style={{ marginBottom: '24px' }}>
                    <h3 className="text-sm" style={{ marginBottom: '16px', opacity: 0.8 }}>RESOLUCIÓN - Ronda #{activeMatch.history.length + 1}</h3>

                    {/* Auction Summary */}
                    <div style={{
                        background: 'rgba(59, 130, 246, 0.1)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '12px',
                        padding: '16px',
                        marginBottom: '20px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span className="text-sm" style={{ opacity: 0.7 }}>Equipo:</span>
                            <span className="text-lg font-bold">
                                {activeMatch.teams.find(t => t.id === currentAuction.teamId)?.name}
                            </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span className="text-sm" style={{ opacity: 0.7 }}>Apuesta:</span>
                            <span className="text-lg font-bold" style={{ fontFamily: 'monospace' }}>
                                {currentAuction.bid} pts
                            </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="text-sm" style={{ opacity: 0.7 }}>Palo:</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '24px' }}>
                                    {suits.find(s => s.id === currentAuction.suit)?.emoji}
                                </span>
                                <span className="text-lg font-bold">
                                    {suits.find(s => s.id === currentAuction.suit)?.name}
                                </span>
                            </span>
                        </div>
                    </div>

                    <p className="text-sm" style={{ marginBottom: '16px', textAlign: 'center', opacity: 0.7 }}>
                        ¿Consiguieron los puntos?
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <button
                            onClick={() => handleResolution(true)}
                            className="btn"
                            style={{
                                background: 'linear-gradient(135deg, #10b981, #059669)',
                                color: 'white',
                                padding: '20px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '8px',
                                fontSize: '16px',
                                fontWeight: 'bold'
                            }}
                        >
                            <CheckCircle size={32} />
                            Conseguido
                        </button>
                        <button
                            onClick={() => handleResolution(false)}
                            className="btn"
                            style={{
                                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                                color: 'white',
                                padding: '20px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '8px',
                                fontSize: '16px',
                                fontWeight: 'bold'
                            }}
                        >
                            <XCircle size={32} />
                            Fracasado
                        </button>
                    </div>
                </div>
            )}

            {/* History */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <h4 className="text-xs" style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.6 }}>
                    <History size={12} /> HISTORIAL
                </h4>
                <div style={{ flex: 1, overflowY: 'auto', paddingRight: '8px' }}>
                    {activeMatch.history.map((entry, i) => {
                        const team = activeMatch.teams.find(t => t.id === entry.teamId);
                        const suit = suits.find(s => s.id === entry.suit);
                        const scoringTeam = activeMatch.teams.find(t => t.id === entry.scoringTeamId);
                        const dealer = (entry.dealerIndex !== null && entry.dealerIndex !== undefined && allPlayers[entry.dealerIndex])
                            ? allPlayers[entry.dealerIndex]
                            : null;

                        return (
                            <div
                                key={i}
                                style={{
                                    padding: '12px',
                                    marginBottom: '8px',
                                    borderRadius: '12px',
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.05)'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <div style={{
                                            width: '24px',
                                            height: '24px',
                                            borderRadius: '50%',
                                            background: '#1f2937',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '10px',
                                            fontWeight: 'bold',
                                            color: '#6b7280'
                                        }}>
                                            #{entry.round}
                                        </div>
                                        <span style={{ fontSize: '14px', fontWeight: '500' }}>{team?.name}</span>
                                        <span style={{ fontSize: '18px' }}>{suit?.emoji}</span>
                                    </div>
                                    <span style={{
                                        fontWeight: 'bold',
                                        fontSize: '16px',
                                        color: entry.success ? '#10b981' : '#ef4444',
                                        fontFamily: 'monospace'
                                    }}>
                                        {entry.success ? '✓' : '✗'} {entry.bid}
                                    </span>
                                </div>
                                <div style={{ fontSize: '11px', opacity: 0.5, paddingLeft: '32px', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{entry.success ? 'Conseguido' : `Fracasado → ${scoringTeam?.name}`}</span>
                                    {dealer && (
                                        <span style={{ color: '#fbbf24' }}>🃏 {dealer.name}</span>
                                    )}
                                </div>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'flex-end',
                                    marginTop: '8px',
                                    paddingTop: '8px',
                                    borderTop: '1px solid rgba(255,255,255,0.05)'
                                }}>
                                    <button
                                        onClick={() => setEditingRound(entry)}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: 'rgba(255,255,255,0.4)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            fontSize: '10px',
                                            gap: '4px',
                                        }}
                                    >
                                        <Edit2 size={12} /> Editar
                                    </button>
                                </div>

                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
