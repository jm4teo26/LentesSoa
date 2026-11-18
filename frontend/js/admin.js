// =====================================================================
//  Panel de administración — supervisión de los 5 servicios
// =====================================================================
const u = API.usuario();
if (!u || u.rol !== "admin") {
  sessionStorage.removeItem("volver");
  location.href = "/#/login";
}
$("#logo").innerHTML = LOGO_SVG;
$("#admin-nombre").textContent = u ? u.nombre : "";
$("#salir").onclick = () => { API.cerrarSesion(); location.href = "/"; };
const principal = $("#principal");

// ---------- Eventos de pago en tiempo real ----------
const eventos = [];
API.tiempoReal((ev) => {
  eventos.unshift(ev);
  if (ev.tipo === "pago_aprobado") toast(`💳 <b>Nuevo pago aprobado</b><br>${esc(ev.usuario_nombre)} · Pedido #${ev.pedido_id} · ${dinero(ev.monto)}`, "ok");
  else toast(`⚠️ <b>Pago rechazado</b><br>${esc(ev.usuario_nombre)} · Pedido #${ev.pedido_id}: ${esc(ev.motivo)}`, "error");
  const sec = location.hash.slice(1) || "resumen";
  if (["resumen", "pagos", "pedidos", "envios"].includes(sec)) router();
});

const secciones = { resumen, productos, pedidos, pagos, envios, usuarios };
async function router() {
  const sec = location.hash.slice(1) || "resumen";
  $$(".lateral a[data-sec]").forEach((a) => a.classList.toggle("activo", a.dataset.sec === sec));
  try { await (secciones[sec] || resumen)(); }
  catch (e) { principal.innerHTML = `<div class="tarjeta pad vacio"><h2>Error</h2><p>${esc(e.message)}</p></div>`; }
}
window.addEventListener("hashchange", router);

function encabezado(titulo, sub, extra = "") {
  return `<header><div><div class="etiqueta" style="color:var(--azul);margin-bottom:4px">${sub}</div><h1>${titulo}</h1></div>${extra}</header>`;
}

// ---------- Modal ----------
function abrirModal(titulo, html) {
  $("#modal").innerHTML = `<div class="modal-fondo"><div class="modal"><header><h2 style="margin:0">${titulo}</h2>
    <button class="cerrar" id="cerrar-modal">×</button></header>${html}</div></div>`;
  $("#cerrar-modal").onclick = cerrarModal;
  $(".modal-fondo").onclick = (e) => { if (e.target.classList.contains("modal-fondo")) cerrarModal(); };
}
function cerrarModal() { $("#modal").innerHTML = ""; }

