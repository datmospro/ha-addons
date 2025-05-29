from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, Text, ForeignKey, DateTime, Float
from sqlalchemy.orm import sessionmaker, declarative_base, relationship
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional
import datetime
import os
from fastapi.responses import HTMLResponse
from starlette.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

DB_NAME = os.getenv("DB_NAME", "roverrecipes")
DB_PATH = f"/data/{DB_NAME}.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

app = FastAPI(title="Rover Recipes")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Montar la carpeta de archivos estáticos (frontend compilado)
# FastAPI servirá desde la carpeta 'static' que está al mismo nivel que main.py dentro del contenedor
app.mount("/", StaticFiles(directory="static", html=True), name="static")

# MODELOS DE BASE DE DATOS
class Categoria(Base):
    __tablename__ = "categorias"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), unique=True, nullable=False)
    recetas = relationship("Receta", back_populates="categoria")

class Receta(Base):
    __tablename__ = "recetas"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(200), nullable=False)
    descripcion = Column(Text)
    categoria_id = Column(Integer, ForeignKey("categorias.id"))
    foto_principal = Column(String(255))
    fecha_creacion = Column(DateTime, default=datetime.datetime.utcnow)
    categoria = relationship("Categoria", back_populates="recetas")
    ingredientes = relationship("RecetaIngrediente", back_populates="receta")
    pasos = relationship("Paso", back_populates="receta")

class Ingrediente(Base):
    __tablename__ = "ingredientes"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), unique=True, nullable=False)
    unidad = Column(String(50))
    recetas = relationship("RecetaIngrediente", back_populates="ingrediente")

class RecetaIngrediente(Base):
    __tablename__ = "receta_ingredientes"
    id = Column(Integer, primary_key=True, index=True)
    receta_id = Column(Integer, ForeignKey("recetas.id"))
    ingrediente_id = Column(Integer, ForeignKey("ingredientes.id"))
    cantidad = Column(Float)
    receta = relationship("Receta", back_populates="ingredientes")
    ingrediente = relationship("Ingrediente", back_populates="recetas")

class Paso(Base):
    __tablename__ = "pasos"
    id = Column(Integer, primary_key=True, index=True)
    receta_id = Column(Integer, ForeignKey("recetas.id"))
    paso_numero = Column(Integer)
    descripcion = Column(Text)
    foto = Column(String(255))
    receta = relationship("Receta", back_populates="pasos")

# CREAR TABLAS SI NO EXISTEN
Base.metadata.create_all(bind=engine)

