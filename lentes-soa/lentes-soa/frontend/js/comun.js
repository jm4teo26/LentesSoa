// =====================================================================
//  Cliente del API Gateway + utilidades compartidas (tienda y admin)
// =====================================================================
const API = {
  token: () => localStorage.getItem("token"),
  usuario: () => JSON.parse(localStorage.getItem("usuario") || "null"),
  guardarSesion(token, usuario) {
    localStorage.setItem("token", token);
    localStorage.setItem("usuario", JSON.stringify(usuario));
  },
  cerrarSesion() {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
  },
  async pedir(metodo, ruta, cuerpo) {
    const headers = { "Content-Type": "application/json" };
    const t = this.token();
    if (t) headers.Authorization = "Bearer " + t;
    const r = await fetch("/api" + ruta, {
      method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    let datos = null;
    try { datos = await r.json(); } catch { /* sin cuerpo */ }
    if (!r.ok) {
      let msg = datos && datos.detail;
      if (Array.isArray(msg)) msg = "Revisa los datos: " + msg.map((e) => e.loc.slice(-1)[0]).join(", ");
      if (r.status === 401 && t) { this.cerrarSesion(); }
      throw new Error(msg || "Error " + r.status);
    }
    return datos;
  },
  get(r) { return this.pedir("GET", r); },
  post(r, b) { return this.pedir("POST", r, b || {}); },
  put(r, b) { return this.pedir("PUT", r, b); },
  patch(r, b) { return this.pedir("PATCH", r, b); },
  del(r) { return this.pedir("DELETE", r); },

  /** Conecta al stream de confirmaciones de pago en tiempo real (Servicio de Pagos). */
  tiempoReal(alRecibir) {
    const t = this.token();
    if (!t || !window.EventSource) return null;
    const es = new EventSource("/api/pagos/eventos?token=" + encodeURIComponent(t));
    es.onmessage = (e) => alRecibir(JSON.parse(e.data));
    return es;
  },
};

// ---------- Formato ----------
const dinero = (n) => Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const fecha = (s) => s ? new Date(s).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

const CATEGORIAS = { sol: "Lentes de sol", oftalmico: "Oftálmicos", deportivo: "Deportivos", lectura: "Lectura" };
const FORMAS = { redondo: "Redondo", cuadrado: "Cuadrado", aviador: "Aviador", "cat-eye": "Cat-eye", wayfarer: "Wayfarer", deportivo: "Envolvente" };

const ESTADOS_PEDIDO = {
  pendiente: ["Pendiente de pago", "ambar"], pagado: ["Pagado", "azul"], enviado: ["Enviado", "morado"],
  entregado: ["Entregado", "verde"], cancelado: ["Cancelado", "gris"],
};
const ESTADOS_ENVIO = {
  preparando: "Preparando", en_transito: "En tránsito", en_reparto: "En reparto", entregado: "Entregado",
};
function pildora(texto, color) { return `<span class="pildora ${color === "azul" ? "" : color}">${esc(texto)}</span>`; }
function pildoraPedido(estado) { const [t, c] = ESTADOS_PEDIDO[estado] || [estado, "gris"]; return pildora(t, c); }

// ---------- Toasts ----------
function toast(msg, tipo = "") {
  let caja = $("#toasts");
  if (!caja) { caja = document.createElement("div"); caja.id = "toasts"; document.body.appendChild(caja); }
  const t = document.createElement("div");
  t.className = "toast " + tipo;
  t.innerHTML = msg;
  caja.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

// ---------- Ilustración SVG de lentes (según forma y colores del producto) ----------
const FORMAS_SVG = {
  redondo: '<circle cx="55" cy="46" r="31"/>',
  cuadrado: '<rect x="20" y="20" width="70" height="52" rx="9"/>',
  wayfarer: '<path d="M16 20 H92 L86 64 Q84 72 76 72 H32 Q24 72 22 64 Z"/>',
  aviador: '<path d="M20 22 Q55 12 91 22 Q94 56 72 72 Q50 82 30 66 Q14 50 20 22 Z"/>',
  "cat-eye": '<path d="M8 16 Q50 18 91 26 Q92 60 64 70 Q36 76 24 58 Q18 44 8 16 Z"/>',
};

function lenteSVG(p, opciones = {}) {
  const marco = p.color_armazon || "#1f2937";
  const mica = p.color_mica || "#64748b";
  const id = "g" + Math.random().toString(36).slice(2, 8);
  const grueso = p.material === "Metal" ? 3.5 : 6;
  const defs = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${mica}" stop-opacity=".55"/><stop offset="1" stop-color="${mica}" stop-opacity=".9"/>
    </linearGradient></defs>`;
  const brillo = `<path d="M34 30 Q44 24 54 26" stroke="#fff" stroke-opacity=".7" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  let cuerpo;
  if (p.forma === "deportivo") {
    cuerpo = `<g fill="url(#${id})" stroke="${marco}" stroke-width="${grueso}" stroke-linejoin="round">
        <path d="M8 30 Q100 6 192 30 Q188 66 152 70 Q122 72 106 52 Q100 46 94 52 Q78 72 48 70 Q12 66 8 30 Z"/></g>
      <path d="M8 30 L0 26 M192 30 L200 26" stroke="${marco}" stroke-width="5" stroke-linecap="round"/>
      <path d="M40 28 Q60 20 80 22" stroke="#fff" stroke-opacity=".7" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  } else {
    const forma = FORMAS_SVG[p.forma] || FORMAS_SVG.redondo;
    const puente = p.forma === "aviador"
      ? `<path d="M90 30 Q100 24 110 30 M86 22 H114" stroke="${marco}" stroke-width="3.5" fill="none"/>`
      : `<path d="M88 36 Q100 26 112 36" stroke="${marco}" stroke-width="${grueso}" fill="none" stroke-linecap="round"/>`;
    cuerpo = `<g fill="url(#${id})" stroke="${marco}" stroke-width="${grueso}" stroke-linejoin="round">
        ${forma}<g transform="translate(200 0) scale(-1 1)">${forma}</g></g>
      ${puente}
      <path d="M18 30 L2 24 M182 30 L198 24" stroke="${marco}" stroke-width="5" stroke-linecap="round"/>
      ${brillo}<g transform="translate(90 0)">${brillo}</g>`;
  }
  return `<svg viewBox="-4 4 208 84" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(p.nombre || "Lentes")}" ${opciones.attrs || ""}>${defs}${cuerpo}</svg>`;
}

const LOGO_SVG = `<svg viewBox="0 0 48 24" fill="none" stroke="#38bdf8" stroke-width="3"><circle cx="12" cy="13" r="8"/><circle cx="36" cy="13" r="8"/><path d="M20 12 Q24 8 28 12"/></svg>`;
