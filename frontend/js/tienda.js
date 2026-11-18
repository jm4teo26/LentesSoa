// =====================================================================
//  Tienda (área de cliente) — SPA con rutas por hash
// =====================================================================
const vista = $("#vista");
$("#logo").innerHTML = LOGO_SVG;

// ---------- Carrito (vive en el navegador hasta que se crea el pedido) ----------
const Carrito = {
  leer: () => JSON.parse(localStorage.getItem("carrito") || "[]"),
  guardar(items) { localStorage.setItem("carrito", JSON.stringify(items)); pintarEncabezado(); },
  agregar(p, cantidad) {
    const items = this.leer();
    const it = items.find((i) => i.id === p.id);
    if (it) it.cantidad = Math.min(it.cantidad + cantidad, p.stock);
    else items.push({ id: p.id, nombre: p.nombre, marca: p.marca, precio: p.precio, forma: p.forma, material: p.material,
      color_armazon: p.color_armazon, color_mica: p.color_mica, stock: p.stock, cantidad });
    this.guardar(items);
  },
  cambiar(id, delta) {
    const items = this.leer();
    const it = items.find((i) => i.id === id);
    if (!it) return;
    it.cantidad = Math.max(1, Math.min(it.cantidad + delta, it.stock));
    this.guardar(items);
  },
  quitar(id) { this.guardar(this.leer().filter((i) => i.id !== id)); },
  vaciar() { this.guardar([]); },
  total() { return this.leer().reduce((s, i) => s + i.precio * i.cantidad, 0); },
  unidades() { return this.leer().reduce((s, i) => s + i.cantidad, 0); },
};

// ---------- Encabezado ----------
function pintarEncabezado() {
  $("#num-carrito").textContent = Carrito.unidades();
  const u = API.usuario();
  $("#zona-sesion").innerHTML = u
    ? `<span style="color:#cbd5e1;font-size:.9rem;margin-right:6px">Hola, <b style="color:#fff">${esc(u.nombre.split(" ")[0])}</b></span>
       ${u.rol === "admin" ? '<a class="btn fantasma chico" href="/admin">Panel admin</a>' : ""}
       <button class="btn fantasma chico" id="btn-salir">Salir</button>`
    : `<a class="btn fantasma chico" href="#/login">Iniciar sesión</a>`;
  const salir = $("#btn-salir");
  if (salir) salir.onclick = () => { API.cerrarSesion(); conectarTiempoReal(); pintarEncabezado(); location.hash = "#/"; };
  const ruta = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  $$(".nav a").forEach((a) => a.classList.toggle("activo", a.dataset.ruta === ruta));
}

// ---------- Confirmaciones de pago en tiempo real ----------
let fuente = null;
function conectarTiempoReal() {
  if (fuente) { fuente.close(); fuente = null; }
  fuente = API.tiempoReal((ev) => {
    if (ev.tipo === "pago_aprobado") toast(`✅ <b>Pago aprobado</b><br>Pedido #${ev.pedido_id} · ${dinero(ev.monto)}<br>Guía: ${esc(ev.codigo_rastreo || "en proceso")}`, "ok");
    else toast(`❌ <b>Pago rechazado</b><br>Pedido #${ev.pedido_id}: ${esc(ev.motivo)}`, "error");
    if (location.hash.startsWith("#/pedidos")) router();
  });
}

// ---------- Router ----------
const rutas = {
  "": vistaInicio, catalogo: vistaCatalogo, producto: vistaProducto, carrito: vistaCarrito,
  checkout: vistaCheckout, pagar: vistaPagar, pedidos: vistaPedidos, rastreo: vistaRastreo,
  login: vistaLogin, registro: vistaRegistro,
};
async function router() {
  const [ruta, ...params] = location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
  pintarEncabezado();
  const fn = rutas[ruta] || vistaInicio;
  try { await fn(...params.map(decodeURIComponent)); }
  catch (e) { vista.innerHTML = `<div class="contenedor vacio"><h2>Algo salió mal</h2><p>${esc(e.message)}</p></div>`; }
}
window.addEventListener("hashchange", () => { router(); window.scrollTo(0, 0); });

function requiereSesion() {
  if (API.usuario()) return true;
  sessionStorage.setItem("volver", location.hash);
  location.hash = "#/login";
  return false;
}

