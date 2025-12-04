import React, { useState } from 'react';
import { useGame } from '../context/GameContext';
import { Play, CheckCircle2, Circle, ArrowLeft, Settings, User } from 'lucide-react';

export default function MatchSetup({ gameId, onBack, onStart }) {
    const { teams, startMatch } = useGame();
    const [selectedTeams, setSelectedTeams] = useState([]);
    const [targetScore, setTargetScore] = useState(gameId === 'generic' ? '' : 1001);
    const [startingDealerIndex, setStartingDealerIndex] = useState(null);
    const [playerSlots, setPlayerSlots] = useState([null, null, null, null]);
    const [draggedSlotIndex, setDraggedSlotIndex] = useState(null);

    const gameTitles = {
        tute: 'Tute Subastado',
        generic: 'Contador Genérico'
    };

    const toggleTeam = (id) => {
        if (selectedTeams.includes(id)) {
            setSelectedTeams(selectedTeams.filter(t => t !== id));
            setStartingDealerIndex(null);
            setPlayerSlots([null, null, null, null]);
        } else {
            let newSelectedTeams;
            if (gameId === 'tute' && selectedTeams.length >= 2) {
                newSelectedTeams = [selectedTeams[1], id];
            } else {
                newSelectedTeams = [...selectedTeams, id];
            }
            setSelectedTeams(newSelectedTeams);
            setStartingDealerIndex(null);

            // Initialize player slots when teams are selected
            if (gameId === 'tute' && newSelectedTeams.length === 2) {
                const allPlayers = [];
                const selectedTeamObjects = teams.filter(t => newSelectedTeams.includes(t.id));
                selectedTeamObjects.forEach((team) => {
                    if (team.players && team.players.length > 0) {
                        team.players.forEach((playerName) => {
                            allPlayers.push({
                                name: playerName,
                                teamName: team.name,
                                teamId: team.id,
                                id: `${team.id}-${playerName}`
                            });
                        });
                    }
                });
                // Fill slots with players (up to 4)
                const newSlots = [null, null, null, null];
                allPlayers.forEach((player, idx) => {
                    if (idx < 4) newSlots[idx] = player;
                });
                setPlayerSlots(newSlots);
            } else {
                setPlayerSlots([null, null, null, null]);
            }
        }
    };

    const handleStart = async () => {
        const settings = {};
        if (gameId === 'tute') {
            settings.targetScore = targetScore || 1001; // Default for Tute
            if (startingDealerIndex !== null) {
                settings.startingDealerIndex = startingDealerIndex;
            }
            // Save the exact player order to ensure dealer index consistency
            if (playerSlots.some(slot => slot !== null)) {
                settings.playerOrder = playerSlots.filter(slot => slot !== null).map(player => ({
                    name: player.name,
                    teamId: player.teamId
                }));
            }
        } else if (gameId === 'generic') {
            settings.targetScore = targetScore === '' || targetScore === 0 ? null : targetScore;
        }
        try {
            const newMatchId = await startMatch(gameId, selectedTeams, settings);
            onStart(newMatchId);
        } catch (error) {
            console.error('Failed to start match:', error);
        }
    };

    const isValid = () => {
        if (gameId === 'tute') {
            const hasPlayers = playerSlots.some(slot => slot !== null);
            return selectedTeams.length === 2 && (!hasPlayers || startingDealerIndex !== null);
        }
        return selectedTeams.length > 0;
    };

    const handleDragStart = (e, slotIndex) => {
        if (playerSlots[slotIndex] === null) return;
        setDraggedSlotIndex(slotIndex);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e) => {
        e.preventDefault();
    };

    const handleDrop = (e, targetSlotIndex) => {
        e.preventDefault();
        if (draggedSlotIndex === null || draggedSlotIndex === targetSlotIndex) {
            setDraggedSlotIndex(null);
            return;
        }

        // Swap players between slots
        const newSlots = [...playerSlots];
        const temp = newSlots[targetSlotIndex];
        newSlots[targetSlotIndex] = newSlots[draggedSlotIndex];
        newSlots[draggedSlotIndex] = temp;

        setPlayerSlots(newSlots);
        setDraggedSlotIndex(null);
    };

    const handleDragEnd = () => {
        setDraggedSlotIndex(null);
    };

    const showDealerSelection = gameId === 'tute' && selectedTeams.length === 2 && playerSlots.some(slot => slot !== null);

    // Render player slot function
    const renderSlot = (slotIndex, position) => {
        const player = playerSlots[slotIndex];
        const positionStyles = {
            0: { top: '0', left: '50%', transform: 'translateX(-50%)' }, // Top
            1: { top: '50%', right: '0', transform: 'translateY(-50%)' }, // Right
            2: { bottom: '0', left: '50%', transform: 'translateX(-50%)' }, // Bottom
            3: { top: '50%', left: '0', transform: 'translateY(-50%)' } // Left
        };

        return (
            <div
                draggable={player !== null}
                onDragStart={(e) => handleDragStart(e, slotIndex)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, slotIndex)}
                onDragEnd={handleDragEnd}
                onClick={() => player && setStartingDealerIndex(slotIndex)}
                style={{
                    position: 'absolute',
                    ...positionStyles[slotIndex],
                    width: '110px',
                    height: '70px',
                    padding: '8px',
                    borderRadius: '12px',
                    background: player
                        ? (startingDealerIndex === slotIndex
                            ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.5), rgba(139, 92, 246, 0.5))'
                            : 'rgba(255,255,255,0.1)')
                        : 'rgba(255,255,255,0.05)',
                    border: player
                        ? (startingDealerIndex === slotIndex
                            ? '2px solid rgba(59, 130, 246, 0.8)'
                            : '1px solid rgba(255,255,255,0.2)')
                        : '2px dashed rgba(255,255,255,0.15)',
                    cursor: player ? 'grab' : 'default',
                    opacity: draggedSlotIndex === slotIndex ? 0.5 : 1,
                    transition: 'all 0.2s',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: startingDealerIndex === slotIndex ? '0 0 15px rgba(59, 130, 246, 0.5)' : 'none'
                }}
            >
                {player ? (
                    <>
                        <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'center' }}>
                            {player.name}
                        </div>
                        <div style={{ fontSize: '9px', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'center' }}>
                            {player.teamName}
                        </div>
                        {startingDealerIndex === slotIndex && (
                            <div style={{ fontSize: '16px', marginTop: '2px' }}>🃏</div>
                        )}
                    </>
                ) : (
                    <div style={{ fontSize: '9px', opacity: 0.3 }}>Vacío</div>
                )}
            </div>
        );
    };

    return (
        <div className="container animate-in">
            <div className="header">
                <button onClick={onBack} className="back-btn">
                    <ArrowLeft size={20} />
                </button>
                <div style={{ flex: 1, textAlign: 'center', marginRight: '40px' }}>
                    <h2 className="header-title" style={{ fontSize: '18px' }}>Configuración de Partida</h2>
                    <p className="text-sm" style={{ opacity: 0.6, marginTop: '4px' }}>{gameTitles[gameId]}</p>
                </div>
            </div>

            <div style={{ marginBottom: '32px' }}>
                <h3 className="text-xs" style={{ marginBottom: '16px' }}>SELECCIONAR EQUIPOS</h3>
                <div style={{ display: 'grid', gap: '12px' }}>
                    {teams.map((team, idx) => (
                        <button
                            key={team.id}
                            onClick={() => toggleTeam(team.id)}
                            className={`card ${selectedTeams.includes(team.id) ? 'active' : ''}`}
                            style={{ animationDelay: `${idx * 0.05}s` }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{
                                    width: '8px', height: '8px', borderRadius: '50%',
                                    background: selectedTeams.includes(team.id) ? '#00d2ff' : '#666',
                                    boxShadow: selectedTeams.includes(team.id) ? '0 0 10px #00d2ff' : 'none'
                                }} />
                                <div style={{ flex: 1, textAlign: 'left' }}>
                                    <span className="text-lg">{team.name}</span>
                                    {team.players && team.players.length > 0 && (
                                        <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                            {team.players.map((player, pidx) => (
                                                <span
                                                    key={pidx}
                                                    style={{
                                                        fontSize: '10px',
                                                        padding: '2px 6px',
                                                        background: 'rgba(59, 130, 246, 0.2)',
                                                        border: '1px solid rgba(59, 130, 246, 0.3)',
                                                        borderRadius: '8px',
                                                        color: '#93c5fd'
                                                    }}
                                                >
                                                    {player}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            {selectedTeams.includes(team.id) ? (
                                <CheckCircle2 color="#00d2ff" />
                            ) : (
                                <Circle color="#666" />
                            )}
                        </button>
                    ))}
                </div>
                {teams.length === 0 && (
                    <div className="glass-panel" style={{ textAlign: 'center', color: '#fbbf24' }}>
                        No hay equipos disponibles. Por favor crea equipos primero.
                    </div>
                )}
            </div>

            {(gameId === 'tute' || gameId === 'generic') && (
                <div style={{ marginBottom: '32px' }}>
                    <h3 className="text-xs" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Settings size={14} /> CONFIGURACIÓN DEL JUEGO
                    </h3>
                    <div className="glass-panel">
                        <label className="text-sm" style={{ display: 'block', marginBottom: '8px' }}>
                            Puntuación Objetivo {gameId === 'generic' && <span className="opacity-50">(Opcional, 0 = Sin límite)</span>}
                        </label>
                        <input
                            type="number"
                            value={targetScore}
                            onChange={(e) => setTargetScore(e.target.value === '' ? '' : parseInt(e.target.value))}
                            placeholder={gameId === 'generic' ? "Sin límite" : "1001"}
                            style={{ fontSize: '24px', fontFamily: 'monospace' }}
                        />
                    </div>
                </div>
            )}

            {showDealerSelection && (
                <div style={{ marginBottom: '32px' }}>
                    <h3 className="text-xs" style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <User size={14} /> ASIENTOS Y REPARTIDOR
                    </h3>
                    <p style={{ fontSize: '10px', opacity: 0.6, marginBottom: '12px', textAlign: 'center' }}>
                        Arrastra para cambiar asientos • Clic para elegir repartidor • Rotación: horaria ↻
                    </p>

                    {/* Table View */}
                    <div style={{
                        position: 'relative',
                        width: '320px',
                        height: '280px',
                        margin: '0 auto',
                        marginBottom: '16px'
                    }}>
                        {/* Center Table */}
                        <div style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: '80px',
                            height: '80px',
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.3))',
                            border: '3px solid rgba(139, 92, 246, 0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '28px',
                            boxShadow: '0 0 20px rgba(139, 92, 246, 0.3)'
                        }}>
                            🎴
                        </div>

                        {/* Rotation arrows */}
                        <div style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: '140px',
                            height: '140px',
                            borderRadius: '50%',
                            border: '2px dashed rgba(139, 92, 246, 0.3)',
                            pointerEvents: 'none'
                        }}>
                            {/* Arrow indicators */}
                            <div style={{ position: 'absolute', top: '-8px', right: '35%', fontSize: '16px', opacity: 0.5 }}>→</div>
                            <div style={{ position: 'absolute', right: '-8px', top: '35%', fontSize: '16px', opacity: 0.5 }}>↓</div>
                            <div style={{ position: 'absolute', bottom: '-8px', left: '35%', fontSize: '16px', opacity: 0.5 }}>←</div>
                            <div style={{ position: 'absolute', left: '-8px', bottom: '35%', fontSize: '16px', opacity: 0.5 }}>↑</div>
                        </div>

                        {/* Player Slots */}
                        {renderSlot(0)}
                        {renderSlot(1)}
                        {renderSlot(2)}
                        {renderSlot(3)}
                    </div>

                    {startingDealerIndex !== null && (
                        <div className="glass-panel" style={{ padding: '8px', background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)' }}>
                            <p style={{ fontSize: '11px', color: '#fbbf24', textAlign: 'center' }}>
                                🃏 {playerSlots[startingDealerIndex]?.name} reparte primero
                            </p>
                        </div>
                    )}
                </div>
            )}

            <button
                onClick={handleStart}
                disabled={!isValid()}
                className="btn btn-primary"
            >
                <Play fill="currentColor" size={20} />
                Comenzar Partida
            </button>
        </div>
    );
}
