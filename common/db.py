"""Utilidades SQLite. Cada servicio tiene SU PROPIA base de datos (principio SOA)."""
import sqlite3
from datetime import datetime


def conectar(ruta) -> sqlite3.Connection:
    con = sqlite3.connect(ruta)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def filas(cursor) -> list[dict]:
    return [dict(r) for r in cursor.fetchall()]


def ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")