# ENDPOINTS BÁSICOS
@app.get("/", response_class=HTMLResponse)
def root():
    return '''
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Rover Recipes Addon</title>
        <style>
            body { background: #f9f6f7; font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; }
            .navbar { background: #fff; box-shadow: 0 2px 8px #eee; display: flex; align-items: center; padding: 0 2em; height: 60px; }
            .navbar .logo { font-weight: bold; font-size: 1.3em; color: #222; margin-right: 2em; }
            .navbar nav { flex: 1; }
            .navbar nav a { margin: 0 1em; color: #444; text-decoration: none; font-weight: 500; }
            .navbar .search { background: #f3eaea; border-radius: 1.5em; padding: 0.5em 1em; border: none; width: 250px; margin-right: 2em; }
            .container { max-width: 1100px; margin: 2em auto; padding: 0 1em; }
            h2 { margin-top: 2em; color: #222; }
            .featured, .categories { display: flex; gap: 1.5em; flex-wrap: wrap; }
            .featured-recipe, .category-card { background: #fff; border-radius: 1em; box-shadow: 0 2px 8px #eee; overflow: hidden; width: 220px; transition: transform 0.2s; cursor: pointer; text-decoration: none; color: inherit; }
            .featured-recipe:hover, .category-card:hover { transform: translateY(-5px) scale(1.03); box-shadow: 0 4px 16px #ddd; }
            .featured-recipe img, .category-card img { width: 100%; height: 140px; object-fit: cover; }
            .featured-recipe .info, .category-card .info { padding: 1em; }
            .featured-recipe .title { font-size: 1.1em; font-weight: bold; margin-bottom: 0.3em; }
            .featured-recipe .desc { color: #888; font-size: 0.95em; }
            .category-card .title { font-size: 1em; font-weight: 500; margin-top: 0.5em; }
            @media (max-width: 900px) { .featured, .categories { flex-direction: column; align-items: center; } }
        </style>
    </head>
    <body>
        <div class="navbar">
            <span class="logo">🍲 RecipeBox</span>
            <nav>
                <a href="/">Home</a>
                <a href="#">Explore</a>
                <a href="#">Create</a>
            </nav>
            <input class="search" type="text" placeholder="Search for recipes" />
            <span style="margin-left:auto;"></span>
        </div>
        <div class="container">
            <h2>Featured Recipes</h2>
            <div class="featured">
                <a class="featured-recipe" href="/recetas/1">
                    <img src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=400&q=80" alt="Classic Tomato Pasta" />
                    <div class="info">
                        <div class="title">Classic Tomato Pasta</div>
                        <div class="desc">A simple and delicious pasta dish</div>
                    </div>
                </a>
                <a class="featured-recipe" href="/recetas/2">
                    <img src="https://images.unsplash.com/photo-1519864600265-abb23847ef2c?auto=format&fit=crop&w=400&q=80" alt="Grilled Salmon with Roasted Vegetables" />
                    <div class="info">
                        <div class="title">Grilled Salmon with Roasted Vegetables</div>
                        <div class="desc">Healthy and flavorful grilled salmon</div>
                    </div>
                </a>
                <a class="featured-recipe" href="/recetas/3">
                    <img src="https://images.unsplash.com/photo-1505250469679-203ad9ced0cb?auto=format&fit=crop&w=400&q=80" alt="Decadent Chocolate Cake" />
                    <div class="info">
                        <div class="title">Decadent Chocolate Cake</div>
                        <div class="desc">Rich and moist chocolate cake</div>
                    </div>
                </a>
            </div>
            <h2>Categories</h2>
            <div class="categories">
                <a class="category-card" href="/categorias/italian">
                    <img src="https://images.unsplash.com/photo-1502741338009-cac2772e18bc?auto=format&fit=crop&w=400&q=80" alt="Italian" />
                    <div class="info"><div class="title">Italian</div></div>
                </a>
                <a class="category-card" href="/categorias/seafood">
                    <img src="https://images.unsplash.com/photo-1464306076886-debca5e8a6b0?auto=format&fit=crop&w=400&q=80" alt="Seafood" />
                    <div class="info"><div class="title">Seafood</div></div>
                </a>
                <a class="category-card" href="/categorias/desserts">
                    <img src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=400&q=80" alt="Desserts" />
                    <div class="info"><div class="title">Desserts</div></div>
                </a>
                <a class="category-card" href="/categorias/vegetarian">
                    <img src="https://images.unsplash.com/photo-1464306076886-debca5e8a6b0?auto=format&fit=crop&w=400&q=80" alt="Vegetarian" />
                    <div class="info"><div class="title">Vegetarian</div></div>
                </a>
                <a class="category-card" href="/categorias/quick-easy">
                    <img src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=400&q=80" alt="Quick & Easy" />
                    <div class="info"><div class="title">Quick & Easy</div></div>
                </a>
                <a class="category-card" href="/categorias/healthy">
                    <img src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=400&q=80" alt="Healthy" />
                    <div class="info"><div class="title">Healthy</div></div>
                </a>
            </div>
        </div>
    </body>
    </html>
    '''

@app.get("/api/categorias")
def listar_categorias():
    db = SessionLocal()
    categorias = db.query(Categoria).all()
    resultado = [{"id": c.id, "nombre": c.nombre} for c in categorias]
    db.close()
    return resultado

@app.get("/api/recetas")
def listar_recetas():
    db = SessionLocal()
    recetas = db.query(Receta).all()
    resultado = []
    for r in recetas:
        resultado.append({
            "id": r.id,
            "nombre": r.nombre,
            "descripcion": r.descripcion,
            "categoria": r.categoria.nombre if r.categoria else None,
            "foto_principal": r.foto_principal,
            "fecha_creacion": r.fecha_creacion,
        })
    db.close()
    return resultado