function tarjetaProducto(p) {
  return `<article class="tarjeta producto" onclick="location.hash='#/producto/${p.id}'">
    <div class="foto">${lenteSVG(p)}</div>
    <div class="info">
      <span class="marca">${esc(p.marca)} · ${esc(FORMAS[p.forma])}</span>
      <h3>${esc(p.nombre)}</h3>
      <div>${pildora(CATEGORIAS[p.categoria], "azul")} ${p.stock === 0 ? pildora("Agotado", "rojo") : p.stock < 10 ? pildora("Últimas piezas", "ambar") : ""}</div>
      <div class="precio">${dinero(p.precio)}</div>
    </div>
  </article>`;
}

// ---------- Vistas ----------
async function vistaInicio() {
  const productos = await API.get("/productos");
  const destacado = productos.find((p) => p.forma === "aviador") || productos[0];
  vista.innerHTML = `
  <section class="heroe"><div class="brillo"></div>
    <div class="contenedor">
      <div>
        <div class="etiqueta">Colección 2026</div>
        <h1>Encuentra los lentes que van contigo.</h1>
        <p>Lentes de sol, oftálmicos, deportivos y de lectura. Paga con tarjeta y rastrea tu envío hasta la puerta de tu casa.</p>
        <a class="btn grande" href="#/catalogo">Ver catálogo</a>
        <a class="btn grande fantasma" href="#/rastreo" style="margin-left:8px">Rastrear pedido</a>
      </div>
      <div class="lentes-grande">${destacado ? lenteSVG(destacado) : ""}</div>
    </div>
  </section>
  <section class="seccion"><div class="contenedor">
    <div class="titulo-seccion"><div><div class="etiqueta">Categorías</div><h2>¿Qué estás buscando?</h2></div></div>
    <div class="categorias">
      ${Object.entries(CATEGORIAS).map(([k, v]) => {
        const ej = productos.find((p) => p.categoria === k) || {};
        return `<div class="tarjeta cat" onclick="location.hash='#/catalogo?categoria=${k}'">${lenteSVG(ej)}<h3>${v}</h3>
          <p>${productos.filter((p) => p.categoria === k).length} modelos</p></div>`;
      }).join("")}
    </div>
  </div></section>
  <section class="seccion" style="padding-top:0"><div class="contenedor">
    <div class="titulo-seccion"><div><div class="etiqueta">Destacados</div><h2>Lo más nuevo</h2></div>
      <a href="#/catalogo">Ver todo →</a></div>
    <div class="grid-productos">${productos.slice(0, 4).map(tarjetaProducto).join("")}</div>
  </div></section>`;
}

async function vistaCatalogo() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  vista.innerHTML = `<section class="seccion"><div class="contenedor">
    <div class="titulo-seccion"><div><div class="etiqueta">Catálogo</div><h2>Todos los lentes</h2></div><span id="conteo" style="color:var(--suave)"></span></div>
    <div class="catalogo">
      <aside class="tarjeta filtros">
        <h3>Filtrar</h3>
        <div class="campo"><label>Buscar</label><input id="f-q" placeholder="Nombre o marca"></div>
        <div class="campo"><label>Categoría</label><select id="f-cat"><option value="">Todas</option>
          ${Object.entries(CATEGORIAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <div class="campo"><label>Forma</label><select id="f-forma"><option value="">Todas</option>
          ${Object.entries(FORMAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <div class="campo"><label>Precio máximo: <span id="v-precio"></span></label><input id="f-precio" type="range" min="500" max="2500" step="50" value="2500"></div>
        <button class="btn sec bloque chico" id="f-limpiar">Limpiar filtros</button>
      </aside>
      <div class="grid-productos" id="grid"></div>
    </div></div></section>`;
  $("#f-cat").value = qs.get("categoria") || "";
  const cargar = async () => {
    $("#v-precio").textContent = dinero($("#f-precio").value);
    const p = new URLSearchParams();
    if ($("#f-q").value) p.set("q", $("#f-q").value);
    if ($("#f-cat").value) p.set("categoria", $("#f-cat").value);
    if ($("#f-forma").value) p.set("forma", $("#f-forma").value);
    p.set("precio_max", $("#f-precio").value);
    const productos = await API.get("/productos?" + p);
    $("#conteo").textContent = productos.length + " modelos";
    $("#grid").innerHTML = productos.length ? productos.map(tarjetaProducto).join("")
      : `<div class="vacio" style="grid-column:1/-1">No hay lentes con esos filtros.</div>`;
  };
  let espera;
  $("#f-q").oninput = () => { clearTimeout(espera); espera = setTimeout(cargar, 250); };
  ["#f-cat", "#f-forma", "#f-precio"].forEach((s) => $(s).oninput = cargar);
  $("#f-limpiar").onclick = () => { $("#f-q").value = ""; $("#f-cat").value = ""; $("#f-forma").value = ""; $("#f-precio").value = 2500; cargar(); };
  await cargar();
}

