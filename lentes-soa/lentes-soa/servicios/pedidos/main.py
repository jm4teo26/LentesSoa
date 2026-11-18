"""SERVICIO DE PEDIDOS (puerto 8003)
Creación y seguimiento de compras. Se comunica con el Servicio de Productos para reservar stock.
Estados: pendiente -> pagado -> enviado -> entregado  (o cancelado)
"""
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from common.auth import headers_internos, solo_admin, solo_servicio, usuario_actual
from common.config import URLS
from common.db import ahora, conectar, filas

DB = Path(__file__).with_name("pedidos.db")

app = FastAPI(
    title="Servicio de Pedidos",
    description="Creación y seguimiento de compras.",
    version="1.0.0",
)

ESTADOS = ("pendiente", "pagado", "enviado", "entregado", "cancelado")


class Item(BaseModel):
    producto_id: int
    cantidad: int = Field(gt=0, le=20)


class Direccion(BaseModel):
    calle: str = Field(min_length=3)
    colonia: str = Field(min_length=2)
    ciudad: str = Field(min_length=2)
    estado: str = Field(min_length=2)
    cp: str = Field(pattern=r"^\d{5}$")
    telefono: str = Field(pattern=r"^\d{10}$")


class NuevoPedido(BaseModel):
    items: list[Item] = Field(min_length=1)
    direccion: Direccion


class CambioEstado(BaseModel):
    estado: str = Field(pattern="^(" + "|".join(ESTADOS) + ")$")


def init_db():
    with conectar(DB) as c:
        c.execute("""CREATE TABLE IF NOT EXISTS pedidos(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL, usuario_nombre TEXT, usuario_email TEXT,
            direccion TEXT NOT NULL, total REAL NOT NULL,
            estado TEXT NOT NULL DEFAULT 'pendiente',
            creado TEXT NOT NULL, actualizado TEXT NOT NULL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS pedido_items(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
            producto_id INTEGER NOT NULL, nombre TEXT NOT NULL,
            precio REAL NOT NULL, cantidad INTEGER NOT NULL)""")


init_db()


def cargar(c, pedido_id: int) -> dict | None:
    p = c.execute("SELECT * FROM pedidos WHERE id=?", (pedido_id,)).fetchone()
    if not p:
        return None
    p = dict(p)
    p["items"] = filas(c.execute(
        "SELECT producto_id,nombre,precio,cantidad FROM pedido_items WHERE pedido_id=?", (pedido_id,)))
    return p


def lista(c, sql: str, args=()) -> list[dict]:
    return [cargar(c, r["id"]) for r in filas(c.execute(sql, args))]


@app.get("/salud", tags=["Sistema"])
def salud():
    return {"servicio": "pedidos", "ok": True}


# ---------- Cliente ----------
@app.post("/pedidos", status_code=201, tags=["Cliente"])
def crear_pedido(datos: NuevoPedido, u: dict = Depends(usuario_actual)):
    # 1) Pedir al Servicio de Productos que reserve el stock (y nos dé precios oficiales)
    try:
        r = httpx.post(f"{URLS['productos']}/productos/interno/reservar",
                       json={"items": [i.model_dump() for i in datos.items]},
                       headers=headers_internos(), timeout=5)
    except httpx.RequestError:
        raise HTTPException(503, "El servicio de productos no responde, intenta más tarde")
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.json().get("detail", "No se pudo reservar el producto"))
    items = r.json()["items"]
    total = round(sum(i["precio"] * i["cantidad"] for i in items), 2)
    d = datos.direccion
    direccion = f"{d.calle}, Col. {d.colonia}, {d.ciudad}, {d.estado}, C.P. {d.cp} · Tel. {d.telefono}"

    # 2) Guardar el pedido en NUESTRA base de datos
    with conectar(DB) as c:
        cur = c.execute("""INSERT INTO pedidos(usuario_id,usuario_nombre,usuario_email,direccion,total,
                           estado,creado,actualizado) VALUES(?,?,?,?,?,'pendiente',?,?)""",
                        (u["id"], u["nombre"], u["email"], direccion, total, ahora(), ahora()))
        pid = cur.lastrowid
        c.executemany("INSERT INTO pedido_items(pedido_id,producto_id,nombre,precio,cantidad) VALUES(?,?,?,?,?)",
                      [(pid, i["producto_id"], i["nombre"], i["precio"], i["cantidad"]) for i in items])
        return cargar(c, pid)


