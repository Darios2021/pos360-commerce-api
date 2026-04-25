// src/services/messaging/templates.service.js
//
// Renderiza plantillas con variables tipo Mustache: {{var}}.
// Construye el contexto de variables a partir del customer y, opcionalmente,
// estadísticas de ventas (que el caller puede haber pre-calculado).
//
// Variables soportadas:
//   {{first_name}}        nombre
//   {{last_name}}         apellido
//   {{display_name}}      nombre completo
//   {{phone}}             teléfono
//   {{email}}             email
//   {{doc_number}}        DNI/CUIT
//   {{total_compras}}     monto total comprado histórico
//   {{cantidad_compras}}  cantidad de compras
//   {{ticket_promedio}}   ticket promedio
//   {{ultima_compra}}     fecha última compra (formato corto)
//   {{nombre_negocio}}    nombre del comercio (env BUSINESS_NAME)

"use strict";

function s(v) {
  return String(v ?? "").trim();
}

function fmtMoney(n) {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `$ ${Math.round(v)}`;
  }
}

function fmtDateShort(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: process.env.TZ_DISPLAY || "America/Argentina/Buenos_Aires",
    });
  } catch {
    return "—";
  }
}

/**
 * Construye el objeto de variables que el render reemplaza en el template.
 * @param {Object} customer  fila de la tabla customers (Sequelize instance o plain).
 * @param {Object} stats     opcional: { sales_count, sales_total, avg_ticket, last_sold_at }
 */
function buildContext(customer, stats = {}) {
  const c = customer?.toJSON ? customer.toJSON() : customer || {};
  const businessName = process.env.BUSINESS_NAME || "tu negocio";

  return {
    first_name:    s(c.first_name) || s(c.display_name).split(" ")[0] || "amigo/a",
    last_name:     s(c.last_name),
    display_name:  s(c.display_name) || "cliente",
    phone:         s(c.phone),
    email:         s(c.email),
    doc_number:    s(c.doc_number),
    total_compras: fmtMoney(stats?.sales_total),
    cantidad_compras: String(Number(stats?.sales_count || 0)),
    ticket_promedio:  fmtMoney(stats?.avg_ticket),
    ultima_compra: fmtDateShort(stats?.last_sold_at),
    nombre_negocio: businessName,
  };
}

/**
 * Reemplaza {{var}} en el string con los valores del context.
 * Variables no encontradas se reemplazan por "" (no rompe).
 */
function render(template, context = {}) {
  if (!template) return "";
  return String(template).replace(/\{\{\s*([\w_]+)\s*\}\}/g, (_, k) => {
    const v = context[k];
    return v != null ? String(v) : "";
  });
}

/**
 * Renderiza un mensaje completo (subject + body) con el customer + stats.
 */
function renderForCustomer({ template, customer, stats }) {
  const ctx = buildContext(customer, stats);
  return {
    subject: render(template?.subject, ctx),
    body:    render(template?.body, ctx),
    context: ctx,
  };
}

/**
 * Lista de variables soportadas, para mostrar en el editor del frontend.
 */
function listAvailableVariables() {
  return [
    { key: "first_name",        label: "Nombre" },
    { key: "last_name",         label: "Apellido" },
    { key: "display_name",      label: "Nombre completo" },
    { key: "phone",             label: "Teléfono" },
    { key: "email",             label: "Email" },
    { key: "doc_number",        label: "DNI/CUIT" },
    { key: "total_compras",     label: "Total comprado" },
    { key: "cantidad_compras",  label: "Cantidad de compras" },
    { key: "ticket_promedio",   label: "Ticket promedio" },
    { key: "ultima_compra",     label: "Última compra (fecha)" },
    { key: "nombre_negocio",    label: "Nombre del negocio" },
  ];
}

module.exports = {
  buildContext,
  render,
  renderForCustomer,
  listAvailableVariables,
};