async function vistaProducto(id) {
  const p = await API.get("/productos/" + id);
  let cant = 1;
  vista.innerHTML = `<section class="seccion"><div class="contenedor">
    <a href="#/catalogo">← Volver al catálogo</a>
    <div class="detalle" style="margin-top:18px">
      <div class="foto">${lenteSVG(p)}</div>
      <div>
        <span class="pildora">${CATEGORIAS[p.categoria]}</span>
        <h1 style="font-size:2.3rem;margin-top:10px">${esc(p.nombre)}</h1>
        <div style="color:var(--suave);font-weight:600">${esc(p.marca)}</div>
        <div style="font-size:2rem;font-weight:800;margin:14px 0">${dinero(p.precio)}</div>
        <p style="color:#334155">${esc(p.descripcion)}</p>
        <div class="specs">
          <div><small>Forma</small>${FORMAS[p.forma]}</div><div><small>Material</small>${esc(p.material)}</div>
          <div><small>Género</small>${esc(p.genero)}</div><div><small>Disponibles</small>${p.stock} piezas</div>
        </div>
        ${p.stock > 0 ? `<div style="display:flex;gap:12px;align-items:center">
          <div class="cantidad"><button id="menos">−</button><span id="cant">1</span><button id="mas">+</button></div>
          <button class="btn grande" id="agregar" style="flex:1">Agregar al carrito</button></div>`
        : `<div class="pildora rojo" style="font-size:.9rem;padding:8px 14px">Agotado por ahora</div>`}
      </div>
    </div></div></section>`;
  if (p.stock > 0) {
    $("#menos").onclick = () => { cant = Math.max(1, cant - 1); $("#cant").textContent = cant; };
    $("#mas").onclick = () => { cant = Math.min(p.stock, cant + 1); $("#cant").textContent = cant; };
    $("#agregar").onclick = () => { Carrito.agregar(p, cant); toast(`🛒 ${esc(p.nombre)} agregado al carrito`, "ok"); };
  }
}

function vistaCarrito() {
  const items = Carrito.leer();
  if (!items.length) {
    vista.innerHTML = `<div class="contenedor vacio"><h2>Tu carrito está vacío</h2><p>Explora el catálogo y elige tus lentes.</p><a class="btn" href="#/catalogo">Ir al catálogo</a></div>`;
    return;
  }
  const envio = 0;
  vista.innerHTML = `<section class="seccion"><div class="contenedor">
    <h2 style="font-size:1.8rem;margin-bottom:20px">Carrito</h2>
    <div class="dos-col">
      <div class="tarjeta pad">${items.map((i) => `
        <div class="linea">
          <div class="mini">${lenteSVG(i)}</div>
          <div class="nombre"><b>${esc(i.nombre)}</b><br><small style="color:var(--suave)">${esc(i.marca)} · ${dinero(i.precio)} c/u</small></div>
          <div class="cantidad"><button data-menos="${i.id}">−</button><span>${i.cantidad}</span><button data-mas="${i.id}">+</button></div>
          <b style="width:110px;text-align:right">${dinero(i.precio * i.cantidad)}</b>
          <button class="btn peligro chico" data-quitar="${i.id}">Quitar</button>
        </div>`).join("")}
      </div>
      <aside class="tarjeta pad resumen">
        <h3>Resumen</h3>
        <div class="renglon"><span>Productos (${Carrito.unidades()})</span><span>${dinero(Carrito.total())}</span></div>
        <div class="renglon"><span>Envío</span><span>${envio ? dinero(envio) : "Gratis"}</span></div>
        <div class="renglon total"><span>Total</span><span>${dinero(Carrito.total() + envio)}</span></div>
        <a class="btn bloque grande" href="#/checkout" style="margin-top:16px">Continuar con la compra</a>
      </aside>
    </div></div></section>`;
  $$("[data-menos]").forEach((b) => b.onclick = () => { Carrito.cambiar(+b.dataset.menos, -1); vistaCarrito(); });
  $$("[data-mas]").forEach((b) => b.onclick = () => { Carrito.cambiar(+b.dataset.mas, 1); vistaCarrito(); });
  $$("[data-quitar]").forEach((b) => b.onclick = () => { Carrito.quitar(+b.dataset.quitar); vistaCarrito(); });
}

