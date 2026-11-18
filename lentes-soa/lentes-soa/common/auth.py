"""Autenticación compartida: JWT para usuarios y clave interna para servicio-a-servicio."""
import time

import jwt
from fastapi import Depends, Header, HTTPException

from .config import JWT_SECRET, SERVICE_KEY

DURACION_TOKEN = 60 * 60 * 8  # 8 horas


def crear_token(usuario: dict) -> str:
    payload = {
        "sub": str(usuario["id"]),
        "nombre": usuario["nombre"],
        "email": usuario["email"],
        "rol": usuario["rol"],
        "exp": int(time.time()) + DURACION_TOKEN,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decodificar_token(token: str) -> dict:
    try:
        datos = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sesión inválida o expirada")
    datos["id"] = int(datos["sub"])
    return datos


def usuario_actual(authorization: str | None = Header(None)) -> dict:
    """Dependencia: exige un token Bearer válido."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Debes iniciar sesión")
    return decodificar_token(authorization[7:])


def solo_admin(usuario: dict = Depends(usuario_actual)) -> dict:
    """Dependencia: exige rol administrador."""
    if usuario["rol"] != "admin":
        raise HTTPException(403, "Solo el administrador puede hacer esto")
    return usuario


def solo_servicio(x_servicio_key: str | None = Header(None)) -> None:
    """Dependencia: solo otro servicio del sistema puede llamar esta ruta."""
    if x_servicio_key != SERVICE_KEY:
        raise HTTPException(403, "Llamada interna no autorizada")


def headers_internos() -> dict:
    return {"X-Servicio-Key": SERVICE_KEY}
