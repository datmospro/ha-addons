import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';
import Create from './pages/Create';

export default function App() {
    return (
        <BrowserRouter>
            <div className="min-h-screen flex flex-col">
                <nav className="bg-white shadow flex items-center px-8 h-16">
                    <span className="font-bold text-xl text-gray-800 mr-8">🍲 RecipeBox</span>
                    <Link to="/" className="mx-2 text-gray-700 hover:text-blue-600 font-medium">Inicio</Link>
                    <Link to="/explore" className="mx-2 text-gray-700 hover:text-blue-600 font-medium">Explorar</Link>
                    <Link to="/create" className="mx-2 text-gray-700 hover:text-blue-600 font-medium">Crear</Link>
                </nav>
                <main className="flex-1 container mx-auto px-4 py-8">
                    <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/create" element={<Create />} />
                        {/* Puedes agregar más rutas aquí */}
                    </Routes>
                </main>
            </div>
        </BrowserRouter>
    );
} 