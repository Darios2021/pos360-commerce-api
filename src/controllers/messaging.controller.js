// src/controllers/messaging.controller.js
//
// Endpoints CRM:
//   GET    /admin/messaging/templates              listar plantillas
//   POST   /admin/messaging/templates              crear plantilla
//   PUT    /admin/messaging/templates/:id          editar
//   DELETE /admin/messaging/templates/:id          eliminar (soft)
//   GET    /admin/messaging/variables              listado de variables
//   GET    /admin/messaging/status                 estado de los proveedores
//   POST   /admin/messaging/preview                previsualiza para 1 cliente
//   POST   /admin/messaging/send                   envía a 1 cliente
//   POST   /admin/messaging/send-bulk              envía a N clientes
//   GET    /admin/messaging/logs                   historial general
//   GET    /admin/messaging/logs/customer/:id      historial por cliente
//
// Permisos: admin / super_admin (validado en cada handler con accessScope).

"use strict";

const { Op, fn, col } = require("sequelize");
const access = require("../utils/accessScope");

const { sequelize, Customer, Sale, MessageTemplate, MessageLog } = require("../models");
const tplSvc = require("../services/messaging/templates.service");
const emailSvc = require("../services/messaging/email.service");
const waSvc = require("../services/messaging/whatsapp.service");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function s(v) { return String(v ?? "").trim(); }
function gateAdmin(req, res) {
  if (!access.isBranchAdmin(req)) {
    res.status(403).json({ ok: false, code: "FORBIDDEN", message: "Solo administradores." });
    return false;
  }
  return true;
}

// Garantiza tablas (idempotente).
let tablesEnsured = false;
async function ensureTables() {
  if (tablesEnsured) return;
  try {
    if (MessageTemplate?.sync) await MessageTemplate.sync({ alter: false });
    if (MessageLog?.sync) await MessageLog.sync({ alter: false });
    tablesEnsured = true;
  } catch (e) {
    console.warn("[messaging.ensureTables]", e?.message);
  }
}

