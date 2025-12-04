import React, { useState } from 'react';
import { useGame } from '../context/GameContext';
import { Users, Plus, Trash2, Edit2, Check, X, ArrowLeft, UserPlus, AlertTriangle } from 'lucide-react';

export default function TeamManager({ onBack }) {
    const { teams, addTeam, deleteTeam, updateTeam, refreshData } = useGame();
    const [newTeamName, setNewTeamName] = useState('');
    const [newTeamPlayers, setNewTeamPlayers] = useState(['', '']);
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editPlayers, setEditPlayers] = useState([]);
    const [showResetConfirm, setShowResetConfirm] = useState(false);

    const handleAdd = (e) => {
        e.preventDefault();
        if (newTeamName.trim()) {
            const players = newTeamPlayers.filter(p => p.trim());
            addTeam(newTeamName.trim(), players);
            setNewTeamName('');
            setNewTeamPlayers(['', '']);
        }
    };

    const startEdit = (team) => {
        setEditingId(team.id);
        setEditName(team.name);
        setEditPlayers(team.players && team.players.length > 0 ? [...team.players] : ['', '']);
    };

    const saveEdit = () => {
        if (editName.trim()) {
            const players = editPlayers.filter(p => p.trim());
            updateTeam(editingId, editName.trim(), players);
            setEditingId(null);
        }
    };

    const updateNewPlayer = (index, value) => {
        const updated = [...newTeamPlayers];
        updated[index] = value;
        setNewTeamPlayers(updated);
    };

    const addNewPlayerField = () => {
        setNewTeamPlayers([...newTeamPlayers, '']);
    };

    const removeNewPlayerField = (index) => {
        setNewTeamPlayers(newTeamPlayers.filter((_, i) => i !== index));
    };

    const updateEditPlayer = (index, value) => {
        const updated = [...editPlayers];
        updated[index] = value;
        setEditPlayers(updated);
    };

    const addEditPlayerField = () => {
        setEditPlayers([...editPlayers, '']);
    };

    const removeEditPlayerField = (index) => {
        setEditPlayers(editPlayers.filter((_, i) => i !== index));
    };

    const handleResetDatabase = async () => {
        try {
            const response = await fetch('/api/admin/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                await refreshData();
                setShowResetConfirm(false);
                alert('¡Base de datos reiniciada correctamente!');
            } else {
                alert('Error al reiniciar la base de datos');
            }
        } catch (error) {
            console.error('Reset error:', error);
            alert('Error al reiniciar la base de datos');
        }
    };

    return (
        <div className="container animate-in">
            <div className="header">
                <button onClick={onBack} className="back-btn">
                    <ArrowLeft size={20} />
                </button>
                <h2 className="header-title">Gestión de Equipos</h2>
            </div>

            {/* Reset Database Warning */}
            {teams.length > 0 && (
                <div className="glass-panel" style={{ marginBottom: '16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <AlertTriangle size={16} color="#ef4444" />
                            <span style={{ fontSize: '12px', color: '#fca5a5' }}>¿Problemas eliminando equipos?</span>
                        </div>
                        <button
                            onClick={() => setShowResetConfirm(true)}
                            className="btn"
                            style={{ padding: '6px 12px', fontSize: '11px', background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}
                        >
                            Reiniciar Base de Datos
                        </button>
                    </div>
                </div>
            )}

            {/* Reset Confirmation Modal */}
            {showResetConfirm && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 100,
                    background: 'rgba(0,0,0,0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '20px'
                }}>
                    <div className="glass-panel" style={{ maxWidth: '400px', padding: '24px' }}>
                        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                            <AlertTriangle size={48} color="#ef4444" style={{ marginBottom: '12px' }} />
                            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>¿Reiniciar Base de Datos?</h3>
                            <p style={{ fontSize: '14px', opacity: 0.7 }}>Esto eliminará TODOS los equipos y partidas. Esta acción no se puede deshacer.</p>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={() => setShowResetConfirm(false)}
                                className="btn"
                                style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleResetDatabase}
                                className="btn"
                                style={{ flex: 1, background: '#ef4444', color: 'white' }}
                            >
                                Reiniciar Todo
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <form onSubmit={handleAdd} className="glass-panel" style={{ marginBottom: '16px' }}>
                <h3 className="text-xs" style={{ marginBottom: '12px', opacity: 0.6 }}>CREAR NUEVO EQUIPO</h3>

                <input
                    type="text"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    placeholder="Nombre del Equipo..."
                    style={{ marginBottom: '12px' }}
                />

                <div style={{ marginBottom: '12px' }}>
                    <label className="text-xs" style={{ display: 'block', marginBottom: '8px', opacity: 0.6 }}>JUGADORES</label>
                    {newTeamPlayers.map((player, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                            <input
                                type="text"
                                value={player}
                                onChange={(e) => updateNewPlayer(idx, e.target.value)}
                                placeholder={`Jugador ${idx + 1}...`}
                                style={{ flex: 1, fontSize: '14px', padding: '8px' }}
                            />
                            {newTeamPlayers.length > 1 && (
                                <button
                                    type="button"
                                    onClick={() => removeNewPlayerField(idx)}
                                    className="btn-icon danger"
                                    style={{ padding: '8px' }}
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                    <button
                        type="button"
                        onClick={addNewPlayerField}
                        className="btn"
                        style={{ width: '100%', padding: '6px', fontSize: '12px', background: 'rgba(255,255,255,0.05)' }}
                    >
                        <UserPlus size={14} /> Añadir Jugador
                    </button>
                </div>

                <button
                    type="submit"
                    disabled={!newTeamName.trim()}
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                >
                    <Plus size={20} /> Crear Equipo
                </button>
            </form>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {teams.length === 0 && (
                    <div className="glass-panel" style={{ textAlign: 'center', padding: '40px' }}>
                        <Users size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
                        <p className="text-sm">No hay equipos aún. ¡Crea tu escuadra!</p>
                    </div>
                )}

                {teams.map((team) => (
                    <div key={team.id} className="glass-panel" style={{ cursor: 'default' }}>
                        {editingId === team.id ? (
                            <div style={{ width: '100%' }}>
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                                    <input
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        placeholder="Nombre del Equipo..."
                                        autoFocus
                                        style={{ flex: 1 }}
                                    />
                                    <button onClick={saveEdit} className="btn-icon" style={{ background: 'rgba(0,255,0,0.2)', color: '#4ade80' }}>
                                        <Check size={16} />
                                    </button>
                                    <button onClick={() => setEditingId(null)} className="btn-icon danger">
                                        <X size={16} />
                                    </button>
                                </div>

                                <div>
                                    <label className="text-xs" style={{ display: 'block', marginBottom: '6px', opacity: 0.6 }}>JUGADORES</label>
                                    {editPlayers.map((player, idx) => (
                                        <div key={idx} style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                                            <input
                                                type="text"
                                                value={player}
                                                onChange={(e) => updateEditPlayer(idx, e.target.value)}
                                                placeholder={`Jugador ${idx + 1}...`}
                                                style={{ flex: 1, fontSize: '14px', padding: '8px' }}
                                            />
                                            {editPlayers.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => removeEditPlayerField(idx)}
                                                    className="btn-icon danger"
                                                    style={{ padding: '8px' }}
                                                >
                                                    <X size={14} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={addEditPlayerField}
                                        className="btn"
                                        style={{ width: '100%', padding: '6px', fontSize: '12px', background: 'rgba(255,255,255,0.05)', marginTop: '4px' }}
                                    >
                                        <UserPlus size={14} /> Añadir Jugador
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                            <div style={{
                                                width: '32px', height: '32px', borderRadius: '50%',
                                                background: 'rgba(255,255,255,0.1)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '12px', fontWeight: 'bold'
                                            }}>
                                                {team.name.substring(0, 2).toUpperCase()}
                                            </div>
                                            <span className="text-lg">{team.name}</span>
                                        </div>

                                        {team.players && team.players.length > 0 && (
                                            <div style={{ marginLeft: '44px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                {team.players.map((player, idx) => (
                                                    <span
                                                        key={idx}
                                                        style={{
                                                            fontSize: '11px',
                                                            padding: '2px 8px',
                                                            background: 'rgba(59, 130, 246, 0.2)',
                                                            border: '1px solid rgba(59, 130, 246, 0.3)',
                                                            borderRadius: '12px',
                                                            color: '#93c5fd'
                                                        }}
                                                    >
                                                        {player}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ display: 'flex', gap: '4px' }}>
                                        <button onClick={() => startEdit(team)} className="btn-icon">
                                            <Edit2 size={16} />
                                        </button>
                                        <button onClick={() => deleteTeam(team.id)} className="btn-icon danger">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
