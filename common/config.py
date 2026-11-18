"""Configuración compartida entre servicios (puertos, claves).

En producción estos valores vendrían de variables de entorno.
"""
import os

# Clave para firmar los tokens JWT (la conocen todos los servicios para validar sesiones)
JWT_SECRET = os.getenv("JWT_SECRET", "cambia-esta-clave-soa-2026")

# Clave que usan los servicios para llamarse entre sí (rutas /interno)
SERVICE_KEY = os.getenv("SERVICE_KEY", "clave-interna-entre-servicios")

HOST = os.getenv("SOA_HOST", "127.0.0.1")

PUERTOS = {
    "gateway": 8000,
    "usuarios": 8001,
    "productos": 8002,
    "pedidos": 8003,
    "pagos": 8004,
    "envios": 8005,
}

URLS = {nombre: f"http://{HOST}:{puerto}" for nombre, puerto in PUERTOS.items() if nombre != "gateway"}
