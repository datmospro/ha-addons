import React, { useState } from 'react';

export default function Create() {
    const [categorias, setCategorias] = React.useState<{ id: number, nombre: string }[]>([]);
    const [msg, setMsg] = useState<string | null>(null);

    React.useEffect(() => {
        fetch('/api/categorias').then(r => r.json()).then(setCategorias);
    }, []);

    function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        fetch('/api/recetas', { method: 'POST', body: data })
            .then(r => r.json())
            .then(res => {
                if (res.success) {
                    setMsg('¡Receta creada con éxito!');
                    setTimeout(() => window.location.href = '/', 1500);
                } else {
                    setMsg('Error: ' + res.error);
                }
            })
            .catch(err => setMsg('Error: ' + err));
    }

    function addIngredient() {
        setIngredients([...ingredients, { nombre: '', unidad: '', cantidad: '' }]);
    }
    function removeIngredient(idx: number) {
        setIngredients(ingredients.filter((_, i) => i !== idx));
    }
    function addStep() {
        setSteps([...steps, { descripcion: '', foto: null }]);
    }
    function removeStep(idx: number) {
        setSteps(steps.filter((_, i) => i !== idx));
    }

    const [ingredients, setIngredients] = useState([{ nombre: '', unidad: '', cantidad: '' }]);
    const [steps, setSteps] = useState([{ descripcion: '', foto: null as File | null }]);

    return (
        <div>
            <h2 className="text-2xl font-bold mb-4">Crear nueva receta</h2>
            {msg && <div className="mb-4 p-2 rounded bg-green-100 text-green-800">{msg}</div>}
            <form onSubmit={handleSubmit} encType="multipart/form-data" className="space-y-4">
                <div>
                    <label className="block font-medium">Nombre</label>
                    <input name="nombre" required className="input input-bordered w-full" />
                </div>
                <div>
                    <label className="block font-medium">Descripción</label>
                    <textarea name="descripcion" className="input input-bordered w-full" />
                </div>
                <div>
                    <label className="block font-medium">Categoría</label>
                    <select name="categoria_id" className="input input-bordered w-full">
                        <option value="">Selecciona una categoría</option>
                        {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block font-medium">Foto principal</label>
                    <input type="file" name="foto_principal" accept="image/*" className="input input-bordered w-full" />
                </div>
                <div>
                    <h3 className="font-semibold">Ingredientes</h3>
                    {ingredients.map((ing, idx) => (
                        <div key={idx} className="flex gap-2 mb-2">
                            <input name="ingredientes" placeholder="Ingrediente" className="input input-bordered flex-1" required />
                            <input name="unidades" placeholder="Unidad" className="input input-bordered w-24" />
                            <input name="cantidades" placeholder="Cantidad" type="number" step="any" className="input input-bordered w-24" />
                            <button type="button" onClick={() => removeIngredient(idx)} className="btn btn-error">Eliminar</button>
                        </div>
                    ))}
                    <button type="button" onClick={addIngredient} className="btn btn-primary">Añadir ingrediente</button>
                </div>
                <div>
                    <h3 className="font-semibold">Pasos</h3>
                    {steps.map((step, idx) => (
                        <div key={idx} className="flex gap-2 mb-2 items-center">
                            <textarea name="pasos" placeholder="Descripción del paso" className="input input-bordered flex-1" required />
                            <input type="file" name="fotos_pasos" accept="image/*" className="input input-bordered w-48" />
                            <button type="button" onClick={() => removeStep(idx)} className="btn btn-error">Eliminar</button>
                        </div>
                    ))}
                    <button type="button" onClick={addStep} className="btn btn-primary">Añadir paso</button>
                </div>
                <button type="submit" className="btn btn-success">Guardar receta</button>
            </form>
        </div>
    );
} 