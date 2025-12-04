import React, { useState, useEffect } from 'react';
import GameList from './GameList';
import ActiveGamesList from './ActiveGamesList';
import FinishedGamesList from './FinishedGamesList';
import { PlayCircle, List, History, ChevronLeft, Gamepad2 } from 'lucide-react';

export default function Home({ onSelectGame, onResumeGame, onViewFinishedMatch, initialView = 'menu' }) {
    const [view, setView] = useState(initialView); // menu, new, active, finished

    // Update view when initialView changes
    useEffect(() => {
        setView(initialView);
    }, [initialView]);

    const MenuButton = ({ onClick, icon: Icon, title, description, color }) => (
        <button
            onClick={onClick}
            className="card animate-in"
            style={{
                display: 'flex', alignItems: 'center', gap: '20px', padding: '24px',
                width: '100%', textAlign: 'left', marginBottom: '16px',
                borderLeft: `4px solid ${color}`
            }}
        >
            <div style={{
                background: `${color}20`, padding: '16px', borderRadius: '16px',
                color: color, display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
                <Icon size={32} />
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <h3 className="text-xl font-bold">{title}</h3>
                <p className="text-sm opacity-60">{description}</p>
            </div>
        </button>
    );

    if (view === 'menu') {
        return (
            <div className="container animate-in" style={{ paddingBottom: '100px' }}>
                <div className="header" style={{ display: 'block', textAlign: 'center', marginBottom: '48px' }}>
                    <h1 className="header-title" style={{ fontSize: '40px', marginBottom: '8px' }}>Rover Counter</h1>
                    <p className="text-sm tracking-widest opacity-60">SELECCIONA TU OPCIÓN</p>
                </div>

                <div style={{ maxWidth: '500px', margin: '0 auto' }}>
                    <MenuButton
                        onClick={() => setView('new')}
                        icon={Gamepad2}
                        title="Nueva Partida"
                        description="Comienza un nuevo desafío"
                        color="#3b82f6"
                    />
                    <MenuButton
                        onClick={() => setView('active')}
                        icon={PlayCircle}
                        title="Partidas en Curso"
                        description="Continúa tus batallas"
                        color="#10b981"
                    />
                    <MenuButton
                        onClick={() => setView('finished')}
                        icon={History}
                        title="Partidas Terminadas"
                        description="Revisa victorias pasadas"
                        color="#8b5cf6"
                    />
                </div>
            </div>
        );
    }

    const BackHeader = ({ title }) => (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
            <button
                onClick={() => setView('menu')}
                className="btn-icon"
                style={{ marginRight: '16px', background: 'rgba(255,255,255,0.1)' }}
            >
                <ChevronLeft size={24} />
            </button>
            <h2 className="text-xl font-bold">{title}</h2>
        </div>
    );

    return (
        <div className="container animate-in" style={{ paddingBottom: '100px' }}>
            {view === 'new' && (
                <>
                    <BackHeader title="Nueva Partida" />
                    <GameList onSelectGame={onSelectGame} />
                </>
            )}

            {view === 'active' && (
                <>
                    <BackHeader title="Partidas en Curso" />
                    <ActiveGamesList onResume={onResumeGame} />
                </>
            )}

            {view === 'finished' && (
                <>
                    <BackHeader title="Partidas Terminadas" />
                    <FinishedGamesList onViewMatch={onViewFinishedMatch} />
                </>
            )}
        </div>
    );
}
