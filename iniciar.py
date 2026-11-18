"""Arranca los 5 servicios + el API Gateway, cada uno como un proceso independiente.

Uso:  python iniciar.py
Luego abre http://localhost:8000
"""
import signal
import subprocess
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
from common.config import HOST, PUERTOS  # noqa: E402

MODULOS = {
    "usuarios": "servicios.usuarios.main:app",
    "productos": "servicios.productos.main:app",
    "pedidos": "servicios.pedidos.main:app",
    "pagos": "servicios.pagos.main:app",
    "envios": "servicios.envios.main:app",
    "gateway": "gateway.main:app",
}


def main():
    procesos = []
    for nombre, modulo in MODULOS.items():
        p = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", modulo, "--host", HOST, "--port", str(PUERTOS[nombre]),
             "--log-level", "warning"],
            cwd=RAIZ)
        procesos.append((nombre, p))
        print(f"  ▸ {nombre:<10} http://{HOST}:{PUERTOS[nombre]}"
              + ("" if nombre == "gateway" else f"   (documentación: /docs)"))
        time.sleep(0.3)

    print("\n  Tienda:  http://localhost:8000")
    print("  Admin:   http://localhost:8000/admin   (admin@mirada.com / admin123)")
    print("  Ctrl+C para detener todo.\n")

    def detener(*_):
        for _, p in procesos:
            p.terminate()
        sys.exit(0)

    signal.signal(signal.SIGINT, detener)
    signal.signal(signal.SIGTERM, detener)
    while True:
        for nombre, p in procesos:
            if p.poll() is not None:
                print(f"  ✖ El servicio '{nombre}' se detuvo (código {p.returncode})")
                procesos.remove((nombre, p))
        time.sleep(2)


if __name__ == "__main__":
    main()
