"""SERVICIO DE USUARIOS (puerto 8001)
Registro, autenticación de clientes y gestión de perfiles por el administrador.
"""
import hashlib
import secrets
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from common.auth import crear_token, solo_admin, usuario_actual
from common.db import ahora, conectar, filas

DB = Path(__file__).with_name("usuarios.db")

app = FastAPI(
    title="Servicio de Usuarios",
    description="Registro, inicio de sesión y gestión de clientes.",
    version="1.0.0",
)


# ---------- Contratos (modelos) ----------
class Registro(BaseModel):
    nombre: str = Field(min_length=2, max_length=80)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=6)
    telefono: str = ""


class Login(BaseModel):
    email: str
    password: str


class ActualizarPerfil(BaseModel):
    nombre: str | None = Field(None, min_length=2, max_length=80)
    telefono: str | None = None


class ActualizarUsuarioAdmin(BaseModel):
    nombre: str | None = None
    telefono: str | None = None
    rol: str | None = Field(None, pattern="^(cliente|admin)$")
    activo: bool | None = None


# ---------- Utilidades ----------
def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return f"{salt}${h}"


def verificar_password(password: str, guardado: str) -> bool:
    salt = guardado.split("$")[0]
    return secrets.compare_digest(hash_password(password, salt), guardado)


def publico(u: dict) -> dict:
    u = dict(u)
    u.pop("password", None)
    u["activo"] = bool(u["activo"])
    return u


def init_db():
    with conectar(DB) as c:
        c.execute("""CREATE TABLE IF NOT EXISTS usuarios(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            rol TEXT NOT NULL DEFAULT 'cliente',
            telefono TEXT DEFAULT '',
            activo INTEGER NOT NULL DEFAULT 1,
            creado TEXT NOT NULL)""")
        if not c.execute("SELECT 1 FROM usuarios LIMIT 1").fetchone():
            c.execute("INSERT INTO usuarios(nombre,email,password,rol,creado) VALUES(?,?,?,?,?)",
                      ("Administrador", "admin@mirada.com", hash_password("admin123"), "admin", ahora()))
            c.execute("INSERT INTO usuarios(nombre,email,password,rol,telefono,creado) VALUES(?,?,?,?,?,?)",
                      ("Cliente Demo", "cliente@mirada.com", hash_password("cliente123"), "cliente",
                       "6871234567", ahora()))


init_db()


# ---------- Rutas ----------
@app.get("/salud", tags=["Sistema"])
def salud():
    return {"servicio": "usuarios", "ok": True}


@app.post("/usuarios/registro", status_code=201, tags=["Cliente"])
def registrar(datos: Registro):
    email = datos.email.lower().strip()
    with conectar(DB) as c:
        if c.execute("SELECT 1 FROM usuarios WHERE email=?", (email,)).fetchone():
            raise HTTPException(409, "Ese correo ya está registrado")
        cur = c.execute(
            "INSERT INTO usuarios(nombre,email,password,telefono,creado) VALUES(?,?,?,?,?)",
            (datos.nombre.strip(), email, hash_password(datos.password), datos.telefono, ahora()))
        u = dict(c.execute("SELECT * FROM usuarios WHERE id=?", (cur.lastrowid,)).fetchone())
    return {"token": crear_token(u), "usuario": publico(u)}


@app.post("/usuarios/login", tags=["Cliente"])
def login(datos: Login):
    with conectar(DB) as c:
        row = c.execute("SELECT * FROM usuarios WHERE email=?", (datos.email.lower().strip(),)).fetchone()
    if not row or not verificar_password(datos.password, row["password"]):
        raise HTTPException(401, "Correo o contraseña incorrectos")
    if not row["activo"]:
        raise HTTPException(403, "Tu cuenta está desactivada. Contacta al administrador")
    u = dict(row)
    return {"token": crear_token(u), "usuario": publico(u)}


@app.get("/usuarios/perfil", tags=["Cliente"])
def ver_perfil(u: dict = Depends(usuario_actual)):
    with conectar(DB) as c:
        row = c.execute("SELECT * FROM usuarios WHERE id=?", (u["id"],)).fetchone()
    if not row:
        raise HTTPException(404, "Usuario no encontrado")
    return publico(row)


@app.put("/usuarios/perfil", tags=["Cliente"])
def editar_perfil(datos: ActualizarPerfil, u: dict = Depends(usuario_actual)):
    cambios = datos.model_dump(exclude_none=True)
    with conectar(DB) as c:
        for campo, valor in cambios.items():
            c.execute(f"UPDATE usuarios SET {campo}=? WHERE id=?", (valor, u["id"]))
        return publico(c.execute("SELECT * FROM usuarios WHERE id=?", (u["id"],)).fetchone())


@app.get("/usuarios", tags=["Administrador"])
def listar_usuarios(_: dict = Depends(solo_admin)):
    with conectar(DB) as c:
        return [publico(u) for u in filas(c.execute("SELECT * FROM usuarios ORDER BY id DESC"))]


@app.put("/usuarios/{usuario_id}", tags=["Administrador"])
def actualizar_usuario(usuario_id: int, datos: ActualizarUsuarioAdmin, admin: dict = Depends(solo_admin)):
    cambios = datos.model_dump(exclude_none=True)
    if usuario_id == admin["id"] and (cambios.get("activo") is False or cambios.get("rol") == "cliente"):
        raise HTTPException(400, "No puedes desactivarte ni quitarte el rol de administrador a ti mismo")
    with conectar(DB) as c:
        if not c.execute("SELECT 1 FROM usuarios WHERE id=?", (usuario_id,)).fetchone():
            raise HTTPException(404, "Usuario no encontrado")
        for campo, valor in cambios.items():
            c.execute(f"UPDATE usuarios SET {campo}=? WHERE id=?",
                      (int(valor) if isinstance(valor, bool) else valor, usuario_id))
        return publico(c.execute("SELECT * FROM usuarios WHERE id=?", (usuario_id,)).fetchone())


@app.delete("/usuarios/{usuario_id}", tags=["Administrador"])
def eliminar_usuario(usuario_id: int, admin: dict = Depends(solo_admin)):
    if usuario_id == admin["id"]:
        raise HTTPException(400, "No puedes eliminar tu propia cuenta")
    with conectar(DB) as c:
        if c.execute("DELETE FROM usuarios WHERE id=?", (usuario_id,)).rowcount == 0:
            raise HTTPException(404, "Usuario no encontrado")
    return {"ok": True}