// ============ RESUMEN ============
async function resumen() {
  const [salud, stats, listaPagos, prods] = await Promise.all([
    API.get("/salud"), API.get("/pedidos/estadisticas"), API.get("/pagos"), API.get("/productos?todos=true"),
  ]);
  const aprobados = listaPagos.filter((p) => p.estado === "aprobado").length;
  const tasa = listaPagos.length ? Math.round((aprobados / listaPagos.length) * 100) : 0;
  const bajoStock = prods.filter((p) => p.stock < 10).sort((a, b) => a.stock - b.stock);
  const colores = { pendiente: "#d97706", pagado: "#2563eb", enviado: "#7c3aed", entregado: "#16a34a", cancelado: "#94a3b8" };
  const max = Math.max(1, ...Object.values(stats.por_estado));
  const recientes = eventos.length ? eventos : listaPagos.slice(0, 12).map((p) => ({
    tipo: p.estado === "aprobado" ? "pago_aprobado" : "pago_rechazado", usuario_nombre: p.usuario_nombre,
    pedido_id: p.pedido_id, monto: p.monto, motivo: p.motivo, fecha: p.creado, tarjeta: `${p.marca} •••• ${p.ultimos4}`,
  }));

  principal.innerHTML = encabezado("Resumen general", "Supervisión de la cadena de venta", '<span class="vivo">En vivo</span>') + `
    <div class="servicios-estado">${salud.map((s) => `<div class="tarjeta svc">
      <b><span class="punto ${s.ok ? "on" : "off"}"></span>${s.servicio}</b>
      <small>${s.url.replace("http://", "")}</small>
      <small>${s.ok ? s.ms + " ms" : "sin respuesta"} · <a href="${s.url}/docs" target="_blank">docs</a></small></div>`).join("")}</div>
    <div class="kpis">
      <div class="tarjeta kpi"><small>Ventas confirmadas</small><b>${dinero(stats.ventas)}</b></div>
      <div class="tarjeta kpi"><small>Pedidos totales</small><b>${stats.total}</b></div>
      <div class="tarjeta kpi"><small>Lentes vendidos</small><b>${stats.unidades}</b></div>
      <div class="tarjeta kpi"><small>Pagos aprobados</small><b>${tasa}%</b></div>
    </div>
    <div class="dos">
      <div class="tarjeta pad"><div style="display:flex;justify-content:space-between"><h3>Pagos en tiempo real</h3><span class="vivo">SSE</span></div>
        <div class="feed">${recientes.length ? recientes.map((e) => `<div class="ev">
          <div class="ic" style="background:${e.tipo === "pago_aprobado" ? "var(--verde)" : "var(--rojo)"}">${e.tipo === "pago_aprobado" ? "✓" : "✕"}</div>
          <div><b>${esc(e.usuario_nombre)}</b> ${e.tipo === "pago_aprobado" ? "pagó" : "intentó pagar"} ${dinero(e.monto)} · Pedido #${e.pedido_id}
            <br><small style="color:var(--suave)">${esc(e.tarjeta || "")} ${e.motivo ? "· " + esc(e.motivo) : ""} · ${fecha(e.fecha)}</small></div></div>`).join("")
          : '<p class="vacio">Aún no hay pagos. Cuando un cliente pague, aparecerá aquí al instante.</p>'}</div></div>
      <div>
        <div class="tarjeta pad" style="margin-bottom:20px"><h3>Pedidos por estado</h3><div class="barras">
          ${Object.entries(stats.por_estado).map(([k, n]) => `<div class="b"><span>${ESTADOS_PEDIDO[k][0].replace(" de pago", "")}</span>
            <div class="riel"><div class="relleno" style="width:${(n / max) * 100}%;background:${colores[k]}"></div></div><b>${n}</b></div>`).join("")}
        </div></div>
        <div class="tarjeta pad"><h3>Inventario bajo</h3>
          ${bajoStock.length ? bajoStock.map((p) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--borde)">
            <span>${esc(p.nombre)} <small style="color:var(--suave)">${esc(p.marca)}</small></span>${pildora(p.stock + " pzas", p.stock === 0 ? "rojo" : "ambar")}</div>`).join("")
            : '<p style="color:var(--suave)">Todo el inventario está en buen nivel.</p>'}
        </div>
      </div>
    </div>`;
}

// ============ PRODUCTOS ============
async function productos() {
  const lista = await API.get("/productos?todos=true");
  principal.innerHTML = encabezado("Productos", "Servicio de Productos · catálogo e inventario",
    '<button class="btn" id="nuevo">+ Nuevo producto</button>') + `
    <div class="tarjeta tabla"><table><thead><tr><th></th><th>Producto</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Estado</th><th></th></tr></thead><tbody>
    ${lista.map((p) => `<tr>
      <td><div class="mini-svg">${lenteSVG(p)}</div></td>
      <td><b>${esc(p.nombre)}</b><br><small style="color:var(--suave)">${esc(p.marca)} · ${FORMAS[p.forma]}</small></td>
      <td>${CATEGORIAS[p.categoria]}</td><td>${dinero(p.precio)}</td>
      <td>${pildora(p.stock, p.stock === 0 ? "rojo" : p.stock < 10 ? "ambar" : "verde")}</td>
      <td>${p.activo ? pildora("Publicado", "verde") : pildora("Oculto", "gris")}</td>
      <td style="white-space:nowrap"><button class="btn sec chico" data-editar="${p.id}">Editar</button>
        <button class="btn peligro chico" data-borrar="${p.id}">Eliminar</button></td></tr>`).join("")}
    </tbody></table></div>`;
  $("#nuevo").onclick = () => formProducto();
  $$("[data-editar]").forEach((b) => b.onclick = () => formProducto(lista.find((p) => p.id === +b.dataset.editar)));
  $$("[data-borrar]").forEach((b) => b.onclick = async () => {
    const p = lista.find((x) => x.id === +b.dataset.borrar);
    if (!confirm(`¿Eliminar "${p.nombre}" del catálogo? Esta acción no se puede deshacer.`)) return;
    try { await API.del("/productos/" + p.id); toast("Producto eliminado"); productos(); }
    catch (e) { toast(esc(e.message), "error"); }
  });
}

function formProducto(p) {
  const v = p || { nombre: "", marca: "Mirada", categoria: "sol", forma: "redondo", material: "Acetato", genero: "Unisex",
    color_armazon: "#1f2937", color_mica: "#475569", precio: 999, stock: 10, descripcion: "", activo: true };
  const opts = (obj, sel) => Object.entries(obj).map(([k, t]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${t}</option>`).join("");
  abrirModal(p ? "Editar producto" : "Nuevo producto", `
    <div class="vista-previa" id="previa">${lenteSVG(v)}</div>
    <form id="form-prod">
      <div class="fila"><div class="campo"><label>Nombre</label><input name="nombre" required value="${esc(v.nombre)}"></div>
        <div class="campo"><label>Marca</label><input name="marca" required value="${esc(v.marca)}"></div></div>
      <div class="fila tres"><div class="campo"><label>Categoría</label><select name="categoria">${opts(CATEGORIAS, v.categoria)}</select></div>
        <div class="campo"><label>Forma</label><select name="forma">${opts(FORMAS, v.forma)}</select></div>
        <div class="campo"><label>Material</label><select name="material">${opts({ Acetato: "Acetato", Metal: "Metal", "TR-90": "TR-90", Policarbonato: "Policarbonato" }, v.material)}</select></div></div>
      <div class="fila tres"><div class="campo"><label>Género</label><select name="genero">${opts({ Unisex: "Unisex", Hombre: "Hombre", Mujer: "Mujer" }, v.genero)}</select></div>
        <div class="campo"><label>Color armazón</label><input type="color" name="color_armazon" value="${v.color_armazon}"></div>
        <div class="campo"><label>Color mica</label><input type="color" name="color_mica" value="${v.color_mica}"></div></div>
      <div class="fila"><div class="campo"><label>Precio (MXN)</label><input name="precio" type="number" min="1" step="0.01" required value="${v.precio}"></div>
        <div class="campo"><label>Stock</label><input name="stock" type="number" min="0" required value="${v.stock}"></div></div>
      <div class="campo"><label>Descripción</label><textarea name="descripcion" rows="3">${esc(v.descripcion)}</textarea></div>
      <label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" name="activo" style="width:auto" ${v.activo ? "checked" : ""}> Publicado en la tienda</label>
      <p id="error-prod" style="color:var(--rojo)"></p>
      <button class="btn bloque">${p ? "Guardar cambios" : "Dar de alta"}</button>
    </form>`);
  const form = $("#form-prod");
  const leer = () => {
    const d = Object.fromEntries(new FormData(form));
    return { ...d, precio: +d.precio, stock: +d.stock, activo: form.activo.checked };
  };
  form.oninput = () => { $("#previa").innerHTML = lenteSVG(leer()); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      if (p) await API.put("/productos/" + p.id, leer()); else await API.post("/productos", leer());
      cerrarModal(); toast(p ? "Producto actualizado" : "Producto dado de alta", "ok"); productos();
    } catch (err) { $("#error-prod").textContent = err.message; }
  };
}

