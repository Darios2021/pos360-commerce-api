// src/controllers/contenidos.controller.js
//
// Gestión de contenidos: puente entre el admin de POS 360 y el servicio de
// videos (productos/contenido, https://contenido.cingulado.org).
//
// La clave del servicio vive SOLO en el servidor (CONTENIDO_CLAVE): el navegador
// habla con /api/v1/admin/contenidos y esta API la agrega al reenviar. Así el
// personal del comercio usa la pantalla sin ver nunca la credencial.
//
//   CONTENIDO_URL    base del servicio (https://contenido.cingulado.org)
//   CONTENIDO_CLAVE  clave del sistema "sjt" en el servicio

const BASE = () => String(process.env.CONTENIDO_URL || "").replace(/\/+$/, "");
const CLAVE = () => String(process.env.CONTENIDO_CLAVE || "");

function noConfigurado(res) {
  return res.status(503).json({ ok: false, code: "CONTENIDOS_NO_CONFIGURADO", message: "Falta configurar el servicio de contenidos." });
}

// Quién hace la acción, para la auditoría del servicio (altas y bajas de videos).
const usuarioDe = (req) => String(req?.user?.email || req?.user?.username || req?.user?.sub || "").slice(0, 80);

// Reenvía al servicio y devuelve su respuesta tal cual (estado y cuerpo).
async function reenviar(req, res, metodo, ruta, cuerpo) {
  if (!BASE() || !CLAVE()) return noConfigurado(res);
  let r;
  try {
    r = await fetch(`${BASE()}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${CLAVE()}`, "Content-Type": "application/json", "X-Usuario": usuarioDe(req) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    return res.status(502).json({ ok: false, code: "CONTENIDOS_SIN_RESPUESTA", message: "El servicio de contenidos no respondió." });
  }
  if (r.status === 204) return res.status(204).end();
  const texto = await r.text();
  res.status(r.status).type(r.headers.get("content-type") || "application/json").send(texto);
}

// Sólo administradores: crear videos y publicarlos en redes es una decisión de marca.
function soloAdmin(req, res, next) {
  const roles = req.access?.roles || [];
  if (req.access?.is_super_admin || roles.includes("admin") || roles.includes("super_admin")) return next();
  return res.status(403).json({ ok: false, code: "FORBIDDEN", message: "Sólo administradores." });
}

const q = (req, claves) => {
  const p = new URLSearchParams();
  for (const k of claves) if (req.query[k] != null && req.query[k] !== "") p.set(k, String(req.query[k]));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const id = (req) => encodeURIComponent(String(req.params.id || "").replace(/[^a-z0-9]/gi, ""));

// Redes conectadas (Meta) de la cuenta del comercio. La cuenta sale de /fuente
// del servicio; los tokens van directo al servicio, que los guarda cifrados, y
// nunca vuelven: GET sólo dice qué destinos están conectados y si hay ensayo.
let cuentaCache = { valor: "", vence: 0 };
async function cuentaDelComercio() {
  if (cuentaCache.valor && Date.now() < cuentaCache.vence) return cuentaCache.valor;
  const r = await fetch(`${BASE()}/fuente`, { headers: { Authorization: `Bearer ${CLAVE()}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`fuente ${r.status}`);
  const f = await r.json();
  cuentaCache = { valor: String(f?.cuenta || ""), vence: Date.now() + 10 * 60 * 1000 };
  return cuentaCache.valor;
}
async function redes(req, res, metodo, cuerpo) {
  if (!BASE() || !CLAVE()) return noConfigurado(res);
  let cuenta;
  try { cuenta = await cuentaDelComercio(); } catch {
    return res.status(502).json({ ok: false, code: "CONTENIDOS_SIN_RESPUESTA", message: "El servicio de contenidos no respondió." });
  }
  if (!cuenta) return res.status(409).json({ ok: false, code: "CONTENIDOS_SIN_CUENTA", message: "El servicio no informa la cuenta del comercio." });
  return reenviar(req, res, metodo, `/cuentas/${encodeURIComponent(cuenta)}/meta`, cuerpo);
}
// Sólo se reenvían las llaves que entiende el servicio.
function credenciales(body) {
  const b = body || {};
  const par = (o, k1) => (o && typeof o === "object" ? { [k1]: String(o[k1] || "").trim(), token: String(o.token || "").trim() } : undefined);
  const out = {};
  if (typeof b.ensayo === "boolean") out.ensayo = b.ensayo;
  if (b.instagram) out.instagram = par(b.instagram, "ig_usuario_id");
  if (b.facebook) out.facebook = par(b.facebook, "pagina_id");
  if (b.whatsapp) out.whatsapp = par(b.whatsapp, "numero_id");
  return out;
}
// Videos del mes del comercio y su tope ({ limite, usados, quedan, nombreMes }).
// El tope lo fija la plataforma en el servicio; al llegar, POST /piezas da 429.
async function cupo(req, res) {
  if (!BASE() || !CLAVE()) return noConfigurado(res);
  let cuenta;
  try { cuenta = await cuentaDelComercio(); } catch {
    return res.status(502).json({ ok: false, code: "CONTENIDOS_SIN_RESPUESTA", message: "El servicio de contenidos no respondió." });
  }
  if (!cuenta) return res.status(409).json({ ok: false, code: "CONTENIDOS_SIN_CUENTA", message: "El servicio no informa la cuenta del comercio." });
  return reenviar(req, res, "GET", `/cupo?cuenta=${encodeURIComponent(cuenta)}`);
}
// Las muestras son públicas en el servicio: se devuelven con la URL absoluta
// para que el navegador las reproduzca directo, sin clave ni proxy.
const absoluta = (m) => (typeof m === "string" && m.startsWith("/") ? `${BASE()}${m}` : m || null);
const conMuestra = (l) => (Array.isArray(l) ? l.map((x) => ({ ...x, muestra: absoluta(x.muestra) })) : l);
// Mapa del sonido de siempre por cinemática y momento: { cartel: { apertura: { nombre, muestra, sinLogo } } }.
function clasicoAbsoluto(c) {
  if (!c || typeof c !== "object") return undefined;
  const out = {};
  for (const [cin, momentos] of Object.entries(c)) {
    out[cin] = {};
    for (const [m, v] of Object.entries(momentos || {})) {
      out[cin][m] = v && typeof v === "object"
        ? { ...v, muestra: absoluta(v.muestra), ...(v.sinLogo ? { sinLogo: { ...v.sinLogo, muestra: absoluta(v.sinLogo.muestra) } } : {}) }
        : v ?? null;
    }
  }
  return out;
}

// Catálogo de voces. La muestra es pública en el servicio: se devuelve con la
// URL absoluta para que el navegador la reproduzca directo, sin clave ni proxy.
async function voces(req, res) {
  if (!BASE() || !CLAVE()) return noConfigurado(res);
  let r;
  try {
    r = await fetch(`${BASE()}/voces`, { headers: { Authorization: `Bearer ${CLAVE()}` }, signal: AbortSignal.timeout(15000) });
  } catch {
    return res.status(502).json({ ok: false, code: "CONTENIDOS_SIN_RESPUESTA", message: "El servicio de contenidos no respondió." });
  }
  const texto = await r.text();
  if (!r.ok) return res.status(r.status).type(r.headers.get("content-type") || "application/json").send(texto);
  let lista;
  try { lista = JSON.parse(texto); } catch { lista = null; }
  if (!Array.isArray(lista)) return res.status(502).json({ ok: false, code: "CONTENIDOS_RESPUESTA_INVALIDA", message: "El servicio de contenidos devolvió un catálogo inválido." });
  return res.json(conMuestra(lista));
}

// Catálogo de sonidos (efectos, filtro y músicas), el mapa del estilo viral y,
// cuando el servicio los publica, los paquetes y el mapa clásico.
async function sonidos(req, res) {
  if (!BASE() || !CLAVE()) return noConfigurado(res);
  let r;
  try {
    r = await fetch(`${BASE()}/sonidos`, { headers: { Authorization: `Bearer ${CLAVE()}` }, signal: AbortSignal.timeout(15000) });
  } catch {
    return res.status(502).json({ ok: false, code: "CONTENIDOS_SIN_RESPUESTA", message: "El servicio de contenidos no respondió." });
  }
  const texto = await r.text();
  if (!r.ok) return res.status(r.status).type(r.headers.get("content-type") || "application/json").send(texto);
  let cuerpo;
  try { cuerpo = JSON.parse(texto); } catch { cuerpo = null; }
  if (!Array.isArray(cuerpo?.sonidos)) return res.status(502).json({ ok: false, code: "CONTENIDOS_RESPUESTA_INVALIDA", message: "El servicio de contenidos devolvió un catálogo inválido." });
  return res.json({
    sonidos: conMuestra(cuerpo.sonidos),
    viral: cuerpo.viral || {},
    ...(Array.isArray(cuerpo.paquetes) ? { paquetes: cuerpo.paquetes } : {}),
    ...(cuerpo.clasico ? { clasico: clasicoAbsoluto(cuerpo.clasico) } : {}),
  });
}

// Lo habilitado para el comercio (estilos de video, voces y músicas; antes también
// efectos, plantillas, paquetes y mapa clásico), con muestras y miniaturas en URL absoluta. Si el
// servicio todavía no tiene /recursos, su estado pasa tal cual (la pantalla
// vuelve a los selectores de siempre).
async function recursos(req, res) {
  if (!BASE() || !CLAVE()) return noConfigurado(res);
  let cuenta, r;
  try {
    cuenta = await cuentaDelComercio();
    r = await fetch(`${BASE()}/recursos?cuenta=${encodeURIComponent(cuenta)}`, { headers: { Authorization: `Bearer ${CLAVE()}` }, signal: AbortSignal.timeout(15000) });
  } catch {
    return res.status(502).json({ ok: false, code: "CONTENIDOS_SIN_RESPUESTA", message: "El servicio de contenidos no respondió." });
  }
  const texto = await r.text();
  if (!r.ok) return res.status(r.status).type(r.headers.get("content-type") || "application/json").send(texto);
  let cuerpo;
  try { cuerpo = JSON.parse(texto); } catch { cuerpo = null; }
  const v = cuerpo?.videos;
  if (!v || typeof v !== "object") return res.status(502).json({ ok: false, code: "CONTENIDOS_RESPUESTA_INVALIDA", message: "El servicio de contenidos devolvió recursos inválidos." });
  return res.json({
    ...cuerpo,
    videos: {
      ...v,
      ...(v.voces ? { voces: conMuestra(v.voces) } : {}),
      ...(v.musicas ? { musicas: conMuestra(v.musicas) } : {}),
      ...(v.efectos ? { efectos: conMuestra(v.efectos) } : {}),
      ...(v.clasico ? { clasico: clasicoAbsoluto(v.clasico) } : {}),
      // Estilos de video (paquete): muestra de música y efectos y miniatura 9:16, públicas.
      ...(Array.isArray(v.estilos) ? { estilos: v.estilos.map((e) => (e && typeof e === "object" ? { ...e, ...(e.muestra ? { muestra: absoluta(e.muestra) } : {}), ...(e.miniatura ? { miniatura: absoluta(e.miniatura) } : {}) } : e)) } : {}),
    },
  });
}

// Productos para el creador por campañas: el catálogo del servicio (sale de la tienda
// pública) más lo que sólo sabe el POS, para proponer productos por campaña:
//   vendidos30d  unidades vendidas en 30 días (ventas cobradas, todas las sucursales)
//   alta         fecha de alta del producto (ISO)
// Las ventas se agregan una vez cada 5 minutos: el catálogo se pide de a páginas.
let ventasCache = { valor: null, vence: 0 };
async function datosDelPos(ids) {
  const { sequelize } = require("../models");
  if (!ventasCache.valor || Date.now() >= ventasCache.vence) {
    const [filas] = await sequelize.query(
      `SELECT si.product_id AS id, SUM(si.quantity) AS qty
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.status = 'PAID' AND s.sold_at >= :desde
        GROUP BY si.product_id`,
      { replacements: { desde: new Date(Date.now() - 30 * 864e5) } }
    );
    ventasCache = { valor: new Map(filas.map((f) => [String(f.id), Math.round(Number(f.qty) || 0)])), vence: Date.now() + 5 * 60 * 1000 };
  }
  const numericos = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const altas = new Map();
  if (numericos.length) {
    const [filas] = await sequelize.query("SELECT id, created_at FROM products WHERE id IN (:ids)", { replacements: { ids: numericos } });
    for (const f of filas) altas.set(String(f.id), f.created_at ? new Date(f.created_at).toISOString() : null);
  }
  return { ventas: ventasCache.valor, altas };
}
async function productos(req, res) {
  if (!BASE() || !CLAVE()) return noConfigurado(res);
  let r;
  try {
    r = await fetch(`${BASE()}/fuente/productos${q(req, ["buscar", "pagina", "todos"])}`, { headers: { Authorization: `Bearer ${CLAVE()}` }, signal: AbortSignal.timeout(60000) });
  } catch {
    return res.status(502).json({ ok: false, code: "CONTENIDOS_SIN_RESPUESTA", message: "El servicio de contenidos no respondió." });
  }
  const texto = await r.text();
  let cuerpo = null;
  if (r.ok) { try { cuerpo = JSON.parse(texto); } catch { cuerpo = null; } }
  if (!Array.isArray(cuerpo?.items)) return res.status(r.status).type(r.headers.get("content-type") || "application/json").send(texto);
  // Sin base (o si la consulta falla) el catálogo sale igual, sin los datos del POS.
  try {
    const { ventas, altas } = await datosDelPos(cuerpo.items.map((x) => x?.id));
    cuerpo.items = cuerpo.items.map((x) => ({ ...x, vendidos30d: ventas.get(String(x?.id)) || 0, ...(altas.get(String(x?.id)) ? { alta: altas.get(String(x.id)) } : {}) }));
  } catch { /* opcional */ }
  return res.json(cuerpo);
}

// Cambiar credenciales o salir del ensayo: sólo super admin.
function soloSuperAdmin(req, res, next) {
  const roles = req.access?.roles || [];
  if (req.access?.is_super_admin || roles.includes("super_admin")) return next();
  return res.status(403).json({ ok: false, code: "FORBIDDEN", message: "Sólo super administradores." });
}

module.exports = {
  soloAdmin,
  soloSuperAdmin,
  redes: (req, res) => redes(req, res, "GET"),
  guardarRedes: (req, res) => redes(req, res, "PUT", credenciales(req.body)),
  fuente: (req, res) => reenviar(req, res, "GET", "/fuente"),
  productos,
  voces,
  sonidos,
  recursos,
  cupo,
  // Con campaña: { campana, ritmo, locutor, variante, items[] } pasan tal cual; el servicio
  // devuelve además `textos` (portada, escenas, cierre, publicación y título).
  guion: (req, res) => reenviar(req, res, "POST", "/guion", req.body),
  listar: (req, res) => reenviar(req, res, "GET", `/piezas${q(req, ["cuenta", "limite"])}`),
  crear: (req, res) => reenviar(req, res, "POST", "/piezas", req.body),
  ver: (req, res) => reenviar(req, res, "GET", `/piezas/${id(req)}`),
  // Lo que se mandó al crear el video, para abrir el creador precargado y editarlo.
  encargo: (req, res) => reenviar(req, res, "GET", `/piezas/${id(req)}/encargo`),
  // Vuelve a la versión anterior de un video editado (no gasta edición).
  recuperar: (req, res) => reenviar(req, res, "POST", `/piezas/${id(req)}/recuperar`),
  // Título y descripción del video (sólo se reenvían esos dos campos).
  editar: (req, res) => reenviar(req, res, "PATCH", `/piezas/${id(req)}`, { titulo: req.body?.titulo, descripcion: req.body?.descripcion }),
  borrar: (req, res) => reenviar(req, res, "DELETE", `/piezas/${id(req)}`),
  // Corta un video en cola o dibujándose (no gasta más servidor ni voz).
  cancelar: (req, res) => reenviar(req, res, "POST", `/piezas/${id(req)}/cancelar`),
  publicar: (req, res) => reenviar(req, res, "POST", `/piezas/${id(req)}/publicaciones`, req.body),
};
