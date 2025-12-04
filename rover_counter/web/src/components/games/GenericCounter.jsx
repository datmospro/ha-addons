import React, { useState } from 'react';
import { Plus, Minus, RotateCcw, ChevronLeft, CheckCircle, Trophy, Dices, X } from 'lucide-react';
import { useGame } from '../../context/GameContext';

export default function GenericCounter({ matchId, onBack, isReadOnly = false }) {
    const { activeMatches, finishedMatches, updateMatchState, finishMatch } = useGame();

    const activeMatch = isReadOnly
        ? finishedMatches.find(m => m.id === matchId)
        : activeMatches.find(m => m.id === matchId);

    const [showFinishConfirm, setShowFinishConfirm] = useState(false);
    const [animateScore, setAnimateScore] = useState(null);

    // Dice State
    const [diceResult, setDiceResult] = useState(null);
    const [isRolling, setIsRolling] = useState(false);

    if (!activeMatch) return null;

    const targetScore = activeMatch.settings?.targetScore;
    const hasTarget = targetScore !== null && targetScore !== undefined && targetScore > 0;

    // Determine winner if target score is set
    const winner = hasTarget ? activeMatch.teams.find(t => t.score >= targetScore) : null;

    const updateScore = (teamId, delta) => {
        if (isReadOnly) return;

        setAnimateScore(teamId);
        setTimeout(() => setAnimateScore(null), 300);

        const newTeams = activeMatch.teams.map(t =>
            t.id === teamId ? { ...t, score: t.score + delta } : t
        );
        updateMatchState(matchId, { teams: newTeams });
    };

    const rollDice = (count) => {
        setIsRolling(true);
        setDiceResult(null);

        // Animation effect
        let rolls = 0;
        const maxRolls = 10;
        const interval = setInterval(() => {
            const tempResult = Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
            setDiceResult(tempResult);
            rolls++;
            if (rolls >= maxRolls) {
                clearInterval(interval);
                setIsRolling(false);
            }
        }, 50);
    };

    // Winner Screen
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '4px' }}>
                        <ChevronLeft size={20} />
                    </button>
                    <h2 style={{ marginLeft: '8px', fontSize: '16px', fontWeight: 'bold' }}>
                        Contador Genérico
                        {isReadOnly && <span style={{ fontSize: '10px', opacity: 0.5, marginLeft: '8px' }}>(Finalizada)</span>}
                    </h2>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
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
            </div>

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

            {/* Teams Grid */}
            <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: activeMatch.teams.length > 1 ? '1fr 1fr' : '1fr', marginBottom: '32px' }}>
                {activeMatch.teams.map((team) => {
                    const isWinning = hasTarget && team.score >= targetScore * 0.9;
                    const progress = hasTarget ? Math.min((team.score / targetScore) * 100, 100) : 0;

                    return (
                        <div
                            key={team.id}
                            className="glass-panel"
                            style={{
                                position: 'relative', overflow: 'hidden', textAlign: 'center', padding: '16px',
                                borderColor: isWinning ? '#ef4444' : 'rgba(255,255,255,0.1)',
                                background: isWinning ? 'rgba(127,29,29,0.5)' : 'rgba(255,255,255,0.05)',
                                display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                                minHeight: '200px'
                            }}
                        >
                            {hasTarget && (
                                <div style={{
                                    position: 'absolute', bottom: 0, left: 0, height: '4px',
                                    background: 'linear-gradient(90deg, #3b82f6, #a855f7)',
                                    width: `${progress}%`, transition: 'width 1s ease'
                                }} />
                            )}

                            <h3 className="text-lg font-bold" style={{ marginBottom: '8px' }}>{team.name}</h3>

                            <div style={{
                                fontSize: '48px', fontWeight: 'bold', fontFamily: 'monospace', lineHeight: 1,
                                color: animateScore === team.id ? '#60a5fa' : 'white',
                                transform: animateScore === team.id ? 'scale(1.2)' : 'scale(1)',
                                transition: 'all 0.2s',
                                margin: '20px 0'
                            }}>
                                {team.score}
                            </div>

                            {hasTarget && (
                                <div className="text-xs" style={{ opacity: 0.5, marginBottom: '16px' }}>
                                    OBJETIVO: {targetScore}
                                </div>
                            )}

                            {!isReadOnly && (
                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                    <button
                                        onClick={() => updateScore(team.id, -1)}
                                        className="btn"
                                        style={{
                                            width: '48px', height: '48px', borderRadius: '50%',
                                            background: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                                        }}
                                    >
                                        <Minus size={24} />
                                    </button>
                                    <button
                                        onClick={() => updateScore(team.id, 1)}
                                        className="btn"
                                        style={{
                                            width: '48px', height: '48px', borderRadius: '50%',
                                            background: 'rgba(16, 185, 129, 0.2)', color: '#6ee7b7',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                                        }}
                                    >
                                        <Plus size={24} />
                                    </button>
                                </div>
                            )}

                            {!isReadOnly && (
                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '8px' }}>
                                    <button
                                        onClick={() => updateScore(team.id, -10)}
                                        className="btn"
                                        style={{
                                            padding: '4px 12px', borderRadius: '12px', fontSize: '12px',
                                            background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)'
                                        }}
                                    >
                                        -10
                                    </button>
                                    <button
                                        onClick={() => updateScore(team.id, 10)}
                                        className="btn"
                                        style={{
                                            padding: '4px 12px', borderRadius: '12px', fontSize: '12px',
                                            background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)'
                                        }}
                                    >
                                        +10
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Inline Dice Section */}
            {!isReadOnly && (
                <div className="glass-panel" style={{ padding: '24px', textAlign: 'center' }}>
                    <h3 style={{
                        fontSize: '16px', marginBottom: '16px', opacity: 0.7,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                    }}>
                        <Dices size={18} /> DADOS
                    </h3>

                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '24px' }}>
                        <button
                            onClick={() => rollDice(1)}
                            disabled={isRolling}
                            className="btn"
                            style={{
                                background: 'rgba(59, 130, 246, 0.1)',
                                border: '1px solid rgba(59, 130, 246, 0.3)',
                                padding: '12px 24px',
                                color: '#93c5fd',
                                fontSize: '14px',
                                borderRadius: '50px'
                            }}
                        >
                            1 Dado
                        </button>
                        <button
                            onClick={() => rollDice(2)}
                            disabled={isRolling}
                            className="btn"
                            style={{
                                background: 'rgba(168, 85, 247, 0.1)',
                                border: '1px solid rgba(168, 85, 247, 0.3)',
                                padding: '12px 24px',
                                color: '#d8b4fe',
                                fontSize: '14px',
                                borderRadius: '50px'
                            }}
                        >
                            2 Dados
                        </button>
                    </div>

                    {/* Result Display */}
                    {diceResult && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '20px',
                            animation: 'fadeIn 0.3s ease-out'
                        }}>
                            {diceResult.map((val, idx) => (
                                <div key={idx} style={{
                                    width: '60px', height: '60px',
                                    background: 'linear-gradient(135deg, #ffffff 0%, #e2e8f0 100%)',
                                    color: '#1e293b',
                                    borderRadius: '16px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '32px', fontWeight: 'bold',
                                    boxShadow: '0 10px 20px rgba(0,0,0,0.2), inset 0 -4px 0 rgba(0,0,0,0.1)',
                                    transform: isRolling ? `rotate(${Math.random() * 20 - 10}deg)` : 'none',
                                    transition: 'transform 0.1s'
                                }}>
                                    {val}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