// ============ PEDIDOS ============
async function pedidos() {
  const filtro = sessionStorage.getItem("filtro-pedidos") || "";
  const lista = await API.get("/pedidos" + (filtro ? "?estado=" + filtro : ""));
  principal.innerHTML = encabezado("Pedidos de clientes", "Servicio de Pedidos",
    `<select id="filtro" style="width:auto"><option value="">Todos los estados</option>
      ${Object.entries(ESTADOS_PEDIDO).map(([k, [t]]) => `<option value="${k}" ${k === filtro ? "selected" : ""}>${t}</option>`).join("")}</select>`) + `
    <div class="tarjeta tabla"><table><thead><tr><th>#</th><th>Cliente</th><th>Productos</th><th>Total</th><th>Estado</th><th>Fecha</th><th></th></tr></thead><tbody>
    ${lista.length ? lista.map((p) => `<tr><td><b>#${p.id}</b></td>
      <td>${esc(p.usuario_nombre)}<br><small style="color:var(--suave)">${esc(p.usuario_email)}</small></td>
      <td>${p.items.map((i) => `${i.cantidad} × ${esc(i.nombre)}`).join("<br>")}</td>
      <td><b>${dinero(p.total)}</b></td><td>${pildoraPedido(p.estado)}</td><td><small>${fecha(p.creado)}</small></td>
      <td><button class="btn sec chico" data-ver="${p.id}">Detalle</button></td></tr>`).join("")
      : '<tr><td colspan="7" class="vacio">No hay pedidos.</td></tr>'}
    </tbody></table></div>`;
  $("#filtro").onchange = (e) => { sessionStorage.setItem("filtro-pedidos", e.target.value); pedidos(); };
  $$("[data-ver]").forEach((b) => b.onclick = async () => {
    const p = lista.find((x) => x.id === +b.dataset.ver);
    const envio = await API.get("/envios/pedido/" + p.id).catch(() => null);
    abrirModal(`Pedido #${p.id}`, `
      <p>${pildoraPedido(p.estado)} · Creado ${fecha(p.creado)} · Actualizado ${fecha(p.actualizado)}</p>
      <p><b>Cliente:</b> ${esc(p.usuario_nombre)} (${esc(p.usuario_email)})<br><b>Envío a:</b> ${esc(p.direccion)}</p>
      <table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>
        ${p.items.map((i) => `<tr><td>${esc(i.nombre)}</td><td>${i.cantidad}</td><td>${dinero(i.precio)}</td><td>${dinero(i.precio * i.cantidad)}</td></tr>`).join("")}
        <tr><td colspan="3" style="text-align:right"><b>Total</b></td><td><b>${dinero(p.total)}</b></td></tr></tbody></table>
      ${envio ? `<p style="margin-top:16px"><b>Guía:</b> ${esc(envio.codigo)} · ${ESTADOS_ENVIO[envio.estado]}</p>` : ""}
      ${p.estado === "pendiente" ? '<button class="btn peligro" id="cancelar-admin" style="margin-top:12px">Cancelar pedido y liberar inventario</button>' : ""}`);
    const c = $("#cancelar-admin");
    if (c) c.onclick = async () => {
      try { await API.post(`/pedidos/${p.id}/cancelar`); cerrarModal(); toast("Pedido cancelado"); pedidos(); }
      catch (e) { toast(esc(e.message), "error"); }
    };
  });
}