function vistaCheckout() {
  if (!requiereSesion()) return;
  const items = Carrito.leer();
  if (!items.length) { location.hash = "#/carrito"; return; }
  const u = API.usuario();
  vista.innerHTML = `<section class="seccion"><div class="contenedor">
    <h2 style="font-size:1.8rem;margin-bottom:20px">Dirección de envío</h2>
    <div class="dos-col">
      <form class="tarjeta pad" id="form-dir">
        <div class="campo"><label>Calle y número</label><input name="calle" required placeholder="Av. Insurgentes 123"></div>
        <div class="fila"><div class="campo"><label>Colonia</label><input name="colonia" required></div>
          <div class="campo"><label>Código postal</label><input name="cp" required pattern="\\d{5}" maxlength="5" placeholder="81000"></div></div>
        <div class="fila"><div class="campo"><label>Ciudad</label><input name="ciudad" required value="Guasave"></div>
          <div class="campo"><label>Estado</label><input name="estado" required value="Sinaloa"></div></div>
        <div class="campo"><label>Teléfono (10 dígitos)</label><input name="telefono" required pattern="\\d{10}" maxlength="10" value="${esc(u.telefono || "")}"></div>
        <p id="error-dir" style="color:var(--rojo)"></p>
        <button class="btn grande bloque" id="btn-crear">Crear pedido y continuar al pago</button>
      </form>
      <aside class="tarjeta pad resumen">
        <h3>Tu pedido</h3>
        ${items.map((i) => `<div class="renglon"><span>${i.cantidad} × ${esc(i.nombre)}</span><span>${dinero(i.precio * i.cantidad)}</span></div>`).join("")}
        <div class="renglon total"><span>Total</span><span>${dinero(Carrito.total())}</span></div>
      </aside>
    </div></div></section>`;
  $("#form-dir").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#btn-crear"); btn.disabled = true; btn.textContent = "Reservando inventario…";
    try {
      const direccion = Object.fromEntries(new FormData(e.target));
      const pedido = await API.post("/pedidos", { items: items.map((i) => ({ producto_id: i.id, cantidad: i.cantidad })), direccion });
      Carrito.vaciar();
      location.hash = "#/pagar/" + pedido.id;
    } catch (err) {
      $("#error-dir").textContent = err.message;
      btn.disabled = false; btn.textContent = "Crear pedido y continuar al pago";
    }
  };
}

async function vistaPagar(id) {
  if (!requiereSesion()) return;
  const pedido = await API.get("/pedidos/" + id);
  if (pedido.estado !== "pendiente") {
    vista.innerHTML = `<div class="contenedor vacio"><h2>El pedido #${pedido.id} ya está ${ESTADOS_PEDIDO[pedido.estado][0].toLowerCase()}</h2><a class="btn" href="#/pedidos">Ver mis pedidos</a></div>`;
    return;
  }
  vista.innerHTML = `<section class="seccion"><div class="contenedor">
    <h2 style="font-size:1.8rem;margin-bottom:20px">Pago con tarjeta · Pedido #${pedido.id}</h2>
    <div class="dos-col">
      <div class="tarjeta pad" id="zona-pago"></div>
      <aside class="tarjeta pad resumen">
        <h3>Resumen</h3>
        ${pedido.items.map((i) => `<div class="renglon"><span>${i.cantidad} × ${esc(i.nombre)}</span><span>${dinero(i.precio * i.cantidad)}</span></div>`).join("")}
        <div class="renglon total"><span>Total a pagar</span><span>${dinero(pedido.total)}</span></div>
        <p style="font-size:.85rem;color:var(--suave);margin-top:14px">Enviar a: ${esc(pedido.direccion)}</p>
      </aside>
    </div></div></section>`;
  formularioPago(pedido);
}

