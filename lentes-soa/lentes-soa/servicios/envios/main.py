"""SERVICIO DE ENVÍOS (puerto 8005)
Rastrea la logística del paquete hasta su entrega.
Estados: preparando -> en_transito -> en_reparto -> entregado
Al cambiar de estado informa al Servicio de Pedidos (enviado / entregado).
"""
import secrets
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from common.auth import headers_internos, solo_admin, solo_servicio, usuario_actual
from common.config import URLS
from common.db import ahora, conectar, filas

DB = Path(__file__).with_name("envios.db")

app = FastAPI(
    title="Servicio de Envíos",
    description="Generación de guías y rastreo de paquetes.",
    version="1.0.0",
)

ESTADOS = ("preparando", "en_transito", "en_reparto", "entregado")
NOTAS = {
    "preparando": "Pago confirmado. Tu pedido se está preparando en almacén.",
    "en_transito": "El paquete salió del centro de distribución.",
    "en_reparto": "El paquete está en camino a tu domicilio.",
    "entregado": "Paquete entregado. ¡Disfruta tus lentes!",
}
ESTADO_PEDIDO = {"en_transito": "enviado", "en_reparto": "enviado", "entregado": "entregado"}


class NuevoEnvio(BaseModel):
    pedido_id: int
    usuario_id: int
    usuario_nombre: str = ""
    direccion: str


class CambioEstado(BaseModel):
    estado: str = Field(pattern="^(" + "|".join(ESTADOS) + ")$")
    nota: str = ""


def init_db():
    with conectar(DB) as c:
        c.execute("""CREATE TABLE IF NOT EXISTS envios(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER UNIQUE NOT NULL, usuario_id INTEGER NOT NULL, usuario_nombre TEXT,
            codigo TEXT UNIQUE NOT NULL, direccion TEXT NOT NULL, paqueteria TEXT NOT NULL,
            estado TEXT NOT NULL, creado TEXT NOT NULL, actualizado TEXT NOT NULL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS historial(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            envio_id INTEGER NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
            estado TEXT NOT NULL, nota TEXT, fecha TEXT NOT NULL)""")


init_db()


def cargar(c, where: str, valor) -> dict | None:
    e = c.execute(f"SELECT * FROM envios WHERE {where}=?", (valor,)).fetchone()
    if not e:
        return None
    e = dict(e)
    e["historial"] = filas(c.execute(
        "SELECT estado,nota,fecha FROM historial WHERE envio_id=? ORDER BY id", (e["id"],)))
    return e


@app.get("/salud", tags=["Sistema"])
def salud():
    return {"servicio": "envios", "ok": True}


@app.get("/envios/rastreo/{codigo}", tags=["Público"])
def rastrear(codigo: str):
    """Cualquiera con el código de rastreo puede consultar el estado (sin datos personales)."""
    with conectar(DB) as c:
        e = cargar(c, "codigo", codigo.strip().upper())
    if not e:
        raise HTTPException(404, "No encontramos un envío con ese código")
    ciudad = e["direccion"].split(",")[-3].strip() if e["direccion"].count(",") >= 3 else ""
    return {k: e[k] for k in ("codigo", "pedido_id", "paqueteria", "estado", "creado", "actualizado",
                              "historial")} | {"destino": ciudad}


@app.get("/envios/pedido/{pedido_id}", tags=["Cliente"])
def envio_de_pedido(pedido_id: int, u: dict = Depends(usuario_actual)):
    with conectar(DB) as c:
        e = cargar(c, "pedido_id", pedido_id)
    if not e or (e["usuario_id"] != u["id"] and u["rol"] != "admin"):
        raise HTTPException(404, "Este pedido aún no tiene envío")
    return e


@app.get("/envios", tags=["Administrador"])
def todos(_: dict = Depends(solo_admin)):
    with conectar(DB) as c:
        return [cargar(c, "id", r["id"]) for r in filas(c.execute("SELECT id FROM envios ORDER BY id DESC"))]


@app.patch("/envios/{envio_id}/estado", tags=["Administrador"])
def actualizar_estado(envio_id: int, cambio: CambioEstado, _: dict = Depends(solo_admin)):
    with conectar(DB) as c:
        e = cargar(c, "id", envio_id)
        if not e:
            raise HTTPException(404, "Envío no encontrado")
        if ESTADOS.index(cambio.estado) <= ESTADOS.index(e["estado"]):
            raise HTTPException(409, "El envío solo puede avanzar a un estado posterior")
        c.execute("UPDATE envios SET estado=?, actualizado=? WHERE id=?", (cambio.estado, ahora(), envio_id))
        c.execute("INSERT INTO historial(envio_id,estado,nota,fecha) VALUES(?,?,?,?)",
                  (envio_id, cambio.estado, cambio.nota or NOTAS[cambio.estado], ahora()))
    # Informar al Servicio de Pedidos
    if cambio.estado in ESTADO_PEDIDO:
        try:
            httpx.patch(f"{URLS['pedidos']}/pedidos/interno/{e['pedido_id']}/estado",
                        json={"estado": ESTADO_PEDIDO[cambio.estado]}, headers=headers_internos(), timeout=5)
        except httpx.RequestError:
            pass
    with conectar(DB) as c:
        return cargar(c, "id", envio_id)


@app.post("/envios/interno", status_code=201, tags=["Interno"], dependencies=[Depends(solo_servicio)])
def crear_envio(n: NuevoEnvio):
    """Lo llama el Servicio de Pagos cuando un pago es aprobado."""
    with conectar(DB) as c:
        existente = cargar(c, "pedido_id", n.pedido_id)
        if existente:
            return existente
        codigo = "MRD-" + secrets.token_hex(4).upper()
        cur = c.execute("""INSERT INTO envios(pedido_id,usuario_id,usuario_nombre,codigo,direccion,paqueteria,
                           estado,creado,actualizado) VALUES(?,?,?,?,?,?,'preparando',?,?)""",
                        (n.pedido_id, n.usuario_id, n.usuario_nombre, codigo, n.direccion, "Estafeta",
                         ahora(), ahora()))
        c.execute("INSERT INTO historial(envio_id,estado,nota,fecha) VALUES(?,?,?,?)",
                  (cur.lastrowid, "preparando", NOTAS["preparando"], ahora()))
        return cargar(c, "id", cur.lastrowid)
