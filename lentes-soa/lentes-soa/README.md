# Mirada · Plataforma E-commerce de Lentes (Arquitectura SOA)

Proyecto Integrador, materia **SOA (Arquitectura Orientada a Servicios)**.

Tienda en línea de lentes construida con **5 servicios independientes**. Cada servicio tiene su propio proceso, su propio puerto y su propia base de datos. Todos quedan detrás de un **API Gateway** que también sirve el sitio web.

---

## 1. Cómo ejecutarlo

Requisito: **Python 3.10 o superior**.

```bash
pip install -r requirements.txt
python iniciar.py
```

En Windows también puedes dar doble clic a `iniciar.bat`.

| Qué | URL |
|---|---|
| Tienda (cliente) | http://localhost:8000 |
| Panel de administración | http://localhost:8000/admin |
| Documentación Swagger de cada servicio | http://localhost:8001/docs … http://localhost:8005/docs |

**Cuentas de prueba**

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | admin@mirada.com | admin123 |
| Cliente | cliente@mirada.com | cliente123 |

**Tarjetas de prueba** (la pasarela bancaria es simulada)

| Número | Resultado |
|---|---|
| 4242 4242 4242 4242 | Aprobada |
| 4000 0000 0000 0002 | Rechazada: fondos insuficientes |
| 4000 0000 0000 0069 | Rechazada: tarjeta reportada |

Cualquier fecha futura y cualquier CVV de 3 dígitos sirven. Cualquier otro número válido según el algoritmo de Luhn se aprueba.

> Para reiniciar los datos, borra los archivos `*.db` dentro de `servicios/`. Se vuelven a crear con datos de ejemplo.

---

## 2. Arquitectura

```
                 ┌──────────────────────────────────────────┐
  Navegador ───▶ │  API GATEWAY  :8000                      │
 (Cliente/Admin) │  • sirve el frontend (HTML/CSS/JS)       │
                 │  • enruta /api/<servicio>/... al servicio│
                 │  • bloquea las rutas /interno            │
                 └──┬───────┬────────┬────────┬────────┬────┘
                    │       │        │        │        │
              ┌─────▼──┐ ┌──▼─────┐ ┌▼──────┐ ┌▼─────┐ ┌▼──────┐
              │Usuarios│ │Producto│ │Pedidos│ │Pagos │ │Envíos │
              │ :8001  │ │ :8002  │ │ :8003 │ │:8004 │ │ :8005 │
              └───┬────┘ └───┬────┘ └───┬───┘ └──┬───┘ └───┬───┘
              usuarios.db productos.db pedidos.db pagos.db envios.db
```

### Comunicación entre servicios (orquestación)

1. **Crear pedido.** *Pedidos* llama a *Productos* (`/productos/interno/reservar`) para validar precios y apartar el stock en una sola transacción.
2. **Pagar.** *Pagos* consulta el pedido a *Pedidos*, valida la tarjeta y simula al banco. Si se aprueba:
   - le pide a *Pedidos* que marque el pedido como `pagado`;
   - le pide a *Envíos* que genere la guía y el código de rastreo;
   - emite un **evento en tiempo real (SSE)** al cliente y al administrador.
3. **Avanzar el envío.** El admin cambia el estado en *Envíos*, y *Envíos* le avisa a *Pedidos* (`enviado` / `entregado`).
4. **Cancelar.** *Pedidos* le pide a *Productos* que libere el stock.

### Principios SOA aplicados

| Principio | Cómo se cumple |
|---|---|
| Contrato estandarizado | Cada servicio publica su contrato OpenAPI/Swagger en `/docs`. Los datos viajan como JSON por REST. |
| Bajo acoplamiento | Los servicios no comparten base de datos. Solo se comunican por HTTP. |
| Autonomía | Cada servicio es un proceso aparte. Si uno se cae, los demás siguen respondiendo, y el panel admin lo muestra en rojo. |
| Abstracción | El cliente solo conoce el Gateway (`/api/...`). Las rutas `/interno` quedan ocultas. |
| Reutilización | El mismo servicio atiende la tienda y el panel de administración. |
| Seguridad | JWT para usuarios (roles cliente/admin) y una clave interna `X-Servicio-Key` para las llamadas entre servicios. |

