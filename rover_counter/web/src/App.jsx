import { useState } from 'react';
import { GameProvider, useGame } from './context/GameContext';
import Home from './components/Home';
import TeamManager from './components/TeamManager';
import MatchSetup from './components/MatchSetup';
import GenericCounter from './components/games/GenericCounter';
import TuteSubastado from './components/games/TuteSubastado';
import { Users, Home as HomeIcon } from 'lucide-react';

function GameRouter() {
    const { activeMatches, finishedMatches } = useGame();
    const [view, setView] = useState('home'); // home, teams, setup, game
    const [homeView, setHomeView] = useState('menu'); // Track which home subview to show
    const [selectedGameId, setSelectedGameId] = useState(null);
    const [viewingMatchId, setViewingMatchId] = useState(null);
    const [viewMode, setViewMode] = useState('active'); // 'active' or 'finished'
    const [previousView, setPreviousView] = useState('home'); // Track where we came from

    // Helper to get current match (from active or finished)
    const currentMatch = viewingMatchId
        ? (viewMode === 'active'
            ? activeMatches.find(m => m.id === viewingMatchId)
            : finishedMatches.find(m => m.id === viewingMatchId))
        : null;

    // Navigate back to previous view
    const handleBack = () => {
        setView(previousView);
    };

    // If we are viewing a game and it exists
    if (view === 'game' && currentMatch) {
        const isReadOnly = viewMode === 'finished';
        switch (currentMatch.gameId) {
            case 'tute': return <TuteSubastado matchId={viewingMatchId} onBack={handleBack} isReadOnly={isReadOnly} />;
            case 'generic': return <GenericCounter matchId={viewingMatchId} onBack={handleBack} isReadOnly={isReadOnly} />;
            default: return <div className="container">Tipo de Juego Desconocido</div>;
        }
    }

    // View Routing
    if (view === 'teams') {
        return <TeamManager onBack={() => setView('home')} />;
    }

    if (view === 'setup') {
        return (
            <MatchSetup
                gameId={selectedGameId}
                onBack={handleBack}
                onStart={(newMatchId) => {
                    setViewingMatchId(newMatchId);
                    setViewMode('active');
                    setPreviousView('home');
                    setHomeView('menu'); // After starting, go to main menu
                    setView('game');
                }}
            />
        );
    }

    // Default: Home
    return (
        <div>
            <Home
                initialView={homeView}
                onSelectGame={(id) => {
                    setSelectedGameId(id);
                    setHomeView('new'); // Remember we're in new game list
                    setPreviousView('home');
                    setView('setup');
                }}
                onResumeGame={(matchId) => {
                    setViewingMatchId(matchId);
                    setViewMode('active');
                    setHomeView('active'); // Remember we're in active games list
                    setPreviousView('home');
                    setView('game');
                }}
                onViewFinishedMatch={(matchId) => {
                    setViewingMatchId(matchId);
                    setViewMode('finished');
                    setHomeView('finished'); // Remember we're in finished games list
                    setPreviousView('home');
                    setView('game');
                }}
            />

            {/* Bottom Nav */}
            <div className="bottom-nav">
                <button
                    onClick={() => {
                        setView('home');
                        setHomeView('menu'); // Reset to menu when clicking home icon
                    }}
                    className={`nav-item ${view === 'home' ? 'active' : ''}`}
                >
                    <HomeIcon size={24} />
                </button>
                <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.1)' }} />
                <button
                    onClick={() => setView('teams')}
                    className={`nav-item ${view === 'teams' ? 'active' : ''}`}
                >
                    <Users size={24} />
                </button>
            </div>
        </div>
    );
}

function App() {
    return (
        <GameProvider>
            <div style={{ minHeight: '100vh' }}>
                <GameRouter />
            </div>
        </GameProvider>
    );
}

export default App;
