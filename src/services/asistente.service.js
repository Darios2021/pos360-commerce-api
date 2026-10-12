// src/services/asistente.service.js
// =====================================================================
// ASISTENTE INTERNO: el puente con mostrador (productos/mostrador, chat.cingulado.org).
//
// Dos puertas, cada una con su credencial (mismo modelo que Zondito):
//
//   1. /api/v1/asistente (sesión del backoffice /app). La pantalla pregunta acá; este
//      backend reenvía a mostrador con la clave del sistema (MOSTRADOR_CLAVE) y un
//      PERMISO DELEGADO firmado acá con ASISTENTE_SECRETO (no el de las sesiones):
//      comercio, usuario, rol normalizado, 5 minutos, audiencia `mostrador`.
//
//   2. /api/v1/asistente/datos (permiso delegado). Mostrador vuelve con ese permiso a
//      leer lo que el modelo pidió. Acá se verifica la firma, se relee el usuario en la
//      base (activo, mismo rol) y se aplica la MATRIZ. Aunque mostrador pidiera de más,
//      esta puerta no entrega lo que el rol no ve.
//
// Sólo lectura. Fechas: se guardan en UTC; los días se cortan en hora de Argentina.
// =====================================================================
const jwt = require("jsonwebtoken");
const { sequelize } = require("../models");
const { buildCashRegisterSummary } = require("./cashRegister.service");

const AUD = "mostrador";
const ALCANCE = "asistente:lectura";
const SISTEMA = () => process.env.ASISTENTE_SISTEMA || "sjt";
const CUENTA = () => process.env.ASISTENTE_CUENTA || "sanjuantecnologia";

/**
 * Qué consulta cada rol. Espejo de mostrador `src/caras/interna.js` (ROLES_POR_TIPO.pos360):
 * allá decide qué herramientas ve el modelo; acá, qué datos se entregan.
 */
const MATRIZ = {
  super_admin: ["caja-actual", "ventas", "cajas", "arqueo", "mas-vendidos", "margenes", "stock"],
  admin: ["caja-actual", "ventas", "cajas", "arqueo", "mas-vendidos", "margenes", "stock"],
  cajero: ["caja-actual", "ventas", "stock"],
  user: [],
};

// Mismos conjuntos que src/utils/accessScope.js.
const SUPER = new Set(["super_admin", "superadmin", "root", "owner"]);
const CAJERO = new Set(["cajero", "cashier", "vendedor", "seller"]);
/** Rol principal normalizado a una clave de la MATRIZ. Sin roles, el sistema lo trata como cajero. */
function rolPrincipal(roles) {
  const r = (roles || []).map((x) => String(x?.name ?? x).trim().toLowerCase()).filter(Boolean);
  if (r.some((x) => SUPER.has(x))) return "super_admin";
  if (r.includes("admin")) return "admin";
  if (!r.length || r.some((x) => CAJERO.has(x))) return "cajero";
  return "user";
}

class ErrorAsistente extends Error {
  constructor(status, mensaje) { super(mensaje); this.status = status; }
}

function configurado() {
  if (!process.env.MOSTRADOR_URL || !process.env.MOSTRADOR_CLAVE || !process.env.ASISTENTE_SECRETO) {
    throw new ErrorAsistente(503, "El asistente no está configurado.");
  }
}

async function usuarioConRoles(id) {
  const [[u]] = await sequelize.query(
    `SELECT id, email, username, first_name, last_name, is_active, branch_id FROM users WHERE id = :id`,
    { replacements: { id } }
  );
  if (!u) return null;
  const [roles] = await sequelize.query(
    `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = :id`,
    { replacements: { id } }
  );
  const [ramas] = await sequelize.query(`SELECT branch_id FROM user_branches WHERE user_id = :id`, { replacements: { id } });
  const nombre = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || u.email;
  const sucursales = [...new Set([u.branch_id, ...ramas.map((x) => x.branch_id)].filter(Boolean).map(Number))];
  return { id: Number(u.id), nombre, activo: !!u.is_active, rol: rolPrincipal(roles.map((x) => x.name)), sucursales };
}

/** Permiso delegado para mostrador, con el rol tal como está en la base ahora. */
async function firmarPermiso(userId) {
  configurado();
  const u = await usuarioConRoles(userId);
  if (!u || !u.activo) throw new ErrorAsistente(403, "Usuario no habilitado");
  return jwt.sign(
    { sis: SISTEMA(), cuenta: CUENTA(), sub: String(u.id), rol: u.rol, nombre: u.nombre, alcance: ALCANCE },
    process.env.ASISTENTE_SECRETO,
    { expiresIn: "5m", audience: AUD, algorithm: "HS256" }
  );
}

