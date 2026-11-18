"""SERVICIO DE PAGOS (puerto 8004)
Procesa pagos con tarjeta bancaria (pasarela SIMULADA) y emite confirmaciones en tiempo real
(Server-Sent Events) tanto al cliente como al administrador.

Orquestación al aprobar un pago:
  Pagos -> Pedidos (marca 'pagado') -> Envíos (genera código de rastreo)

Tarjetas de prueba:
  4242 4242 4242 4242  -> aprobada
  4000 0000 0000 0002  -> rechazada (fondos insuficientes)
  4000 0000 0000 0069  -> rechazada (tarjeta reportada)
  Cualquier otra que pase el algoritmo de Luhn -> aprobada
"""
import asyncio
import json
import secrets
from datetime import date
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from common.auth import decodificar_token, headers_internos, solo_admin, usuario_actual
from common.config import URLS
from common.db import ahora, conectar, filas

DB = Path(__file__).with_name("pagos.db")

app = FastAPI(
    title="Servicio de Pagos",
    description="Procesamiento de pagos con tarjeta y confirmaciones en tiempo real.",
    version="1.0.0",
)


class Pago(BaseModel):
    pedido_id: int
    titular: str = Field(min_length=3)
    numero: str = Field(min_length=12, max_length=23)
    expiracion: str = Field(pattern=r"^\d{2}/\d{2}$", description="MM/AA")
    cvv: str = Field(pattern=r"^\d{3,4}$")


def init_db():
    with conectar(DB) as c:
        c.execute("""CREATE TABLE IF NOT EXISTS pagos(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL, usuario_nombre TEXT,
            monto REAL NOT NULL, marca TEXT, ultimos4 TEXT, titular TEXT,
            estado TEXT NOT NULL, motivo TEXT, autorizacion TEXT, creado TEXT NOT NULL)""")


init_db()


# ---------- Validaciones de tarjeta ----------
def luhn(numero: str) -> bool:
    total = 0
    for i, d in enumerate(reversed(numero)):
        n = int(d)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def marca(numero: str) -> str:
    if numero.startswith("4"):
        return "Visa"
    if numero[:2] in {"51", "52", "53", "54", "55"} or "2221" <= numero[:4] <= "2720":
        return "Mastercard"
    if numero[:2] in {"34", "37"}:
        return "American Express"
    return "Tarjeta"


def vigente(exp: str) -> bool:
    mes, anio = int(exp[:2]), 2000 + int(exp[3:])
    if not 1 <= mes <= 12:
        return False
    hoy = date.today()
    return (anio, mes) >= (hoy.year, hoy.month)


# ---------- Tiempo real (SSE) ----------
suscriptores: list[dict] = []


def emitir(evento: dict):
    """Envía el evento al cliente dueño del pedido y a todos los administradores conectados."""
    for s in list(suscriptores):
        if s["usuario"]["rol"] == "admin" or s["usuario"]["id"] == evento["usuario_id"]:
            s["cola"].put_nowait(evento)


@app.get("/pagos/eventos", tags=["Tiempo real"])
async def eventos(request: Request, token: str):
    """Stream de confirmaciones de pago (text/event-stream)."""
    usuario = decodificar_token(token)
    sub = {"usuario": usuario, "cola": asyncio.Queue()}
    suscriptores.append(sub)

    async def generar():
        try:
            yield "retry: 3000\n\n"
            while not await request.is_disconnected():
                try:
                    ev = await asyncio.wait_for(sub["cola"].get(), timeout=15)
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            suscriptores.remove(sub)

    return StreamingResponse(generar(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/salud", tags=["Sistema"])
def salud():
    return {"servicio": "pagos", "ok": True, "conectados_tiempo_real": len(suscriptores)}


# ---------- Procesar pago ----------
@app.post("/pagos", tags=["Cliente"])
async def pagar(p: Pago, u: dict = Depends(usuario_actual)):
    numero = p.numero.replace(" ", "").replace("-", "")
    if not numero.isdigit() or not luhn(numero):
        raise HTTPException(400, "El número de tarjeta no es válido")
    if not vigente(p.expiracion):
        raise HTTPException(400, "La tarjeta está vencida o la fecha es incorrecta")

    async with httpx.AsyncClient(timeout=5, headers=headers_internos()) as cli:
        # 1) Consultar el pedido al Servicio de Pedidos
        try:
            r = await cli.get(f"{URLS['pedidos']}/pedidos/interno/{p.pedido_id}")
        except httpx.RequestError:
            raise HTTPException(503, "El servicio de pedidos no responde")
        if r.status_code == 404:
            raise HTTPException(404, "Pedido no encontrado")
        pedido = r.json()
        if pedido["usuario_id"] != u["id"]:
            raise HTTPException(403, "Este pedido no te pertenece")
        if pedido["estado"] != "pendiente":
            raise HTTPException(409, f"El pedido ya está {pedido['estado']}")

        # 2) "Banco" simulado
        await asyncio.sleep(1.5)
        motivo = None
        if numero.endswith("0002"):
            motivo = "Fondos insuficientes"
        elif numero.endswith("0069"):
            motivo = "Tarjeta reportada por el banco emisor"
        aprobado = motivo is None
        autorizacion = secrets.token_hex(3).upper() if aprobado else None

        with conectar(DB) as c:
            cur = c.execute("""INSERT INTO pagos(pedido_id,usuario_id,usuario_nombre,monto,marca,ultimos4,
                               titular,estado,motivo,autorizacion,creado) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                            (pedido["id"], u["id"], u["nombre"], pedido["total"], marca(numero), numero[-4:],
                             p.titular, "aprobado" if aprobado else "rechazado", motivo, autorizacion, ahora()))
            pago_id = cur.lastrowid

        codigo = None
        if aprobado:
            # 3) Avisar a Pedidos y pedir a Envíos que genere la guía
            await cli.patch(f"{URLS['pedidos']}/pedidos/interno/{pedido['id']}/estado", json={"estado": "pagado"})
            try:
                re = await cli.post(f"{URLS['envios']}/envios/interno", json={
                    "pedido_id": pedido["id"], "usuario_id": u["id"],
                    "usuario_nombre": u["nombre"], "direccion": pedido["direccion"]})
                codigo = re.json().get("codigo")
            except httpx.RequestError:
                codigo = None  # el admin podrá generar el envío después

    resultado = {
        "tipo": "pago_aprobado" if aprobado else "pago_rechazado",
        "pago_id": pago_id, "pedido_id": pedido["id"], "usuario_id": u["id"],
        "usuario_nombre": u["nombre"], "monto": pedido["total"], "estado": "aprobado" if aprobado else "rechazado",
        "motivo": motivo, "autorizacion": autorizacion, "codigo_rastreo": codigo,
        "tarjeta": f"{marca(numero)} •••• {numero[-4:]}", "fecha": ahora(),
    }
    emitir(resultado)
    return resultado


@app.get("/pagos/mios", tags=["Cliente"])
def mis_pagos(u: dict = Depends(usuario_actual)):
    with conectar(DB) as c:
        return filas(c.execute("SELECT * FROM pagos WHERE usuario_id=? ORDER BY id DESC", (u["id"],)))


@app.get("/pagos", tags=["Administrador"])
def todos(_: dict = Depends(solo_admin)):
    with conectar(DB) as c:
        return filas(c.execute("SELECT * FROM pagos ORDER BY id DESC"))