---

## 3. Contratos de cada servicio

### Servicio de Usuarios · :8001
| Método | Ruta | Quién |
|---|---|---|
| POST | `/usuarios/registro` | Público |
| POST | `/usuarios/login` | Público → devuelve JWT |
| GET/PUT | `/usuarios/perfil` | Cliente |
| GET | `/usuarios` | Admin |
| PUT/DELETE | `/usuarios/{id}` | Admin (rol, activar/desactivar, eliminar) |

### Servicio de Productos · :8002
| Método | Ruta | Quién |
|---|---|---|
| GET | `/productos?categoria=&forma=&q=&precio_max=` | Público |
| GET | `/productos/{id}` | Público |
| POST / PUT / DELETE | `/productos[/{id}]` | Admin (alta, modificación, baja) |
| POST | `/productos/interno/reservar` · `/liberar` | Solo servicios |

### Servicio de Pedidos · :8003
| Método | Ruta | Quién |
|---|---|---|
| POST | `/pedidos` | Cliente |
| GET | `/pedidos/mios` · `/pedidos/{id}` | Cliente |
| POST | `/pedidos/{id}/cancelar` | Cliente / Admin |
| GET | `/pedidos?estado=` · `/pedidos/estadisticas` | Admin |
| GET/PATCH | `/pedidos/interno/{id}[/estado]` | Solo servicios |

### Servicio de Pagos · :8004
| Método | Ruta | Quién |
|---|---|---|
| POST | `/pagos` | Cliente (procesa la tarjeta) |
| GET | `/pagos/mios` | Cliente |
| GET | `/pagos` | Admin |
| GET | `/pagos/eventos?token=` | Cliente / Admin, en tiempo real (Server-Sent Events) |

### Servicio de Envíos · :8005
| Método | Ruta | Quién |
|---|---|---|
| GET | `/envios/rastreo/{codigo}` | Público |
| GET | `/envios/pedido/{pedido_id}` | Cliente |
| GET | `/envios` · PATCH `/envios/{id}/estado` | Admin |
| POST | `/envios/interno` | Solo servicios (lo llama Pagos) |

---

## 4. Estructura del proyecto

```
lentes-soa/
├── iniciar.py            # arranca los 6 procesos
├── iniciar.bat           # atajo para Windows
├── requirements.txt
├── common/               # configuración, JWT y utilidades SQLite
├── gateway/main.py       # API Gateway + servidor del frontend
├── servicios/
│   ├── usuarios/main.py
│   ├── productos/main.py
│   ├── pedidos/main.py
│   ├── pagos/main.py
│   └── envios/main.py
└── frontend/
    ├── index.html        # tienda (catálogo, carrito, pago, pedidos, rastreo)
    ├── admin.html        # panel de control
    ├── css/estilos.css
    └── js/ (comun.js, tienda.js, admin.js)
```

## 5. Tecnologías
Python · FastAPI · Uvicorn · SQLite · httpx (comunicación entre servicios) · PyJWT · HTML/CSS/JavaScript sin frameworks · Server-Sent Events.

## 6. Guion sugerido para la demostración
1. Abre `/admin` en una ventana y la tienda en otra.
2. En la tienda, regístrate, agrega lentes al carrito y crea el pedido. Así se ve **Usuarios → Productos → Pedidos**.
3. Paga con `4000 0000 0000 0002`. Se ve el rechazo y el admin recibe el aviso al instante.
4. Paga con `4242 4242 4242 4242`. Se ve la aprobación, se genera la guía y el admin ve el pago en vivo (**Pagos → Pedidos → Envíos**).
5. En el admin, avanza el envío a "En tránsito" y luego a "Entregado". El cliente lo ve en *Mis pedidos* y en *Rastrear*.
6. Detén un servicio (por ejemplo, Envíos) y muestra que el resto sigue funcionando. El panel lo marca en rojo.
