"""SERVICIO DE PRODUCTOS (puerto 8002)
Catálogo e inventario de lentes. El cliente consulta; el administrador da de alta, baja y modifica.
"""
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from common.auth import solo_admin, solo_servicio
from common.db import ahora, conectar, filas

DB = Path(__file__).with_name("productos.db")

app = FastAPI(
    title="Servicio de Productos",
    description="Catálogo e inventario de lentes.",
    version="1.0.0",
)

CATEGORIAS = "^(sol|oftalmico|deportivo|lectura)$"
FORMAS = "^(redondo|cuadrado|aviador|cat-eye|wayfarer|deportivo)$"


class ProductoIn(BaseModel):
    nombre: str = Field(min_length=2, max_length=80)
    marca: str = Field(min_length=1, max_length=40)
    categoria: str = Field(pattern=CATEGORIAS)
    forma: str = Field(pattern=FORMAS)
    material: str = "Acetato"
    genero: str = Field("Unisex", pattern="^(Unisex|Hombre|Mujer)$")
    color_armazon: str = Field("#1f2937", pattern=r"^#[0-9a-fA-F]{6}$")
    color_mica: str = Field("#64748b", pattern=r"^#[0-9a-fA-F]{6}$")
    precio: float = Field(gt=0)
    stock: int = Field(ge=0)
    descripcion: str = ""
    activo: bool = True


class Item(BaseModel):
    producto_id: int
    cantidad: int = Field(gt=0)


class Reserva(BaseModel):
    items: list[Item] = Field(min_length=1)


def salida(p: dict) -> dict:
    p = dict(p)
    p["activo"] = bool(p["activo"])
    return p


SEMILLA = [
    ("Aurora", "Mirada", "sol", "aviador", "Metal", "Unisex", "#b8860b", "#365314", 1899, 15,
     "Aviador clásico de metal dorado con micas polarizadas verde G-15."),
    ("Nube", "Mirada", "oftalmico", "redondo", "Acetato", "Unisex", "#7c2d12", "#e2e8f0", 1290, 20,
     "Armazón redondo de acetato carey, ligero y cómodo para todo el día."),
    ("Bruma", "Kontra", "sol", "wayfarer", "Acetato", "Unisex", "#111827", "#1f2937", 1550, 18,
     "Wayfarer negro mate con protección UV400."),
    ("Gata", "Lúcida", "sol", "cat-eye", "Acetato", "Mujer", "#9d174d", "#4c0519", 1750, 10,
     "Cat-eye con puntas elevadas y micas degradadas."),
    ("Marco", "Kontra", "oftalmico", "cuadrado", "TR-90", "Hombre", "#1e3a8a", "#e2e8f0", 990, 25,
     "Armazón cuadrado flexible TR-90, ideal para graduación."),
    ("Ráfaga", "Velox", "deportivo", "deportivo", "Policarbonato", "Unisex", "#dc2626", "#0369a1", 2190, 12,
     "Lente envolvente para ciclismo y running, mica espejo azul."),
    ("Página", "Lúcida", "lectura", "redondo", "Metal", "Unisex", "#475569", "#f1f5f9", 650, 30,
     "Lentes de lectura +1.50 con filtro de luz azul."),
    ("Horizonte", "Mirada", "sol", "cuadrado", "Acetato", "Hombre", "#3f3f46", "#78350f", 1690, 14,
     "Cuadrado grueso con micas café polarizadas."),
    ("Pétalo", "Lúcida", "oftalmico", "cat-eye", "Acetato", "Mujer", "#be185d", "#fce7f3", 1390, 16,
     "Cat-eye sutil en rosa translúcido, para graduación."),
    ("Cometa", "Velox", "deportivo", "deportivo", "Policarbonato", "Unisex", "#16a34a", "#f59e0b", 1990, 8,
     "Escudo deportivo con mica ámbar para días nublados."),
    ("Faro", "Kontra", "sol", "redondo", "Metal", "Unisex", "#a16207", "#1e293b", 1450, 22,
     "Redondo de metal estilo retro con micas oscuras."),
    ("Nota", "Lúcida", "lectura", "wayfarer", "Acetato", "Unisex", "#0f766e", "#f1f5f9", 720, 28,
     "Wayfarer de lectura +2.00 en verde azulado."),
]


def init_db():
    with conectar(DB) as c:
        c.execute("""CREATE TABLE IF NOT EXISTS productos(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL, marca TEXT NOT NULL, categoria TEXT NOT NULL, forma TEXT NOT NULL,
            material TEXT, genero TEXT, color_armazon TEXT, color_mica TEXT,
            precio REAL NOT NULL, stock INTEGER NOT NULL, descripcion TEXT,
            activo INTEGER NOT NULL DEFAULT 1, creado TEXT NOT NULL)""")
        if not c.execute("SELECT 1 FROM productos LIMIT 1").fetchone():
            c.executemany("""INSERT INTO productos(nombre,marca,categoria,forma,material,genero,
                color_armazon,color_mica,precio,stock,descripcion,creado)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""", [s + (ahora(),) for s in SEMILLA])