/** Reenvía a mostrador. Devuelve { status, cuerpo } sin tocar. */
async function pedirAMostrador(ruta, cuerpo, { espera = 90000 } = {}) {
  configurado();
  let r;
  try {
    r = await fetch(`${String(process.env.MOSTRADOR_URL).replace(/\/+$/, "")}${ruta}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.MOSTRADOR_CLAVE}`, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(espera),
    });
  } catch {
    throw new ErrorAsistente(502, "El asistente no respondió.");
  }
  const texto = await r.text();
  let json;
  try { json = JSON.parse(texto); } catch { json = { error: texto.slice(0, 300) }; }
  return { status: r.status, cuerpo: json };
}

/** Middleware de /asistente/datos: permiso válido, usuario activo con el mismo rol. */
async function exigirPermiso(req, res, next) {
  try {
    if (!process.env.ASISTENTE_SECRETO) return res.status(503).json({ ok: false, error: "El asistente no está configurado." });
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    let p;
    try {
      p = jwt.verify(token, process.env.ASISTENTE_SECRETO, { audience: AUD, algorithms: ["HS256"] });
    } catch {
      return res.status(401).json({ ok: false, error: "Permiso inválido o vencido" });
    }
    if (p.alcance !== ALCANCE || p.sis !== SISTEMA() || p.cuenta !== CUENTA() || !p.sub || !p.rol) {
      return res.status(401).json({ ok: false, error: "Permiso inválido" });
    }
    const u = await usuarioConRoles(Number(p.sub));
    if (!u || !u.activo) return res.status(403).json({ ok: false, error: "Usuario no habilitado" });
    // Un cambio de rol corta en el acto, sin esperar a que venza el permiso.
    if (u.rol !== p.rol) return res.status(403).json({ ok: false, error: "El rol del usuario cambió" });
    req.asistente = u;
    return next();
  } catch (e) {
    return next(e);
  }
}

const exigirRol = (dato) => (req, res, next) => {
  if (!(MATRIZ[req.asistente?.rol] || []).includes(dato)) {
    return res.status(403).json({ ok: false, error: "Tu rol no tiene acceso a este dato" });
  }
  return next();
};

// ── Fechas: días de Argentina (UTC−3, sin horario de verano) ──
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/San_Juan" }).format(new Date());
// Los límites van como texto UTC ("AAAA-MM-DD HH:MM:SS"), que es como se guardan las fechas:
// un Date en las consultas crudas lo formatea el driver y corría la ventana un día.
const utc = (x) => x.toISOString().slice(0, 19).replace("T", " ");
const inicioDia = (d) => utc(new Date(`${d}T00:00:00-03:00`));
const finDia = (d) => { const x = new Date(`${d}T00:00:00-03:00`); x.setUTCDate(x.getUTCDate() + 1); return utc(x); };
function rango(q, { defecto = 0 } = {}) {
  const d = FECHA.test(q.desde || "") ? q.desde : null;
  const h = FECHA.test(q.hasta || "") ? q.hasta : null;
  const base = defecto ? new Date(Date.parse(hoy()) - defecto * 86400000).toISOString().slice(0, 10) : hoy();
  const desde = d || h || base;
  const hasta = h || (d ? d : hoy());
  if (desde > hasta) throw new ErrorAsistente(400, "desde es posterior a hasta");
  if ((Date.parse(hasta) - Date.parse(desde)) / 86400000 > 366) throw new ErrorAsistente(400, "El rango máximo es un año");
  return { desde, hasta, de: inicioDia(desde), a: finDia(hasta) };
}

/** Sucursales que puede ver: super_admin todas; los demás, las suyas. null = todas. */
const sucursalesDe = (u) => (u.rol === "super_admin" ? null : (u.sucursales.length ? u.sucursales : [-1]));
const filtroSucursal = (u, col) => (sucursalesDe(u) ? `AND ${col} IN (:sucursales)` : "");
const reemplazos = (u, extra = {}) => ({ sucursales: sucursalesDe(u) || [0], ...extra });

const n = (v) => Math.round((Number(v) || 0) * 100) / 100;
const nombreUsuario = `COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))),''), u.username, u.email)`;

async function nombresSucursales() {
  const [b] = await sequelize.query(`SELECT id, name FROM branches`);
  return new Map(b.map((x) => [Number(x.id), x.name]));
}

