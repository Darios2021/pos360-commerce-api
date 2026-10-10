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

module.exports = {
  soloAdmin,
  fuente: (req, res) => reenviar(req, res, "GET", "/fuente"),
  productos: (req, res) => reenviar(req, res, "GET", `/fuente/productos${q(req, ["buscar", "pagina", "todos"])}`),
  guion: (req, res) => reenviar(req, res, "POST", "/guion", req.body),
  listar: (req, res) => reenviar(req, res, "GET", `/piezas${q(req, ["cuenta", "limite"])}`),
  crear: (req, res) => reenviar(req, res, "POST", "/piezas", req.body),
  ver: (req, res) => reenviar(req, res, "GET", `/piezas/${id(req)}`),
  borrar: (req, res) => reenviar(req, res, "DELETE", `/piezas/${id(req)}`),
  publicar: (req, res) => reenviar(req, res, "POST", `/piezas/${id(req)}/publicaciones`, req.body),
};