@app.post("/api/recetas")
async def crear_receta(
    request: Request,
    nombre: str = Form(...),
    descripcion: str = Form(""),
    categoria_id: str = Form(None),
    foto_principal: UploadFile = File(None),
    ingredientes: list[str] = Form([]),
    unidades: list[str] = Form([]),
    cantidades: list[str] = Form([]),
    pasos: list[str] = Form([]),
    fotos_pasos: list[UploadFile] = File([])
):
    db = SessionLocal()
    try:
        # Guardar foto principal
        filename = None
        if foto_principal:
            filename = f"fotos/{datetime.datetime.utcnow().timestamp()}_{foto_principal.filename}"
            os.makedirs(os.path.dirname(f"/app/app/{filename}"), exist_ok=True)
            with open(f"/app/app/{filename}", "wb") as f:
                f.write(await foto_principal.read())
        # Convertir categoria_id
        cat_id = int(categoria_id) if categoria_id and categoria_id.isdigit() else None
        # Crear receta
        receta = Receta(
            nombre=nombre,
            descripcion=descripcion,
            categoria_id=cat_id,
            foto_principal=filename
        )
        db.add(receta)
        db.commit()
        db.refresh(receta)
        # Guardar ingredientes
        for i, ing in enumerate(ingredientes):
            if not ing.strip():
                continue
            unidad = unidades[i] if i < len(unidades) else ""
            cantidad = cantidades[i] if i < len(cantidades) else "0"
            # Buscar o crear ingrediente
            ingrediente = db.query(Ingrediente).filter_by(nombre=ing.strip()).first()
            if not ingrediente:
                ingrediente = Ingrediente(nombre=ing.strip(), unidad=unidad)
                db.add(ingrediente)
                db.commit()
                db.refresh(ingrediente)
            # Relación RecetaIngrediente
            receta_ingrediente = RecetaIngrediente(
                receta_id=receta.id,
                ingrediente_id=ingrediente.id,
                cantidad=float(cantidad or 0)
            )
            db.add(receta_ingrediente)
        # Guardar pasos
        for i, paso_desc in enumerate(pasos):
            if not paso_desc.strip():
                continue
            foto_paso = None
            if fotos_pasos and i < len(fotos_pasos):
                file = fotos_pasos[i]
                if file and file.filename:
                    foto_paso = f"fotos/pasos/{datetime.datetime.utcnow().timestamp()}_{file.filename}"
                    os.makedirs(os.path.dirname(f"/app/app/{foto_paso}"), exist_ok=True)
                    with open(f"/app/app/{foto_paso}", "wb") as f:
                        f.write(await file.read())
            paso = Paso(
                receta_id=receta.id,
                paso_numero=i+1,
                descripcion=paso_desc.strip(),
                foto=foto_paso
            )
            db.add(paso)
        db.commit()
        return JSONResponse({"success": True, "id": receta.id})
    except Exception as e:
        db.rollback()
        return JSONResponse({"success": False, "error": str(e)})
    finally:
        db.close()