function resumenCaja(c, sucursales, totales) {
  return {
    caja: Number(c.id), sucursal: sucursales.get(Number(c.branch_id)) || null,
    estado: c.status === "OPEN" ? "abierta" : "cerrada",
    abierta_por: c.abierta_por || null, abierta_el: c.opened_at, cerrada_por: c.cerrada_por || null, cerrada_el: c.closed_at || null,
    fondo_inicial: n(c.opening_cash),
    ...(totales ? {
      ventas: n(totales.sales_total), cantidad_ventas: Number(totales.sales_count) || 0, anuladas: Number(totales.sales_cancelled_count) || 0,
      ingresos: n(totales.manual_in), egresos: n(totales.manual_out),
    } : {}),
    efectivo_esperado: c.status === "OPEN" ? (totales ? n(totales.expected_cash) : null) : n(c.expected_cash),
    efectivo_contado: c.status === "OPEN" ? null : n(c.closing_cash),
    diferencia_efectivo: c.status === "OPEN" ? null : n(c.difference_cash),
  };
}

const CAJAS_SQL = (cond) => `
  SELECT c.*, ${nombreUsuario} AS abierta_por,
         COALESCE(NULLIF(TRIM(CONCAT(COALESCE(uc.first_name,''),' ',COALESCE(uc.last_name,''))),''), uc.username, uc.email) AS cerrada_por
    FROM cash_registers c
    LEFT JOIN users u ON u.id = c.opened_by
    LEFT JOIN users uc ON uc.id = c.closed_by
   WHERE 1 = 1 ${cond}`;

function porMedio(pagos) {
  const p = pagos || {};
  return Object.entries({
    efectivo: p.cash, transferencia: p.transfer, tarjeta: p.card, "Mercado Pago / QR": p.mercadopago, "Crédito SJT": p.credit_sjt, otros: p.other,
  }).filter(([, v]) => Number(v) > 0).map(([medio, importe]) => ({ medio, importe: n(importe) }));
}

// ── Datos ──

async function cajaActual(u) {
  const cajero = u.rol === "cajero";
  const [filas] = await sequelize.query(
    CAJAS_SQL(`AND c.status = 'OPEN' ${filtroSucursal(u, "c.branch_id")} ${cajero ? "AND c.opened_by = :uid" : ""} ORDER BY c.opened_at`),
    { replacements: reemplazos(u, { uid: u.id }) }
  );
  const sucursales = await nombresSucursales();
  const cajas = [];
  for (const c of filas) {
    const s = await buildCashRegisterSummary({ cash_register_id: c.id });
    cajas.push({ ...resumenCaja(c, sucursales, s.totals), por_medio: porMedio(s.payments_by_method) });
  }
  return { cajas_abiertas: cajas.length, cajas, alcance: cajero ? "las cajas que abrió este usuario" : "las sucursales del usuario", moneda: "ARS" };
}

async function ventas(u, q) {
  const r = rango(q);
  // El cajero ve las ventas de hoy y nada más: el histórico es del administrador.
  if (u.rol === "cajero" && (r.desde !== hoy() || r.hasta !== hoy())) throw new ErrorAsistente(403, "Tu rol sólo puede ver las ventas de hoy");
  const rep = reemplazos(u, { de: r.de, a: r.a });
  const sf = filtroSucursal(u, "s.branch_id");
  const [[tot]] = await sequelize.query(
    `SELECT COUNT(*) AS cantidad, COALESCE(SUM(s.total),0) AS total FROM sales s
      WHERE s.status = 'PAID' AND s.sold_at >= :de AND s.sold_at < :a ${sf}`, { replacements: rep });
  const [[anul]] = await sequelize.query(
    `SELECT COUNT(*) AS cantidad, COALESCE(SUM(s.total),0) AS total FROM sales s
      WHERE s.status = 'CANCELLED' AND s.sold_at >= :de AND s.sold_at < :a ${sf}`, { replacements: rep });
  const [medios] = await sequelize.query(
    `SELECT p.method AS medio, COALESCE(SUM(p.amount),0) AS importe FROM payments p JOIN sales s ON s.id = p.sale_id
      WHERE s.status = 'PAID' AND s.sold_at >= :de AND s.sold_at < :a ${sf} GROUP BY p.method ORDER BY importe DESC`, { replacements: rep });
  const [dias] = await sequelize.query(
    `SELECT DATE(CONVERT_TZ(s.sold_at,'+00:00','-03:00')) AS dia, COUNT(*) AS cantidad, COALESCE(SUM(s.total),0) AS total FROM sales s
      WHERE s.status = 'PAID' AND s.sold_at >= :de AND s.sold_at < :a ${sf} GROUP BY dia ORDER BY dia`, { replacements: rep });
  const [suc] = await sequelize.query(
    `SELECT b.name AS sucursal, COUNT(*) AS cantidad, COALESCE(SUM(s.total),0) AS total FROM sales s LEFT JOIN branches b ON b.id = s.branch_id
      WHERE s.status = 'PAID' AND s.sold_at >= :de AND s.sold_at < :a ${sf} GROUP BY b.name ORDER BY total DESC`, { replacements: rep });
  const NOMBRE = { CASH: "efectivo", TRANSFER: "transferencia", CARD: "tarjeta", QR: "QR", MERCADOPAGO: "Mercado Pago", CREDIT_SJT: "Crédito SJT", OTHER: "otros" };
  const cantidad = Number(tot.cantidad) || 0;
  return {
    desde: r.desde, hasta: r.hasta, total: n(tot.total), cantidad, ticket_promedio: cantidad ? Math.round(n(tot.total) / cantidad) : 0,
    anuladas: { cantidad: Number(anul.cantidad) || 0, total: n(anul.total) },
    por_medio: medios.map((m) => ({ medio: NOMBRE[m.medio] || m.medio, importe: n(m.importe) })),
    por_sucursal: suc.map((x) => ({ sucursal: x.sucursal, cantidad: Number(x.cantidad), total: n(x.total) })),
    por_dia: dias.length > 62 ? undefined : dias.map((d) => ({ dia: String(d.dia instanceof Date ? d.dia.toISOString().slice(0, 10) : d.dia).slice(0, 10), cantidad: Number(d.cantidad), total: n(d.total) })),
    moneda: "ARS",
  };
}