function formularioPago(pedido, errorPrevio = "") {
  const zona = $("#zona-pago");
  zona.innerHTML = `
    <div class="tarjeta-credito"><div style="display:flex;justify-content:space-between"><div class="chip"></div><b id="tc-marca">VISA</b></div>
      <div class="num" id="tc-num">•••• •••• •••• ••••</div>
      <div class="pie"><span id="tc-nombre">NOMBRE DEL TITULAR</span><span id="tc-exp">MM/AA</span></div></div>
    <form id="form-pago">
      <div class="campo"><label>Número de tarjeta</label><input name="numero" id="in-num" required inputmode="numeric" maxlength="19" placeholder="4242 4242 4242 4242" autocomplete="cc-number"></div>
      <div class="campo"><label>Nombre del titular</label><input name="titular" id="in-nombre" required value="${esc(API.usuario().nombre)}"></div>
      <div class="fila"><div class="campo"><label>Vencimiento</label><input name="expiracion" id="in-exp" required maxlength="5" placeholder="MM/AA"></div>
        <div class="campo"><label>CVV</label><input name="cvv" required maxlength="4" inputmode="numeric" placeholder="123"></div></div>
      <p id="error-pago" style="color:var(--rojo)">${esc(errorPrevio)}</p>
      <button class="btn grande bloque">Pagar ${dinero(pedido.total)}</button>
      <div class="ayuda-tarjetas" style="margin-top:14px">
        <b>Tarjetas de prueba</b> (pasarela simulada; haz clic para usarlas):<br>
        <code data-tc="4242 4242 4242 4242">4242 4242 4242 4242</code> aprobada ·
        <code data-tc="4000 0000 0000 0002">4000 0000 0000 0002</code> fondos insuficientes ·
        <code data-tc="4000 0000 0000 0069">4000 0000 0000 0069</code> tarjeta reportada
      </div>
    </form>`;
  const num = $("#in-num"), exp = $("#in-exp");
  const actualizar = () => {
    const d = num.value.replace(/\D/g, "");
    $("#tc-num").textContent = (d + "•".repeat(Math.max(0, 16 - d.length))).replace(/(.{4})/g, "$1 ").trim();
    $("#tc-marca").textContent = d.startsWith("4") ? "VISA" : /^5[1-5]/.test(d) ? "MASTERCARD" : d.startsWith("3") ? "AMEX" : "";
    $("#tc-nombre").textContent = $("#in-nombre").value.toUpperCase() || "NOMBRE DEL TITULAR";
    $("#tc-exp").textContent = exp.value || "MM/AA";
  };
  num.oninput = () => { num.value = num.value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})(?=.)/g, "$1 "); actualizar(); };
  exp.oninput = () => { let v = exp.value.replace(/\D/g, "").slice(0, 4); if (v.length > 2) v = v.slice(0, 2) + "/" + v.slice(2); exp.value = v; actualizar(); };
  $("#in-nombre").oninput = actualizar;
  $$("[data-tc]").forEach((c) => c.onclick = () => {
    num.value = c.dataset.tc; exp.value = "12/" + String(new Date().getFullYear() + 2).slice(2);
    $("[name=cvv]").value = "123"; actualizar();
  });
  actualizar();

  $("#form-pago").onsubmit = async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.target));
    zona.innerHTML = `<div class="procesando"><div class="giro"></div><h3>Procesando pago…</h3>
      <p style="color:var(--suave)">Conectando con el banco emisor. No cierres esta ventana.</p></div>`;
    try {
      const r = await API.post("/pagos", { pedido_id: pedido.id, ...datos });
      if (r.estado === "aprobado") {
        zona.innerHTML = `<div class="resultado"><div class="icono ok">✓</div><h2>¡Pago aprobado!</h2>
          <p style="color:var(--suave)">${esc(r.tarjeta)} · Autorización <b>${esc(r.autorizacion)}</b></p>
          <p>Tu código de rastreo es:</p><div class="codigo-rastreo">${esc(r.codigo_rastreo || "Generándose…")}</div>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:18px">
            ${r.codigo_rastreo ? `<a class="btn" href="#/rastreo/${encodeURIComponent(r.codigo_rastreo)}">Rastrear envío</a>` : ""}
            <a class="btn sec" href="#/pedidos">Mis pedidos</a></div></div>`;
      } else {
        zona.innerHTML = `<div class="resultado"><div class="icono mal">✕</div><h2>Pago rechazado</h2>
          <p style="color:var(--suave)">${esc(r.tarjeta)} · ${esc(r.motivo)}</p>
          <p>Tu pedido sigue reservado. Puedes intentar con otra tarjeta.</p>
          <button class="btn" id="reintentar">Intentar de nuevo</button></div>`;
        $("#reintentar").onclick = () => formularioPago(pedido);
      }
    } catch (err) {
      formularioPago(pedido, err.message);
    }
  };
}

