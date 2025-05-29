from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, Text, ForeignKey, DateTime, Float
from sqlalchemy.orm import sessionmaker, declarative_base, relationship
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional
import datetime
import os
from fastapi.responses import RedirectResponse, HTMLResponse

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
            .featured-recipe, .category-card { background: #fff; border-radius: 1em; box-shadow: 0 2px 8px #eee; overflow: hidden; width: 220px; transition: transform 0.2s; }
            .featured-recipe:hover, .category-card:hover { transform: translateY(-5px) scale(1.03); }
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
                <div class="featured-recipe">
                    <img src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=400&q=80" alt="Classic Tomato Pasta" />
                    <div class="info">
                        <div class="title">Classic Tomato Pasta</div>
                        <div class="desc">A simple and delicious pasta dish</div>
                    </div>
                </div>
                <div class="featured-recipe">
                    <img src="https://images.unsplash.com/photo-1519864600265-abb23847ef2c?auto=format&fit=crop&w=400&q=80" alt="Grilled Salmon with Roasted Vegetables" />
                    <div class="info">
                        <div class="title">Grilled Salmon with Roasted Vegetables</div>
                        <div class="desc">Healthy and flavorful grilled salmon</div>
                    </div>
                </div>
                <div class="featured-recipe">
                    <img src="https://images.unsplash.com/photo-1519864600265-abb23847ef2c?auto=format&fit=crop&w=400&q=80" alt="Decadent Chocolate Cake" />
                    <div class="info">
                        <div class="title">Decadent Chocolate Cake</div>
                        <div class="desc">Rich and moist chocolate cake</div>
                    </div>
                </div>
            </div>
            <h2>Categories</h2>
            <div class="categories">
                <div class="category-card">
                    <img src="https://images.unsplash.com/photo-1502741338009-cac2772e18bc?auto=format&fit=crop&w=400&q=80" alt="Italian" />
                    <div class="info"><div class="title">Italian</div></div>
                </div>
                <div class="category-card">
                    <img src="https://images.unsplash.com/photo-1464306076886-debca5e8a6b0?auto=format&fit=crop&w=400&q=80" alt="Seafood" />
                    <div class="info"><div class="title">Seafood</div></div>
                </div>
                <div class="category-card">
                    <img src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=400&q=80" alt="Desserts" />
                    <div class="info"><div class="title">Desserts</div></div>
                </div>
                <div class="category-card">
                    <img src="https://images.unsplash.com/photo-1519864600265-abb23847ef2c?auto=format&fit=crop&w=400&q=80" alt="Vegetarian" />
                    <div class="info"><div class="title">Vegetarian</div></div>
                </div>
                <div class="category-card">
                    <img src="https://images.unsplash.com/photo-1519864600265-abb23847ef2c?auto=format&fit=crop&w=400&q=80" alt="Quick & Easy" />
                    <div class="info"><div class="title">Quick & Easy</div></div>
                </div>
                <div class="category-card">
                    <img src="https://images.unsplash.com/photo-1464306076886-debca5e8a6b0?auto=format&fit=crop&w=400&q=80" alt="Healthy" />
                    <div class="info"><div class="title">Healthy</div></div>
                </div>
            </div>
        </div>
    </body>
    </html>
    '''

@app.get("/recetas")
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

@app.post("/recetas")
def crear_receta(
    nombre: str = Form(...),
    descripcion: str = Form(""),
    categoria_id: int = Form(None),
    foto_principal: UploadFile = File(None)
):
    db = SessionLocal()
    try:
        filename = None
        if foto_principal:
            filename = f"fotos/{datetime.datetime.utcnow().timestamp()}_{foto_principal.filename}"
            with open(f"/app/app/{filename}", "wb") as f:
                f.write(foto_principal.file.read())
        receta = Receta(
            nombre=nombre,
            descripcion=descripcion,
            categoria_id=categoria_id,
            foto_principal=filename
        )
        db.add(receta)
        db.commit()
        db.refresh(receta)
        return {"id": receta.id, "nombre": receta.nombre}
    except SQLAlchemyError as e:
        db.rollback()
        return {"error": str(e)}
    finally:
        db.close() 