// ============================================================
// PLANTILLAS — CRUD
// ============================================================
async function listTemplates(req, res, next) {
  try {
    if (!gateAdmin(req, res)) return;
    await ensureTables();

    const channel = s(req.query.channel).toLowerCase();
    const where = { is_active: true };
    if (["email", "whatsapp", "both"].includes(channel)) where.channel = channel;

    const rows = await MessageTemplate.findAll({
      where,
      order: [["category", "ASC"], ["name", "ASC"]],
    });
    return res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
}

async function createTemplate(req, res, next) {
  try {
    if (!gateAdmin(req, res)) return;
    await ensureTables();
    const b = req.body || {};
    const channel = ["email", "whatsapp", "both"].includes(b.channel) ? b.channel : "email";
    if (!s(b.name) || !s(b.body)) {
      return res.status(400).json({ ok: false, message: "name y body son obligatorios" });
    }
    if (channel === "email" && !s(b.subject)) {
      return res.status(400).json({ ok: false, message: "subject es obligatorio para email" });
    }

    const row = await MessageTemplate.create({
      name: s(b.name),
      channel,
      subject: s(b.subject) || null,
      body: s(b.body),
      description: s(b.description) || null,
      category: s(b.category) || null,
      is_active: b.is_active === false ? false : true,
      created_by: toInt(req.user?.id, 0) || null,
    });
    return res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
}

async function updateTemplate(req, res, next) {
  try {
    if (!gateAdmin(req, res)) return;
    await ensureTables();
    const id = toInt(req.params.id, 0);
    const row = await MessageTemplate.findByPk(id);
    if (!row) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const b = req.body || {};
    if ("name" in b)        row.name    = s(b.name) || row.name;
    if ("channel" in b && ["email","whatsapp","both"].includes(b.channel)) row.channel = b.channel;
    if ("subject" in b)     row.subject = s(b.subject) || null;
    if ("body" in b)        row.body    = s(b.body) || row.body;
    if ("description" in b) row.description = s(b.description) || null;
    if ("category" in b)    row.category = s(b.category) || null;
    if ("is_active" in b)   row.is_active = !!b.is_active;
    await row.save();
    return res.json({ ok: true, data: row });
  } catch (e) { next(e); }
}

async function deleteTemplate(req, res, next) {
  try {
    if (!gateAdmin(req, res)) return;
    await ensureTables();
    const id = toInt(req.params.id, 0);
    const row = await MessageTemplate.findByPk(id);
    if (!row) return res.status(404).json({ ok: false, code: "NOT_FOUND" });
    // Soft-delete: deja de aparecer en la lista pero queda disponible en logs.
    await row.update({ is_active: false });
    return res.json({ ok: true, message: "Plantilla desactivada" });
  } catch (e) { next(e); }
}

// ============================================================
// VARIABLES SOPORTADAS
// ============================================================
async function listVariables(req, res) {
  if (!gateAdmin(req, res)) return;
  return res.json({ ok: true, data: tplSvc.listAvailableVariables() });
}

// ============================================================
// STATUS — qué proveedores están configurados
// ============================================================
async function status(req, res) {
  if (!gateAdmin(req, res)) return;
  const emailPing = await emailSvc.ping().catch(() => ({ ok: false, error: "ping failed" }));
  return res.json({
    ok: true,
    data: {
      email: {
        configured: emailSvc.isConfigured(),
        ok: !!emailPing.ok,
        error: emailPing.error || null,
      },
      whatsapp: {
        cloud_api_configured: waSvc.isCloudApiConfigured(),
        // Si Cloud API no está, la app puede igual generar wa.me links manuales.
        fallback_wame_available: true,
      },
    },
  });
}

// ============================================================
// HELPERS — cargar customer + stats para render
// ============================================================
async function loadCustomerWithStats(customerId) {
  const customer = await Customer.findByPk(customerId);
  if (!customer) return null;

  const [stats] = await Sale.findAll({
    attributes: [
      [fn("COUNT", col("id")), "sales_count"],
      [fn("SUM", col("total")), "sales_total"],
      [fn("AVG", col("total")), "avg_ticket"],
      [fn("MAX", col("sold_at")), "last_sold_at"],
    ],
    where: { customer_id: customerId, status: "PAID" },
    raw: true,
  });

  return {
    customer,
    stats: {
      sales_count: Number(stats?.sales_count || 0),
      sales_total: Number(stats?.sales_total || 0),
      avg_ticket:  Number(stats?.avg_ticket  || 0),
      last_sold_at: stats?.last_sold_at || null,
    },
  };
}

async function resolveTemplate(template_id, channel, body, subject) {
  if (template_id) {
    const t = await MessageTemplate.findByPk(template_id);
    if (!t) return null;
    return t;
  }
  // One-off: el caller manda body/subject directamente sin plantilla guardada.
  return {
    id: null,
    channel: channel || "email",
    subject: subject || null,
    body: body || "",
  };
}

// ============================================================
// PREVIEW
// ============================================================
async function preview(req, res, next) {
  try {
    if (!gateAdmin(req, res)) return;
    await ensureTables();

    const customer_id = toInt(req.body?.customer_id, 0);
    if (!customer_id) return res.status(400).json({ ok: false, code: "CUSTOMER_REQUIRED" });

    const ctxData = await loadCustomerWithStats(customer_id);
    if (!ctxData) return res.status(404).json({ ok: false, code: "CUSTOMER_NOT_FOUND" });

    const tpl = await resolveTemplate(
      toInt(req.body?.template_id, 0),
      req.body?.channel,
      req.body?.body,
      req.body?.subject
    );
    if (!tpl) return res.status(404).json({ ok: false, code: "TEMPLATE_NOT_FOUND" });

    const rendered = tplSvc.renderForCustomer({
      template: tpl,
      customer: ctxData.customer,
      stats: ctxData.stats,
    });

    return res.json({
      ok: true,
      data: {
        channel: tpl.channel,
        subject: rendered.subject,
        body: rendered.body,
        to: tpl.channel === "email" ? ctxData.customer.email : ctxData.customer.phone,
        customer: {
          id: ctxData.customer.id,
          display_name: ctxData.customer.display_name,
          email: ctxData.customer.email,
          phone: ctxData.customer.phone,
        },
        context: rendered.context,
      },
    });
  } catch (e) { next(e); }
}

// ============================================================
// SEND — un mensaje a un cliente
// ============================================================
async function sendOne(req, res, next) {
  try {
    if (!gateAdmin(req, res)) return;
    await ensureTables();

    const customer_id = toInt(req.body?.customer_id, 0);
    if (!customer_id) return res.status(400).json({ ok: false, code: "CUSTOMER_REQUIRED" });

    const channel = ["email", "whatsapp"].includes(req.body?.channel) ? req.body.channel : "email";
    const preferLink = !!req.body?.prefer_link;

    const ctxData = await loadCustomerWithStats(customer_id);
    if (!ctxData) return res.status(404).json({ ok: false, code: "CUSTOMER_NOT_FOUND" });

    const tpl = await resolveTemplate(
      toInt(req.body?.template_id, 0),
      channel,
      req.body?.body,
      req.body?.subject
    );
    if (!tpl) return res.status(404).json({ ok: false, code: "TEMPLATE_NOT_FOUND" });

    const rendered = tplSvc.renderForCustomer({
      template: tpl,
      customer: ctxData.customer,
      stats: ctxData.stats,
    });

    // Determinar destinatario y validar canal.
    let to = "";
    if (channel === "email") {
      to = ctxData.customer.email;
      if (!to) return res.status(400).json({ ok: false, code: "NO_EMAIL", message: "El cliente no tiene email." });
    } else {
      to = ctxData.customer.phone;
      if (!to) return res.status(400).json({ ok: false, code: "NO_PHONE", message: "El cliente no tiene teléfono." });
    }

    // Crear log "queued" y luego actualizar.
    const log = await MessageLog.create({
      customer_id,
      channel,
      template_id: tpl.id || null,
      to_address: to,
      to_name: ctxData.customer.display_name,
      subject: rendered.subject || null,
      body: rendered.body,
      status: "queued",
      sent_by: toInt(req.user?.id, 0) || null,
    });

    let result;
    if (channel === "email") {
      result = await emailSvc.sendEmail({
        to,
        toName: ctxData.customer.display_name,
        subject: rendered.subject || "(sin asunto)",
        body: rendered.body,
      });
    } else {
      result = await waSvc.sendWhatsApp({
        to,
        body: rendered.body,
        preferLink,
      });
    }

    await log.update({
      status: result.ok ? (result.manual_link ? "manual_link" : "sent") : "failed",
      provider: result.provider || null,
      provider_msg_id: result.message_id || null,
      error_message: result.error_message || null,
      sent_at: result.ok ? new Date() : null,
    });

    return res.json({
      ok: result.ok,
      data: {
        log_id: log.id,
        status: log.status,
        provider: result.provider || null,
        manual_link: result.manual_link || null,
      },
      ...(result.ok ? {} : { code: result.code, message: result.error_message }),
    });
  } catch (e) { next(e); }
}

// ============================================================
// BULK SEND — a N clientes
// ============================================================
async function sendBulk(req, res, next) {
  try {
    if (!gateAdmin(req, res)) return;
    await ensureTables();

    const ids = Array.isArray(req.body?.customer_ids)
      ? req.body.customer_ids.map((x) => toInt(x, 0)).filter(Boolean)
      : [];
    if (!ids.length) return res.status(400).json({ ok: false, code: "IDS_REQUIRED" });

    const channel = ["email", "whatsapp"].includes(req.body?.channel) ? req.body.channel : "email";
    const preferLink = !!req.body?.prefer_link;

    const tpl = await resolveTemplate(
      toInt(req.body?.template_id, 0),
      channel,
      req.body?.body,
      req.body?.subject
    );
    if (!tpl) return res.status(404).json({ ok: false, code: "TEMPLATE_NOT_FOUND" });

    const results = [];
    let okCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    const links = []; // wa.me links si aplica

    // Procesamos secuencialmente para no saturar SMTP / Meta API.
    for (const id of ids) {
      try {
        const ctxData = await loadCustomerWithStats(id);
        if (!ctxData) { skippedCount++; results.push({ id, ok: false, skipped: "not_found" }); continue; }

        const to = channel === "email" ? ctxData.customer.email : ctxData.customer.phone;
        if (!to) {
          skippedCount++;
          results.push({ id, ok: false, skipped: channel === "email" ? "no_email" : "no_phone" });
          continue;
        }

        const rendered = tplSvc.renderForCustomer({
          template: tpl,
          customer: ctxData.customer,
          stats: ctxData.stats,
        });

        const log = await MessageLog.create({
          customer_id: id,
          channel,
          template_id: tpl.id || null,
          to_address: to,
          to_name: ctxData.customer.display_name,
          subject: rendered.subject || null,
          body: rendered.body,
          status: "queued",
          sent_by: toInt(req.user?.id, 0) || null,
        });

        let result;
        if (channel === "email") {
          result = await emailSvc.sendEmail({
            to,
            toName: ctxData.customer.display_name,
            subject: rendered.subject || "(sin asunto)",
            body: rendered.body,
          });
        } else {
          result = await waSvc.sendWhatsApp({ to, body: rendered.body, preferLink });
        }

        await log.update({
          status: result.ok ? (result.manual_link ? "manual_link" : "sent") : "failed",
          provider: result.provider || null,
          provider_msg_id: result.message_id || null,
          error_message: result.error_message || null,
          sent_at: result.ok ? new Date() : null,
        });

        if (result.ok) {
          okCount++;
          if (result.manual_link) links.push({ customer_id: id, link: result.manual_link });
        } else {
          failCount++;
        }
        results.push({
          id,
          ok: result.ok,
          status: log.status,
          manual_link: result.manual_link || null,
          error: result.error_message || null,
        });
      } catch (e) {
        failCount++;
        results.push({ id, ok: false, error: e?.message || "error" });
      }
    }

    return res.json({
      ok: true,
      summary: {
        total: ids.length,
        ok: okCount,
        failed: failCount,
        skipped: skippedCount,
        manual_links: links.length,
      },
      results,
      manual_links: links,
    });
  } catch (e) { next(e); }
}

// ============================================================
// HISTORIAL
// ============================================================
async function listLogs(req, res, next) {
  try {
    if (!gateAdmin(req, res)) return;
    await ensureTables();

    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 50)));
    const offset = Math.max(0, toInt(req.query.offset, 0));
    const where = {};
    if (req.query.customer_id) where.customer_id = toInt(req.query.customer_id, 0);
    if (req.query.channel) where.channel = req.query.channel;
    if (req.query.status) where.status = req.query.status;

    const { rows, count } = await MessageLog.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
    });
    return res.json({ ok: true, data: rows, meta: { total: count, limit, offset } });
  } catch (e) { next(e); }
}

async function listLogsByCustomer(req, res, next) {
  try {
    if (!gateAdmin(req, res)) return;
    await ensureTables();
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, code: "BAD_ID" });
    const rows = await MessageLog.findAll({
      where: { customer_id: id },
      order: [["id", "DESC"]],
      limit: 50,
    });
    return res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
}

module.exports = {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listVariables,
  status,
  preview,
  sendOne,
  sendBulk,
  listLogs,
  listLogsByCustomer,
};