async function cajas(u, q) {
  const r = q.desde || q.hasta ? rango(q) : rango({}, { defecto: 30 });
  const est = q.estado === "abiertas" ? "AND c.status = 'OPEN'" : q.estado === "cerradas" ? "AND c.status = 'CLOSED'" : "";
  const [filas] = await sequelize.query(
    CAJAS_SQL(`${est} AND c.opened_at >= :de AND c.opened_at < :a ${filtroSucursal(u, "c.branch_id")} ORDER BY c.opened_at DESC LIMIT 100`),
    { replacements: reemplazos(u, { de: r.de, a: r.a }) }
  );
  const sucursales = await nombresSucursales();
  const lista = filas.map((c) => resumenCaja(c, sucursales, null));
  const conDiferencia = lista.filter((c) => c.diferencia_efectivo && Math.abs(c.diferencia_efectivo) >= 1);
  return { desde: r.desde, hasta: r.hasta, cantidad: lista.length, cierres_con_diferencia: conDiferencia.length, cajas: lista, moneda: "ARS" };
}

async function arqueo(u, q) {
  const id = Number(q.caja) || null;
  const [filas] = await sequelize.query(
    CAJAS_SQL(`${id ? "AND c.id = :id" : "AND c.status = 'CLOSED'"} ${filtroSucursal(u, "c.branch_id")} ORDER BY c.closed_at DESC LIMIT 1`),
    { replacements: reemplazos(u, { id }) }
  );
  const c = filas[0];
  if (!c) throw new ErrorAsistente(404, "No hay una caja con ese dato");
  const s = await buildCashRegisterSummary({ cash_register_id: c.id });
  const sucursales = await nombresSucursales();
  let declarado = null;
  try { declarado = typeof c.closing_declared === "string" ? JSON.parse(c.closing_declared) : c.closing_declared || null; } catch { declarado = null; }
  return {
    ...resumenCaja(c, sucursales, s.totals),
    efectivo_esperado: n(c.status === "OPEN" ? s.totals.expected_cash : (c.expected_cash ?? s.totals.expected_cash)),
    por_medio: porMedio(s.payments_by_method),
    movimientos: (s.movements || []).filter((m) => m.reason !== "APERTURA_CAJA").slice(0, 30).map((m) => ({ tipo: m.type === "IN" ? "ingreso" : "egreso", motivo: m.reason, nota: m.note || undefined, importe: n(m.amount) })),
    declarado_por_medio: declarado,
    moneda: "ARS",
  };
}

async function masVendidos(u, q) {
  const r = q.desde || q.hasta ? rango(q) : rango({}, { defecto: 30 });
  const limite = Math.min(30, Math.max(1, parseInt(q.limite, 10) || 10));
  const [filas] = await sequelize.query(
    `SELECT MAX(si.product_name_snapshot) AS producto, SUM(si.quantity) AS unidades, SUM(si.line_total) AS facturado
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.status = 'PAID' AND s.sold_at >= :de AND s.sold_at < :a ${filtroSucursal(u, "s.branch_id")}
      GROUP BY si.product_id ORDER BY facturado DESC LIMIT ${limite}`,
    { replacements: reemplazos(u, { de: r.de, a: r.a }) }
  );
  return { desde: r.desde, hasta: r.hasta, productos: filas.map((f) => ({ producto: f.producto, unidades: n(f.unidades), facturado: n(f.facturado) })), moneda: "ARS" };
}