// ============ PAGOS ============
async function pagos() {
  const lista = await API.get("/pagos");
  const total = lista.filter((p) => p.estado === "aprobado").reduce((s, p) => s + p.monto, 0);
  principal.innerHTML = encabezado("Pagos", "Servicio de Pagos · verificación de transacciones",
    `<span class="vivo">Escuchando pagos</span>`) + `
    <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="tarjeta kpi"><small>Cobrado</small><b>${dinero(total)}</b></div>
      <div class="tarjeta kpi"><small>Aprobados</small><b>${lista.filter((p) => p.estado === "aprobado").length}</b></div>
      <div class="tarjeta kpi"><small>Rechazados</small><b>${lista.filter((p) => p.estado === "rechazado").length}</b></div>
    </div>
    <div class="tarjeta tabla"><table><thead><tr><th>#</th><th>Pedido</th><th>Cliente</th><th>Tarjeta</th><th>Monto</th><th>Resultado</th><th>Autorización</th><th>Fecha</th></tr></thead><tbody>
    ${lista.length ? lista.map((p) => `<tr><td>${p.id}</td><td>#${p.pedido_id}</td><td>${esc(p.usuario_nombre)}</td>
      <td>${esc(p.marca)} •••• ${esc(p.ultimos4)}<br><small style="color:var(--suave)">${esc(p.titular)}</small></td>
      <td><b>${dinero(p.monto)}</b></td>
      <td>${p.estado === "aprobado" ? pildora("Aprobado", "verde") : pildora("Rechazado", "rojo") + `<br><small style="color:var(--suave)">${esc(p.motivo)}</small>`}</td>
      <td><code>${esc(p.autorizacion || "—")}</code></td><td><small>${fecha(p.creado)}</small></td></tr>`).join("")
      : '<tr><td colspan="8" class="vacio">Aún no hay pagos.</td></tr>'}
    </tbody></table></div>`;
}