@app.get("/pedidos/mios", tags=["Cliente"])
def mis_pedidos(u: dict = Depends(usuario_actual)):
    with conectar(DB) as c:
        return lista(c, "SELECT id FROM pedidos WHERE usuario_id=? ORDER BY id DESC", (u["id"],))


@app.post("/pedidos/{pedido_id}/cancelar", tags=["Cliente"])
def cancelar(pedido_id: int, u: dict = Depends(usuario_actual)):
    with conectar(DB) as c:
        p = cargar(c, pedido_id)
        if not p or (p["usuario_id"] != u["id"] and u["rol"] != "admin"):
            raise HTTPException(404, "Pedido no encontrado")
        if p["estado"] != "pendiente":
            raise HTTPException(409, "Solo se pueden cancelar pedidos pendientes de pago")
        c.execute("UPDATE pedidos SET estado='cancelado', actualizado=? WHERE id=?", (ahora(), pedido_id))
    # Regresar el stock al Servicio de Productos
    try:
        httpx.post(f"{URLS['productos']}/productos/interno/liberar",
                   json={"items": [{"producto_id": i["producto_id"], "cantidad": i["cantidad"]} for i in p["items"]]},
                   headers=headers_internos(), timeout=5)
    except httpx.RequestError:
        pass
    with conectar(DB) as c:
        return cargar(c, pedido_id)


# ---------- Administrador ----------
@app.get("/pedidos", tags=["Administrador"])
def todos_los_pedidos(estado: str | None = None, _: dict = Depends(solo_admin)):
    with conectar(DB) as c:
        if estado:
            return lista(c, "SELECT id FROM pedidos WHERE estado=? ORDER BY id DESC", (estado,))
        return lista(c, "SELECT id FROM pedidos ORDER BY id DESC")


@app.get("/pedidos/estadisticas", tags=["Administrador"])
def estadisticas(_: dict = Depends(solo_admin)):
    with conectar(DB) as c:
        por_estado = {e: 0 for e in ESTADOS}
        for r in c.execute("SELECT estado, COUNT(*) n FROM pedidos GROUP BY estado"):
            por_estado[r["estado"]] = r["n"]
        ventas = c.execute("SELECT COALESCE(SUM(total),0) FROM pedidos WHERE estado IN "
                           "('pagado','enviado','entregado')").fetchone()[0]
        unidades = c.execute("""SELECT COALESCE(SUM(i.cantidad),0) FROM pedido_items i JOIN pedidos p
                                ON p.id=i.pedido_id WHERE p.estado IN ('pagado','enviado','entregado')""").fetchone()[0]
    return {"por_estado": por_estado, "total": sum(por_estado.values()), "ventas": ventas, "unidades": unidades}


@app.get("/pedidos/{pedido_id}", tags=["Cliente"])
def ver_pedido(pedido_id: int, u: dict = Depends(usuario_actual)):
    with conectar(DB) as c:
        p = cargar(c, pedido_id)
    if not p or (p["usuario_id"] != u["id"] and u["rol"] != "admin"):
        raise HTTPException(404, "Pedido no encontrado")
    return p


# ---------- Interno: usado por Pagos y Envíos ----------
@app.get("/pedidos/interno/{pedido_id}", tags=["Interno"], dependencies=[Depends(solo_servicio)])
def ver_interno(pedido_id: int):
    with conectar(DB) as c:
        p = cargar(c, pedido_id)
    if not p:
        raise HTTPException(404, "Pedido no encontrado")
    return p


@app.patch("/pedidos/interno/{pedido_id}/estado", tags=["Interno"], dependencies=[Depends(solo_servicio)])
def cambiar_estado(pedido_id: int, cambio: CambioEstado):
    with conectar(DB) as c:
        if c.execute("UPDATE pedidos SET estado=?, actualizado=? WHERE id=?",
                     (cambio.estado, ahora(), pedido_id)).rowcount == 0:
            raise HTTPException(404, "Pedido no encontrado")
        return cargar(c, pedido_id)