// Mismo cálculo que reports.controller.js getGananciaReport: costo guardado en la venta o,
// si la venta es anterior a esa columna, el costo actual del producto (USD × cotización).
const COSTO_ACTUAL = "CASE WHEN UPPER(COALESCE(p.cost_currency,'')) = 'USD' THEN COALESCE(p.cost,0) * COALESCE(p.fx_rate,0) ELSE COALESCE(p.cost,0) END";
async function margenes(u, q) {
  const r = q.desde || q.hasta ? rango(q) : rango({}, { defecto: 30 });
  const [filas] = await sequelize.query(
    `SELECT MAX(si.product_name_snapshot) AS producto, SUM(si.quantity) AS unidades, SUM(si.line_total) AS vendido,
            SUM(si.quantity * COALESCE(si.unit_cost, ${COSTO_ACTUAL})) AS costo,
            SUM(CASE WHEN si.unit_cost IS NULL THEN si.quantity ELSE 0 END) AS estimadas,
            SUM(CASE WHEN COALESCE(si.unit_cost, ${COSTO_ACTUAL}) <= 0 THEN si.quantity ELSE 0 END) AS sin_costo
       FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id
      WHERE s.status = 'PAID' AND s.sold_at >= :de AND s.sold_at < :a ${filtroSucursal(u, "s.branch_id")}
      GROUP BY si.product_id ORDER BY vendido DESC`,
    { replacements: reemplazos(u, { de: r.de, a: r.a }) }
  );
  const suma = (k) => filas.reduce((s, f) => s + (Number(f[k]) || 0), 0);
  const vendido = suma("vendido"), costo = suma("costo");
  const margen = vendido - costo;
  return {
    desde: r.desde, hasta: r.hasta,
    total: { vendido: n(vendido), costo: n(costo), margen: n(margen), margen_pct: vendido ? Math.round((margen / vendido) * 1000) / 10 : null },
    unidades_con_costo_estimado: suma("estimadas"), unidades_sin_costo: suma("sin_costo"),
    nota: "Margen bruto sobre precio de venta con IVA, sin impuestos ni comisiones. Las unidades sin costo cargado cuentan como costo 0.",
    productos: filas.slice(0, 10).map((f) => {
      const v = Number(f.vendido) || 0, c = Number(f.costo) || 0;
      return { producto: f.producto, unidades: n(f.unidades), vendido: n(v), costo: n(c), margen: n(v - c), margen_pct: v ? Math.round(((v - c) / v) * 1000) / 10 : null };
    }),
    moneda: "ARS",
  };
}

async function stock(u, q) {
  const consulta = String(q.consulta || "").trim().slice(0, 60);
  const bajos = String(q.solo_bajos) === "true";
  const [filas] = await sequelize.query(
    `SELECT p.name AS producto, p.sku, b.name AS sucursal, SUM(sb.qty) AS existencia, MAX(p.min_stock) AS minimo
       FROM stock_balances sb
       JOIN products p ON p.id = sb.product_id
       JOIN warehouses w ON w.id = sb.warehouse_id
       LEFT JOIN branches b ON b.id = w.branch_id
      WHERE p.is_active = 1 AND COALESCE(p.track_stock, 1) = 1 ${consulta ? "AND (p.name LIKE :q OR p.sku LIKE :q)" : ""}
        ${filtroSucursal(u, "w.branch_id")}
      GROUP BY p.id, b.name
      ${bajos ? "HAVING SUM(sb.qty) <= COALESCE(MAX(p.min_stock), 3)" : ""}
      ORDER BY existencia ASC, p.name LIMIT 40`,
    { replacements: reemplazos(u, { q: `%${consulta}%` }) }
  );
  return {
    productos: filas.map((f) => ({ producto: f.producto, sku: f.sku, sucursal: f.sucursal, existencia: n(f.existencia), minimo: f.minimo === null ? null : n(f.minimo) })),
    nota: bajos ? "Bajo mínimo: con el mínimo del producto, o 3 si no tiene." : undefined,
  };
}

module.exports = {
  MATRIZ, rolPrincipal, ErrorAsistente, configurado, firmarPermiso, pedirAMostrador, exigirPermiso, exigirRol, hoy,
  cajaActual, ventas, cajas, arqueo, masVendidos, margenes, stock,
};
