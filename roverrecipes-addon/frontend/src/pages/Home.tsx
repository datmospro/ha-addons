import React, { useEffect, useState } from 'react';

interface Receta {
    id: number;
    nombre: string;
    descripcion: string;
    categoria: string;
    foto_principal: string;
}

export default function Home() {
    const [recetas, setRecetas] = useState<Receta[]>([]);
    const [categorias, setCategorias] = useState<{ id: number, nombre: string }[]>([]);

    useEffect(() => {
        fetch('/api/recetas').then(r => r.json()).then(setRecetas);
        fetch('/api/categorias').then(r => r.json()).then(setCategorias);
    }, []);

    return (
        <div>
            <h2 className="text-2xl font-bold mb-4">Recetas destacadas</h2>
            <div className="flex flex-wrap gap-6 mb-8">
                {recetas.slice(0, 3).map(r => (
                    <div key={r.id} className="bg-white rounded-xl shadow w-64 hover:scale-105 transition cursor-pointer">
                        <img src={r.foto_principal || 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=400&q=80'} alt={r.nombre} className="w-full h-40 object-cover rounded-t-xl" />
                        <div className="p-4">
                            <div className="font-bold text-lg mb-1">{r.nombre}</div>
                            <div className="text-gray-500 text-sm">{r.descripcion}</div>
                        </div>
                    </div>
                ))}
            </div>
            <h2 className="text-2xl font-bold mb-4">Categorías</h2>
            <div className="flex flex-wrap gap-6">
                {categorias.map(c => (
                    <div key={c.id} className="bg-white rounded-xl shadow w-48 h-32 flex items-center justify-center text-lg font-medium cursor-pointer hover:bg-gray-100">
                        {c.nombre}
                    </div>
                ))}
            </div>
        </div>
    );
} 