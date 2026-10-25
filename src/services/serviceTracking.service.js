// src/services/serviceTracking.service.js
//
// Seguimiento del servicio tecnico: historial de la orden, tecnicos y los
// textos que se le mandan al cliente por WhatsApp.
//
// Vive aparte del controller porque lo usan el alta, la edicion, la derivacion
// y los avisos: si cada uno armara su renglon de historial, el seguimiento
// terminaria diciendo cosas distintas segun por donde se cambio la orden.

"use strict";

const { QueryTypes } = require("sequelize");
const { sequelize, ServiceOrderEvent, User } = require("../models");
const waSvc = require("./messaging/whatsapp.service");

function s(v) {
  return String(v ?? "").trim();
}

// Mismos textos que SERVICE_STATUS del front: es lo que lee el cliente.
const STATUS_LABEL = {
  recibido: "Recibido",
  diagnostico: "En diagnostico",
  presupuestado: "Presupuestado",
  aprobado: "Aprobado",
  en_reparacion: "En reparacion",
  reparado: "Reparado, listo para retirar",
  entregado: "Entregado",
  sin_solucion: "Sin solucion",
  no_retirado: "Sin retirar",
};

function statusLabel(st) {
  return STATUS_LABEL[st] || st || "";
}

function displayNameOf(u) {
  if (!u) return "";
  const full = [s(u.first_name), s(u.last_name)].filter(Boolean).join(" ").trim();
  return full || s(u.username) || s(u.email);
}

async function userName(userId, t) {
  if (!userId || !User) return null;
  const u = await User.findByPk(userId, {
    attributes: ["id", "first_name", "last_name", "username", "email"],
    transaction: t,
  });
  return displayNameOf(u) || null;
}

// ── Historial ───────────────────────────────────────────────────────────────

// Si la tabla no esta (migracion que no corrio), el cambio de la orden no se
// pierde por esto: se loguea y sigue. El historial es un agregado, la orden no.
async function registrar(evento, { req, t } = {}) {
  if (!ServiceOrderEvent) return null;
  try {
    const userId = parseInt(String(req?.user?.id ?? ""), 10) || null;
    return await ServiceOrderEvent.create(
      {
        ...evento,
        user_id: userId,
        user_name: evento.user_name || (await userName(userId, t)),
      },
      { transaction: t }
    );
  } catch (e) {
    console.warn("[servicio-tecnico] no se pudo registrar el seguimiento:", e?.message);
    return null;
  }
}

async function historial(orderId) {
  if (!ServiceOrderEvent) return [];
  return ServiceOrderEvent.findAll({
    where: { order_id: orderId },
    order: [["created_at", "ASC"], ["id", "ASC"]],
  });
}

// ── Tecnicos ────────────────────────────────────────────────────────────────

async function esTecnico(userId, t) {
  if (!userId) return false;
  const filas = await sequelize.query(
    "SELECT 1 FROM service_technicians WHERE user_id = :id LIMIT 1",
    { replacements: { id: userId }, type: QueryTypes.SELECT, transaction: t }
  );
  return filas.length > 0;
}

// Los usuarios activos con la marca de tecnico, para el selector de derivar.
async function listarTecnicos() {
  const filas = await sequelize.query(
    `SELECT u.id, u.first_name, u.last_name, u.username, u.email, u.branch_id
       FROM service_technicians st
       JOIN users u ON u.id = st.user_id
      WHERE COALESCE(u.is_active, 1) = 1
      ORDER BY u.first_name, u.last_name, u.username`,
    { type: QueryTypes.SELECT }
  );
  return filas.map((u) => ({ id: u.id, name: displayNameOf(u), branch_id: u.branch_id }));
}

// Todos los usuarios activos con la marca, para la pantalla donde el admin
// decide quien es tecnico.
async function listarUsuariosConMarca() {
  const filas = await sequelize.query(
    `SELECT u.id, u.first_name, u.last_name, u.username, u.email, u.branch_id,
            (st.user_id IS NOT NULL) AS es_tecnico
       FROM users u
       LEFT JOIN service_technicians st ON st.user_id = u.id
      WHERE COALESCE(u.is_active, 1) = 1
      ORDER BY u.first_name, u.last_name, u.username`,
    { type: QueryTypes.SELECT }
  );
  return filas.map((u) => ({
    id: u.id,
    name: displayNameOf(u),
    email: u.email || null,
    branch_id: u.branch_id,
    es_tecnico: Number(u.es_tecnico) === 1,
  }));
}

async function marcarTecnico(userId, activo) {
  if (activo) {
    await sequelize.query(
      "INSERT IGNORE INTO service_technicians (user_id) VALUES (:id)",
      { replacements: { id: userId } }
    );
  } else {
    await sequelize.query("DELETE FROM service_technicians WHERE user_id = :id", {
      replacements: { id: userId },
    });
  }
}

// ── WhatsApp ────────────────────────────────────────────────────────────────

async function nombreComercio() {
  try {
    const filas = await sequelize.query("SELECT name FROM shop_branding WHERE id = 1 LIMIT 1", {
      type: QueryTypes.SELECT,
    });
    return s(filas?.[0]?.name);
  } catch {
    return "";
  }
}

