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

# ENDPOINTS DE LA API (DEFINIDOS ANTES DE STATICFILES)
@app.get("/api/categorias")
def listar_categorias():
    db = SessionLocal()
    categorias = db.query(Categoria).all()
    resultado = [{"id": c.id, "nombre": c.nombre} for c in categorias]
    db.close()
    return resultado

@app.get("/api/recetas")
def listar_recetas_api():
    db = SessionLocal()
    recetas_db = db.query(Receta).all()
    resultado = []
    for r in recetas_db:
        resultado.append({
            "id": r.id,
            "nombre": r.nombre,
            "descripcion": r.descripcion,
            "categoria": r.categoria.nombre if r.categoria else None,
            "foto_principal": r.foto_principal,
            "fecha_creacion": r.fecha_creacion.isoformat() if r.fecha_creacion else None,
        })
    db.close()
    return resultado

@app.post("/api/recetas")
async def crear_receta_api(
    request: Request,
    nombre: str = Form(...),
    descripcion: str = Form(""),
    categoria_id: Optional[str] = Form(None),
    foto_principal: Optional[UploadFile] = File(None),
    ingredientes: List[str] = Form([]),
    unidades: List[str] = Form([]),
    cantidades: List[str] = Form([]),
    pasos: List[str] = Form([]),
    fotos_pasos: List[UploadFile] = File([])
):
    db = SessionLocal()
    try:
        filename = None
        if foto_principal and foto_principal.filename:
            os.makedirs("fotos", exist_ok=True)
            filename = f"fotos/{datetime.datetime.utcnow().timestamp()}_{foto_principal.filename}"
            with open(filename, "wb") as f:
                f.write(await foto_principal.read())
        
        cat_id_int = None
        if categoria_id and categoria_id.isdigit():
            cat_id_int = int(categoria_id)

        nueva_receta = Receta(
            nombre=nombre,
            descripcion=descripcion,
            categoria_id=cat_id_int,
            foto_principal=filename
        )
        db.add(nueva_receta)
        db.commit()
        db.refresh(nueva_receta)

        for i, ing_nombre in enumerate(ingredientes):
            if not ing_nombre.strip():
                continue
            unidad = unidades[i] if i < len(unidades) else ""
            try:
                cantidad_val = float(cantidades[i] if i < len(cantidades) and cantidades[i] else 0)
            except ValueError:
                cantidad_val = 0.0

            ingrediente_obj = db.query(Ingrediente).filter_by(nombre=ing_nombre.strip()).first()
            if not ingrediente_obj:
                ingrediente_obj = Ingrediente(nombre=ing_nombre.strip(), unidad=unidad.strip())
                db.add(ingrediente_obj)
                db.commit()
                db.refresh(ingrediente_obj)
            
            receta_ingrediente = RecetaIngrediente(
                receta_id=nueva_receta.id,
                ingrediente_id=ingrediente_obj.id,
                cantidad=cantidad_val
            )
            db.add(receta_ingrediente)

        os.makedirs("fotos/pasos", exist_ok=True)
        for i, paso_desc in enumerate(pasos):
            if not paso_desc.strip():
                continue
            
            foto_paso_filename = None
            if i < len(fotos_pasos) and fotos_pasos[i] and fotos_pasos[i].filename:
                paso_file = fotos_pasos[i]
                foto_paso_filename = f"fotos/pasos/{datetime.datetime.utcnow().timestamp()}_{paso_file.filename}"
                with open(foto_paso_filename, "wb") as f:
                    f.write(await paso_file.read())

            paso_obj = Paso(
                receta_id=nueva_receta.id,
                paso_numero=i + 1,
                descripcion=paso_desc.strip(),
                foto=foto_paso_filename
            )
            db.add(paso_obj)
        
        db.commit()
        return JSONResponse({"success": True, "id": nueva_receta.id, "nombre": nueva_receta.nombre})
    except SQLAlchemyError as e:
        db.rollback()
        return JSONResponse({"success": False, "error": f"Error de base de datos: {str(e)}"}, status_code=500)
    except Exception as e:
        db.rollback()
        return JSONResponse({"success": False, "error": f"Error inesperado: {str(e)}"}, status_code=500)
    finally:
        db.close()

# FastAPI servirá desde la carpeta 'static' que está al mismo nivel que main.py dentro del contenedor (/app/app/static)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

# La antigua ruta HTML /create ya no es necesaria si todo se maneja con el SPA moderno.
# Si se necesita, debería ser un endpoint API que devuelve datos o una plantilla, o ser parte del SPA.
# @app.get("/create", response_class=HTMLResponse)
# def create_page():
#    return '''... (HTML antiguo) ...''' 