"""API GATEWAY (puerto 8000)
Punto único de entrada: sirve el frontend y enruta /api/<servicio>/... al servicio correspondiente.
Las rutas /interno NO se exponen al exterior: solo los servicios pueden llamarlas entre sí.
"""
import asyncio
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from common.config import URLS

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="API Gateway · Mirada", version="1.0.0")
cliente = httpx.AsyncClient(timeout=15)


@app.get("/api/salud")
async def salud_servicios():
    """Estado de los 5 servicios (lo usa el panel de administración)."""
    async def revisar(nombre, url):
        t = time.perf_counter()
        try:
            r = await cliente.get(f"{url}/salud", timeout=2)
            ok = r.status_code == 200
        except httpx.RequestError:
            ok = False
        return {"servicio": nombre, "url": url, "ok": ok, "ms": round((time.perf_counter() - t) * 1000)}
    return await asyncio.gather(*(revisar(n, u) for n, u in URLS.items()))


@app.get("/api/pagos/eventos")
async def eventos_tiempo_real(token: str):
    """Reenvía el stream SSE del Servicio de Pagos."""
    async def reenviar():
        try:
            async with httpx.AsyncClient(timeout=None) as c:
                async with c.stream("GET", f"{URLS['pagos']}/pagos/eventos", params={"token": token}) as r:
                    async for trozo in r.aiter_raw():
                        yield trozo
        except httpx.RequestError:
            yield b"retry: 5000\n\n"
    return StreamingResponse(reenviar(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.api_route("/api/{ruta:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def enrutar(ruta: str, request: Request):
    partes = ruta.strip("/").split("/")
    servicio = partes[0]
    if servicio not in URLS:
        raise HTTPException(404, f"No existe el servicio '{servicio}'")
    if "interno" in partes:
        raise HTTPException(403, "Ruta interna: solo accesible entre servicios")
    headers = {k: v for k, v in request.headers.items() if k.lower() in ("authorization", "content-type")}
    try:
        r = await cliente.request(request.method, f"{URLS[servicio]}/{ruta}",
                                  params=request.query_params, content=await request.body(), headers=headers)
    except httpx.RequestError:
        return JSONResponse({"detail": f"El servicio de {servicio} no está disponible en este momento"}, 503)
    return Response(r.content, r.status_code, media_type=r.headers.get("content-type"))


# ---------- Frontend ----------
@app.get("/admin")
def panel_admin():
    return FileResponse(FRONTEND / "admin.html")


app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