function pasosEnvio(estado) {
  const claves = Object.keys(ESTADOS_ENVIO);
  const idx = claves.indexOf(estado);
  return `<div class="pasos"><div class="barra-prog" style="width:${(idx / (claves.length - 1)) * 88}%"></div>
    ${claves.map((k, i) => `<div class="paso ${i <= idx ? "hecho" : ""}"><div class="punto">${i <= idx ? "✓" : i + 1}</div>${ESTADOS_ENVIO[k]}</div>`).join("")}</div>`;
}

async function vistaPedidos() {
  if (!requiereSesion()) return;
  const pedidos = await API.get("/pedidos/mios");
  if (!pedidos.length) {
    vista.innerHTML = `<div class="contenedor vacio"><h2>Aún no tienes pedidos</h2><a class="btn" href="#/catalogo">Ir al catálogo</a></div>`;
    return;
  }
  const envios = await Promise.all(pedidos.map((p) =>
    ["pagado", "enviado", "entregado"].includes(p.estado) ? API.get("/envios/pedido/" + p.id).catch(() => null) : null));
  vista.innerHTML = `<section class="seccion"><div class="contenedor" style="max-width:900px">
    <h2 style="font-size:1.8rem;margin-bottom:20px">Mis pedidos</h2>
    ${pedidos.map((p, k) => {
      const e = envios[k];
      return `<div class="tarjeta pedido">
        <div class="cab"><div><b style="font-size:1.1rem">Pedido #${p.id}</b> <small style="color:var(--suave)">· ${fecha(p.creado)}</small></div>
          <div>${pildoraPedido(p.estado)} <b style="margin-left:8px">${dinero(p.total)}</b></div></div>
        <div class="items">${p.items.map((i) => `${i.cantidad} × ${esc(i.nombre)}`).join(" · ")}</div>
        ${e ? `<div style="font-size:.9rem">Guía <b>${esc(e.codigo)}</b> · ${esc(e.paqueteria)}</div>${pasosEnvio(e.estado)}` : ""}
        <div class="botones">
          ${p.estado === "pendiente" ? `<a class="btn chico" href="#/pagar/${p.id}">Pagar ahora</a><button class="btn peligro chico" data-cancelar="${p.id}">Cancelar pedido</button>` : ""}
          ${e ? `<a class="btn sec chico" href="#/rastreo/${encodeURIComponent(e.codigo)}">Ver detalle del envío</a>` : ""}
        </div></div>`;
    }).join("")}
  </div></section>`;
  $$("[data-cancelar]").forEach((b) => b.onclick = async () => {
    if (!confirm("¿Cancelar este pedido? El inventario se liberará.")) return;
    try { await API.post(`/pedidos/${b.dataset.cancelar}/cancelar`); toast("Pedido cancelado"); vistaPedidos(); }
    catch (err) { toast(esc(err.message), "error"); }
  });
}

