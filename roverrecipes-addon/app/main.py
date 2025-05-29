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
    return """
    <html>
        <head><title>Rover Recipes Addon</title></head>
        <body style='font-family:sans-serif;text-align:center;margin-top:50px;'>
            <h1>🍲 Rover Recipes Addon</h1>
            <p>¡Bienvenido!<br>Haz clic abajo para ver las recetas.</p>
            <a href='/recetas' style='font-size:1.5em;color:#2196f3;'>Ver recetas</a>
        </body>
    </html>
    """

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