// ============ ENVÍOS ============
async function envios() {
  const lista = await API.get("/envios");
  const claves = Object.keys(ESTADOS_ENVIO);
  principal.innerHTML = encabezado("Envíos", "Servicio de Envíos · destino y estado de paquetes") + `
    <div class="tarjeta tabla"><table><thead><tr><th>Guía</th><th>Pedido</th><th>Cliente</th><th>Destino</th><th>Estado</th><th>Actualizar</th></tr></thead><tbody>
    ${lista.length ? lista.map((e) => {
      const idx = claves.indexOf(e.estado);
      const siguientes = claves.slice(idx + 1);
      return `<tr><td><code>${esc(e.codigo)}</code><br><small style="color:var(--suave)">${esc(e.paqueteria)}</small></td>
        <td>#${e.pedido_id}</td><td>${esc(e.usuario_nombre)}</td>
        <td style="max-width:260px"><small>${esc(e.direccion)}</small></td>
        <td>${pildora(ESTADOS_ENVIO[e.estado], e.estado === "entregado" ? "verde" : e.estado === "preparando" ? "ambar" : "morado")}<br>
          <small style="color:var(--suave)">${fecha(e.actualizado)}</small></td>
        <td>${siguientes.length ? `<select data-envio="${e.id}"><option value="">Avanzar a…</option>
          ${siguientes.map((k) => `<option value="${k}">${ESTADOS_ENVIO[k]}</option>`).join("")}</select>` : "✓ Completado"}</td></tr>`;
    }).join("") : '<tr><td colspan="6" class="vacio">Los envíos se crean automáticamente cuando un pago es aprobado.</td></tr>'}
    </tbody></table></div>`;
  $$("[data-envio]").forEach((s) => s.onchange = async () => {
    if (!s.value) return;
    try { await API.patch(`/envios/${s.dataset.envio}/estado`, { estado: s.value }); toast("Estado del envío actualizado", "ok"); envios(); }
    catch (e) { toast(esc(e.message), "error"); }
  });
}

// ============ USUARIOS ============
async function usuarios() {
  const lista = await API.get("/usuarios");
  principal.innerHTML = encabezado("Clientes", "Servicio de Usuarios · gestión de perfiles") + `
    <div class="tarjeta tabla"><table><thead><tr><th>#</th><th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Rol</th><th>Estado</th><th>Alta</th><th></th></tr></thead><tbody>
    ${lista.map((x) => `<tr><td>${x.id}</td><td><b>${esc(x.nombre)}</b></td><td>${esc(x.email)}</td><td>${esc(x.telefono || "—")}</td>
      <td><select data-rol="${x.id}" ${x.id === u.id ? "disabled" : ""}><option value="cliente" ${x.rol === "cliente" ? "selected" : ""}>Cliente</option>
        <option value="admin" ${x.rol === "admin" ? "selected" : ""}>Admin</option></select></td>
      <td>${x.activo ? pildora("Activo", "verde") : pildora("Desactivado", "gris")}</td><td><small>${fecha(x.creado)}</small></td>
      <td style="white-space:nowrap">${x.id === u.id ? "<small>(tú)</small>" : `
        <button class="btn sec chico" data-activo="${x.id}">${x.activo ? "Desactivar" : "Activar"}</button>
        <button class="btn peligro chico" data-borrar="${x.id}">Eliminar</button>`}</td></tr>`).join("")}
    </tbody></table></div>`;
  const actualizar = async (id, cambios, msg) => {
    try { await API.put("/usuarios/" + id, cambios); toast(msg, "ok"); usuarios(); }
    catch (e) { toast(esc(e.message), "error"); }
  };
  $$("[data-rol]").forEach((s) => s.onchange = () => actualizar(s.dataset.rol, { rol: s.value }, "Rol actualizado"));
  $$("[data-activo]").forEach((b) => b.onclick = () => {
    const x = lista.find((y) => y.id === +b.dataset.activo);
    actualizar(x.id, { activo: !x.activo }, x.activo ? "Cuenta desactivada" : "Cuenta activada");
  });
  $$("[data-borrar]").forEach((b) => b.onclick = async () => {
    if (!confirm("¿Eliminar esta cuenta?")) return;
    try { await API.del("/usuarios/" + b.dataset.borrar); toast("Cuenta eliminada"); usuarios(); }
    catch (e) { toast(esc(e.message), "error"); }
  });
}

if (u && u.rol === "admin") router();