async function vistaRastreo(codigo = "") {
  vista.innerHTML = `<section class="seccion"><div class="contenedor" style="max-width:780px">
    <div class="etiqueta" style="color:var(--azul)">Servicio de envíos</div>
    <h2 style="font-size:1.8rem">Rastrea tu paquete</h2>
    <form id="form-rastreo" style="display:flex;gap:10px;margin:18px 0 24px">
      <input id="in-codigo" placeholder="Ej. MRD-1A2B3C4D" value="${esc(codigo)}" required style="font-family:ui-monospace,monospace;text-transform:uppercase">
      <button class="btn">Rastrear</button></form>
    <div id="res-rastreo"></div></div></section>`;
  $("#form-rastreo").onsubmit = (e) => { e.preventDefault(); location.hash = "#/rastreo/" + encodeURIComponent($("#in-codigo").value.trim()); };
  if (!codigo) return;
  try {
    const e = await API.get("/envios/rastreo/" + encodeURIComponent(codigo));
    $("#res-rastreo").innerHTML = `<div class="tarjeta pad">
      <div class="cab" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div><div class="codigo-rastreo" style="margin:0">${esc(e.codigo)}</div></div>
        <div style="text-align:right;color:var(--suave);font-size:.9rem">${esc(e.paqueteria)} · Pedido #${e.pedido_id}<br>Destino: ${esc(e.destino)}</div></div>
      ${pasosEnvio(e.estado)}
      <ul class="historial">${[...e.historial].reverse().map((h) => `<li><b>${ESTADOS_ENVIO[h.estado]}</b> — ${esc(h.nota)}<br><small>${fecha(h.fecha)}</small></li>`).join("")}</ul>
    </div>`;
  } catch (err) {
    $("#res-rastreo").innerHTML = `<div class="tarjeta pad vacio">${esc(err.message)}</div>`;
  }
}

function despuesDeEntrar(r) {
  API.guardarSesion(r.token, r.usuario);
  conectarTiempoReal();
  if (r.usuario.rol === "admin" && !sessionStorage.getItem("volver")) { location.href = "/admin"; return; }
  location.hash = sessionStorage.getItem("volver") || "#/";
  sessionStorage.removeItem("volver");
}

function vistaLogin() {
  vista.innerHTML = `<div class="contenedor"><form class="tarjeta pad auth" id="form-login">
    <h2>Iniciar sesión</h2><p style="color:var(--suave)">Accede para comprar y ver tus pedidos.</p>
    <div class="campo"><label>Correo</label><input name="email" type="email" required autocomplete="email"></div>
    <div class="campo"><label>Contraseña</label><input name="password" type="password" required autocomplete="current-password"></div>
    <p id="error-login" style="color:var(--rojo)"></p>
    <button class="btn bloque grande">Entrar</button>
    <p style="text-align:center">¿No tienes cuenta? <a href="#/registro">Regístrate</a></p>
    <div class="demo-cuentas"><b>Cuentas de prueba</b><br>Cliente: cliente@mirada.com / cliente123<br>Admin: admin@mirada.com / admin123</div>
  </form></div>`;
  $("#form-login").onsubmit = async (e) => {
    e.preventDefault();
    try { despuesDeEntrar(await API.post("/usuarios/login", Object.fromEntries(new FormData(e.target)))); }
    catch (err) { $("#error-login").textContent = err.message; }
  };
}

function vistaRegistro() {
  vista.innerHTML = `<div class="contenedor"><form class="tarjeta pad auth" id="form-reg">
    <h2>Crear cuenta</h2><p style="color:var(--suave)">Regístrate para comprar tus lentes.</p>
    <div class="campo"><label>Nombre completo</label><input name="nombre" required minlength="2"></div>
    <div class="campo"><label>Correo</label><input name="email" type="email" required></div>
    <div class="campo"><label>Teléfono</label><input name="telefono" maxlength="10" placeholder="10 dígitos"></div>
    <div class="campo"><label>Contraseña (mínimo 6)</label><input name="password" type="password" required minlength="6"></div>
    <p id="error-reg" style="color:var(--rojo)"></p>
    <button class="btn bloque grande">Crear cuenta</button>
    <p style="text-align:center">¿Ya tienes cuenta? <a href="#/login">Inicia sesión</a></p>
  </form></div>`;
  $("#form-reg").onsubmit = async (e) => {
    e.preventDefault();
    try { despuesDeEntrar(await API.post("/usuarios/registro", Object.fromEntries(new FormData(e.target)))); }
    catch (err) { $("#error-reg").textContent = err.message; }
  };
}

conectarTiempoReal();
router();