init_db()


@app.get("/salud", tags=["Sistema"])
def salud():
    return {"servicio": "productos", "ok": True}


# ---------- Cliente: consultar catálogo ----------
@app.get("/productos", tags=["Catálogo"])
def listar(
    categoria: str | None = None,
    forma: str | None = None,
    q: str | None = Query(None, description="Texto a buscar en nombre, marca o descripción"),
    precio_max: float | None = None,
    todos: bool = Query(False, description="Incluir inactivos (uso del panel admin)"),
):
    sql, args = "SELECT * FROM productos WHERE 1=1", []
    if not todos:
        sql += " AND activo=1"
    if categoria:
        sql += " AND categoria=?"; args.append(categoria)
    if forma:
        sql += " AND forma=?"; args.append(forma)
    if precio_max:
        sql += " AND precio<=?"; args.append(precio_max)
    if q:
        sql += " AND (nombre LIKE ? OR marca LIKE ? OR descripcion LIKE ?)"; args += [f"%{q}%"] * 3
    with conectar(DB) as c:
        return [salida(p) for p in filas(c.execute(sql + " ORDER BY id", args))]


@app.get("/productos/{producto_id}", tags=["Catálogo"])
def detalle(producto_id: int):
    with conectar(DB) as c:
        p = c.execute("SELECT * FROM productos WHERE id=?", (producto_id,)).fetchone()
    if not p:
        raise HTTPException(404, "Producto no encontrado")
    return salida(p)


# ---------- Administrador: alta, baja, modificación ----------
@app.post("/productos", status_code=201, tags=["Administrador"])
def crear(p: ProductoIn, _: dict = Depends(solo_admin)):
    d = p.model_dump()
    d["activo"] = int(d["activo"])
    with conectar(DB) as c:
        cur = c.execute(f"INSERT INTO productos({','.join(d)},creado) VALUES({','.join('?' * len(d))},?)",
                        [*d.values(), ahora()])
        return salida(c.execute("SELECT * FROM productos WHERE id=?", (cur.lastrowid,)).fetchone())


@app.put("/productos/{producto_id}", tags=["Administrador"])
def modificar(producto_id: int, p: ProductoIn, _: dict = Depends(solo_admin)):
    d = p.model_dump()
    d["activo"] = int(d["activo"])
    with conectar(DB) as c:
        cur = c.execute(f"UPDATE productos SET {','.join(k + '=?' for k in d)} WHERE id=?",
                        [*d.values(), producto_id])
        if cur.rowcount == 0:
            raise HTTPException(404, "Producto no encontrado")
        return salida(c.execute("SELECT * FROM productos WHERE id=?", (producto_id,)).fetchone())


@app.delete("/productos/{producto_id}", tags=["Administrador"])
def eliminar(producto_id: int, _: dict = Depends(solo_admin)):
    with conectar(DB) as c:
        if c.execute("DELETE FROM productos WHERE id=?", (producto_id,)).rowcount == 0:
            raise HTTPException(404, "Producto no encontrado")
    return {"ok": True}


# ---------- Interno: usado por el Servicio de Pedidos ----------
@app.post("/productos/interno/reservar", tags=["Interno"], dependencies=[Depends(solo_servicio)])
def reservar(r: Reserva):
    """Descuenta stock de forma atómica. Si un producto no alcanza, no se descuenta nada."""
    con = conectar(DB)
    try:
        con.execute("BEGIN IMMEDIATE")
        resultado = []
        for it in r.items:
            p = con.execute("SELECT * FROM productos WHERE id=? AND activo=1", (it.producto_id,)).fetchone()
            if not p:
                raise HTTPException(404, f"El producto #{it.producto_id} ya no está disponible")
            if p["stock"] < it.cantidad:
                raise HTTPException(409, f"Stock insuficiente de '{p['nombre']}' (quedan {p['stock']})")
            con.execute("UPDATE productos SET stock=stock-? WHERE id=?", (it.cantidad, it.producto_id))
            resultado.append({"producto_id": p["id"], "nombre": p["nombre"], "precio": p["precio"],
                              "cantidad": it.cantidad})
        con.commit()
        return {"items": resultado}
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


@app.post("/productos/interno/liberar", tags=["Interno"], dependencies=[Depends(solo_servicio)])
def liberar(r: Reserva):
    """Regresa stock (pedido cancelado)."""
    with conectar(DB) as c:
        for it in r.items:
            c.execute("UPDATE productos SET stock=stock+? WHERE id=?", (it.cantidad, it.producto_id))
    return {"ok": True}