function money(v) {
  const n = Number(v || 0);
  return `$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fechaCorta(v) {
  if (!v) return "";
  // DATEONLY llega como "AAAA-MM-DD": se arma a mano para que la zona horaria
  // del servidor no la corra un dia para atras.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/San_Juan" });
}

function equipoDe(o) {
  return [s(o.device_brand), s(o.device_model)].filter(Boolean).join(" ") || "Equipo";
}

// null saca el renglon; "" deja una linea en blanco entre bloques.
function renglones(lista) {
  return lista.filter((x) => x !== null && x !== undefined).join("\n");
}

// Comprobante de ingreso: la copia del cliente del papel, en texto. Lleva lo
// mismo que la constancia impresa, menos el PIN (no viaja por un chat).
function textoComprobante(o, numero, comercio) {
  const saldo = Math.max(0, Number(o.quoted_amount || 0) - Number(o.deposit || 0));
  return renglones([
    `*${comercio || "Servicio tecnico"}*`,
    "Comprobante de ingreso de equipo",
    "",
    `Orden: *${numero}*`,
    `Fecha de ingreso: ${fechaCorta(o.created_at)}`,
    `Cliente: ${s(o.customer_name)}`,
    `Equipo: ${equipoDe(o)}${s(o.device_imei) ? ` (IMEI ${s(o.device_imei)})` : ""}`,
    s(o.device_accessories) ? `Accesorios: ${s(o.device_accessories)}` : null,
    s(o.intake_condition) ? `Estado al ingresar: ${s(o.intake_condition)}` : null,
    s(o.reported_fault) ? `Falla informada: ${s(o.reported_fault)}` : null,
    Number(o.quoted_amount) > 0 ? `Presupuesto: ${money(o.quoted_amount)}` : null,
    Number(o.deposit) > 0 ? `Seña: ${money(o.deposit)}` : null,
    Number(o.quoted_amount) > 0 ? `Saldo: ${money(saldo)}` : null,
    o.estimated_pickup ? `Retiro probable: ${fechaCorta(o.estimated_pickup)}` : null,
    "",
    "Para consultar por el equipo, indicar el numero de orden.",
    "Pasados 15 dias de la fecha pactada de entrega tendra un cargo diario. Pasados 45 dias sera considerado abandono (arts. 2375 / 2225 / 2524 CCyC).",
  ]);
}

// Aviso de cambio de estado. Lo que el cliente necesita saber en cada paso:
// presupuestado lleva el monto, reparado lleva el saldo a pagar al retirar.
function textoEstado(o, numero, comercio) {
  const saldo = Math.max(0, Number(o.quoted_amount || 0) - Number(o.deposit || 0));
  const extra = {
    presupuestado: Number(o.quoted_amount) > 0
      ? `Presupuesto: ${money(o.quoted_amount)}. Responder este mensaje para aprobarlo.`
      : "Responder este mensaje para conocer el presupuesto.",
    reparado: renglones([
      "El equipo esta listo para retirar.",
      saldo > 0 ? `Saldo a pagar: ${money(saldo)}.` : null,
    ]),
    sin_solucion: "El equipo no tiene reparacion. Ya se puede pasar a retirar.",
    entregado: "Gracias por confiar en nosotros.",
  }[o.status];

  return renglones([
    `*${comercio || "Servicio tecnico"}*`,
    `Orden *${numero}* · ${equipoDe(o)}`,
    "",
    `Estado: *${statusLabel(o.status)}*`,
    s(o.technical_report) && ["presupuestado", "reparado", "sin_solucion"].includes(o.status)
      ? `Diagnostico: ${s(o.technical_report)}`
      : null,
    extra || null,
  ]);
}

// Arma el mensaje y lo manda. Con Cloud API configurado sale solo; si no,
// devuelve el link wa.me que el mostrador abre con un toque. En los dos casos
// queda en el seguimiento, con el texto que se mando.
async function avisarPorWhatsApp(orden, { tipo, numero, req }) {
  const telefono = s(orden.customer_phone);
  if (!telefono) {
    return { ok: false, code: "SIN_TELEFONO", message: "La orden no tiene telefono del cliente." };
  }

  const comercio = await nombreComercio();
  const body = tipo === "comprobante"
    ? textoComprobante(orden, numero, comercio)
    : textoEstado(orden, numero, comercio);

  let r = await waSvc.sendWhatsApp({ to: telefono, body });
  // Con Cloud API, Meta rechaza un texto libre si el cliente no escribio en
  // las ultimas 24 h (que es el caso normal de un aviso del taller). Ahi se
  // cae al link wa.me, como dice whatsapp.service.js: el aviso no se pierde.
  if (!r.ok && r.code !== "INVALID_PHONE" && waSvc.isCloudApiConfigured()) {
    console.warn("[servicio-tecnico] Cloud API rechazo el aviso, se usa wa.me:", r.code || r.error_message);
    r = await waSvc.sendWhatsApp({ to: telefono, body, preferLink: true });
  }
  if (!r.ok) {
    return { ok: false, code: r.code || "WHATSAPP_ERROR", message: r.error_message || "No se pudo enviar." };
  }

  await registrar(
    {
      order_id: orden.id,
      kind: "aviso",
      channel: "whatsapp",
      to_status: tipo === "comprobante" ? null : orden.status,
      note: tipo === "comprobante"
        ? "Comprobante de ingreso"
        : `Estado: ${statusLabel(orden.status)}`,
    },
    { req }
  );

  return {
    ok: true,
    enviado: !r.manual_link,
    link: r.manual_link || null,
    texto: body,
  };
}

module.exports = {
  STATUS_LABEL,
  statusLabel,
  displayNameOf,
  userName,
  registrar,
  historial,
  esTecnico,
  listarTecnicos,
  listarUsuariosConMarca,
  marcarTecnico,
  avisarPorWhatsApp,
  textoComprobante,
  textoEstado,
};