@app.get("/create", response_class=HTMLResponse)
def create_page():
    return '''
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Crear Receta</title>
        <style>
            body { background: #f9f6f7; font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; }
            .navbar { background: #fff; box-shadow: 0 2px 8px #eee; display: flex; align-items: center; padding: 0 2em; height: 60px; }
            .navbar .logo { font-weight: bold; font-size: 1.3em; color: #222; margin-right: 2em; }
            .navbar nav { flex: 1; }
            .navbar nav a { margin: 0 1em; color: #444; text-decoration: none; font-weight: 500; }
            .container { max-width: 1100px; margin: 2em auto; padding: 0 1em; }
            h2 { margin-top: 2em; color: #222; }
            form { background: #fff; border-radius: 1em; box-shadow: 0 2px 8px #eee; padding: 2em; }
            input, textarea, select { width: 100%; padding: 0.5em; margin-top: 0.5em; margin-bottom: 1em; border: 1px solid #ddd; border-radius: 0.5em; }
            button, .btn { background: #222; color: #fff; padding: 0.7em 1.5em; border: none; border-radius: 0.5em; cursor: pointer; transition: background 0.3s; margin-top: 1em; }
            button:hover, .btn:hover { background: #444; }
            .success, .error { padding: 1em; border-radius: 0.5em; margin-bottom: 1em; }
            .success { background: #d4edda; color: #155724; }
            .error { background: #f8d7da; color: #721c24; }
            .ingredient, .step { display: flex; gap: 0.5em; margin-bottom: 0.5em; }
            .ingredient input { flex: 1; }
            .step textarea { flex: 2; }
            .step input[type="file"] { flex: 1; }
        </style>
    </head>
    <body>
        <div class="navbar">
            <span class="logo">🍲 RecipeBox</span>
            <nav>
                <a href="/">Inicio</a>
                <a href="#">Explorar</a>
                <a href="/create">Crear</a>
            </nav>
            <span style="margin-left:auto;"></span>
        </div>
        <div class="container">
            <h2>Crear una nueva receta</h2>
            <div id="msg"></div>
            <form id="recipeForm" enctype="multipart/form-data">
                <label for="nombre">Nombre de la receta</label>
                <input type="text" id="nombre" name="nombre" required>

                <label for="descripcion">Descripción</label>
                <textarea id="descripcion" name="descripcion"></textarea>

                <label for="categoria_id">Categoría</label>
                <select id="categoria_id" name="categoria_id">
                    <option value="">Selecciona una categoría</option>
                </select>

                <label for="foto_principal">Foto principal</label>
                <input type="file" id="foto_principal" name="foto_principal" accept="image/*">

                <h3>Ingredientes</h3>
                <div id="ingredients">
                    <div class="ingredient">
                        <input type="text" name="ingredientes" placeholder="Ingrediente">
                        <input type="text" name="unidades" placeholder="Unidad">
                        <input type="number" name="cantidades" placeholder="Cantidad" step="any">
                        <button type="button" class="btn" onclick="removeIngredient(this)">Eliminar</button>
                    </div>
                </div>
                <button type="button" onclick="addIngredient()">Añadir ingrediente</button>

                <h3>Paso a paso</h3>
                <div id="steps">
                    <div class="step">
                        <textarea name="pasos" placeholder="Descripción del paso"></textarea>
                        <input type="file" name="fotos_pasos" accept="image/*">
                        <button type="button" class="btn" onclick="removeStep(this)">Eliminar</button>
                    </div>
                </div>
                <button type="button" onclick="addStep()">Añadir paso</button>

                <button type="submit">Guardar receta</button>
            </form>
        </div>
        <script>
        // Cargar categorías dinámicamente
        fetch('/categorias').then(r=>r.json()).then(data=>{
            const sel = document.getElementById('categoria_id');
            data.forEach(cat=>{
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.textContent = cat.nombre;
                sel.appendChild(opt);
            });
        });
        // Añadir/eliminar ingredientes
        function addIngredient() {
            const container = document.getElementById('ingredients');
            const div = document.createElement('div');
            div.className = 'ingredient';
            div.innerHTML = `
                <input type="text" name="ingredientes" placeholder="Ingrediente">
                <input type="text" name="unidades" placeholder="Unidad">
                <input type="number" name="cantidades" placeholder="Cantidad" step="any">
                <button type="button" class="btn" onclick="removeIngredient(this)">Eliminar</button>
            `;
            container.appendChild(div);
        }
        function removeIngredient(btn) {
            btn.parentElement.remove();
        }
        // Añadir/eliminar pasos
        function addStep() {
            const container = document.getElementById('steps');
            const div = document.createElement('div');
            div.className = 'step';
            div.innerHTML = `
                <textarea name="pasos" placeholder="Descripción del paso"></textarea>
                <input type="file" name="fotos_pasos" accept="image/*">
                <button type="button" class="btn" onclick="removeStep(this)">Eliminar</button>
            `;
            container.appendChild(div);
        }
        function removeStep(btn) {
            btn.parentElement.remove();
        }
        // Enviar formulario por AJAX
        document.getElementById('recipeForm').onsubmit = async function(e) {
            e.preventDefault();
            const form = e.target;
            const data = new FormData();
            data.append('nombre', form.nombre.value);
            data.append('descripcion', form.descripcion.value);
            data.append('categoria_id', form.categoria_id.value);
            if(form.foto_principal.files[0]) data.append('foto_principal', form.foto_principal.files[0]);
            // Ingredientes
            form.querySelectorAll('.ingredient').forEach(div=>{
                data.append('ingredientes', div.querySelector('input[name="ingredientes"]').value);
                data.append('unidades', div.querySelector('input[name="unidades"]').value);
                data.append('cantidades', div.querySelector('input[name="cantidades"]').value);
            });
            // Pasos
            form.querySelectorAll('.step').forEach(div=>{
                data.append('pasos', div.querySelector('textarea[name="pasos"]').value);
                if(div.querySelector('input[name="fotos_pasos"]').files[0])
                    data.append('fotos_pasos', div.querySelector('input[name="fotos_pasos"]').files[0]);
                else
                    data.append('fotos_pasos', new Blob());
            });
            // Enviar
            const msg = document.getElementById('msg');
            msg.innerHTML = '';
            try {
                const resp = await fetch('/api/recetas', {method:'POST', body:data});
                const res = await resp.json();
                if(res.success) {
                    msg.innerHTML = '<div class="success">¡Receta creada con éxito!</div>';
                    setTimeout(()=>{ window.location.href = '/'; }, 1500);
                } else {
                    msg.innerHTML = '<div class="error">Error: '+res.error+'</div>';
                }
            } catch(err) {
                msg.innerHTML = '<div class="error">Error: '+err+'</div>';
            }
        }
        </script>
    </body>
    </html>
    ''' 