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
const layoutSvc = require("../services/messaging/emailLayout.service");
const waFormatter = require("../services/messaging/whatsappFormatter.service");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function s(v) { return String(v ?? "").trim(); }
function sleep(ms) { return new Promise((r) => setTimeout(r, Math.max(0, ms))); }

// Throttle entre envíos de un bulk para mantener buena reputación con
// Gmail/Outlook: enviar de a 10 con ~800ms de gap simula el patrón de un
// humano con cliente de email común y reduce el riesgo de filtros anti-SPAM.
// Configurable vía env CRM_BULK_THROTTLE_MS (default 800ms).
const SEND_THROTTLE_MS = (() => {
  const v = parseInt(process.env.CRM_BULK_THROTTLE_MS || "", 10);
  return Number.isFinite(v) && v >= 0 ? v : 800;
})();
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

// Devuelve la firma del usuario `user_id` (o null si no tiene). Soporta el
// flag `force=false` que usan los toggles "incluir firma" del frontend para
// no devolver firma aunque exista.
async function loadUserSignature(user_id, { force = null } = {}) {
  if (!user_id) return null;
  if (force === false) return null;
  try {
    const { UserSignature } = require("../models");
    if (!UserSignature) return null;
    const row = await UserSignature.findOne({ where: { user_id } });
    if (!row) return null;
    if (force === null && row.include_by_default === false) return null;
    return row.toJSON();
  } catch (_) { return null; }
}

// Carga los promo blocks por IDs (en el orden recibido). Filtra inactivos y
// devuelve los campos hidratados desde el producto del catálogo, listos para
// que el layout los renderice como cards.
async function loadPromoBlocksByIds(ids) {
  const arr = Array.isArray(ids) ? ids.map((x) => toInt(x, 0)).filter(Boolean) : [];
  if (!arr.length) return null;
  try {
    const { EmailPromoBlock } = require("../models");
    if (!EmailPromoBlock) return null;
    const rows = await EmailPromoBlock.findAll({ where: { id: arr, active: true } });
    if (!rows.length) return null;

    // Hidratar (cada bloque trae datos live del producto + overrides).
    const promoCtrl = require("./admin.emailPromoBlocks.controller");
    const hydrated = await Promise.all(rows.map((r) => promoCtrl.hydrateBlock(r)));

    // Preservar orden recibido.
    const byId = new Map(hydrated.map((r) => [r.id, r]));
    return arr.map((id) => byId.get(id)).filter(Boolean);
  } catch (e) {
    console.warn("[messaging] loadPromoBlocksByIds:", e?.message);
    return null;
  }
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

    // Firma del comercial: si include_signature viene explícitamente en true/false,
    // respeta el toggle; si no viene, usa include_by_default del UserSignature.
    const includeSignature = req.body?.include_signature;
    const signature = channel === "email"
      ? await loadUserSignature(toInt(req.user?.id, 0), {
          force: typeof includeSignature === "boolean" ? includeSignature : null,
        })
      : null;

    // Bloques promocionales (opcional, sólo email).
    const promoBlocks = channel === "email"
      ? await loadPromoBlocksByIds(req.body?.promo_block_ids)
      : null;

    const includeLocation = req.body?.include_location !== false;

    let result;
    if (channel === "email") {
      result = await emailSvc.sendEmail({
        to,
        toName: ctxData.customer.display_name,
        subject: rendered.subject || "(sin asunto)",
        body: rendered.body,
        signature,
        promoBlocks,
        includeLocation,
      });
    } else {
      const enriched = (promoBlocks?.length || signature || includeLocation)
        ? await waFormatter.formatRichMessage({
            body: rendered.body,
            customer: ctxData.customer,
            promoBlocks,
            signature,
            includeLocation,
          })
        : rendered.body;
      result = await waSvc.sendWhatsApp({
        to,
        body: enriched,
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

    const startedAt = Date.now();

    // Firma + promos resueltas UNA vez (no por cliente).
    const includeSignatureBulk = req.body?.include_signature;
    const bulkSignature = channel === "email"
      ? await loadUserSignature(toInt(req.user?.id, 0), {
          force: typeof includeSignatureBulk === "boolean" ? includeSignatureBulk : null,
        })
      : null;
    const bulkPromos = channel === "email"
      ? await loadPromoBlocksByIds(req.body?.promo_block_ids)
      : null;
    const bulkIncludeLocation = req.body?.include_location !== false;

    const results = [];
    let okCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    const links = []; // wa.me links si aplica

    // Procesamos secuencialmente para no saturar SMTP / Meta API.
    // Para email se introduce un throttle entre destinatarios (ver
    // SEND_THROTTLE_MS) — evita ráfagas que disparan filtros anti-SPAM.
    let processedCount = 0;
    for (const id of ids) {
      // Throttle: esperar antes de procesar el siguiente (excepto el primero).
      // Sólo aplica a email — para WhatsApp con link manual no tiene sentido,
      // y para Cloud API la latencia natural ya espacia los envíos.
      if (processedCount > 0 && channel === "email" && SEND_THROTTLE_MS > 0) {
        await sleep(SEND_THROTTLE_MS);
      }
      processedCount++;

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
            signature: bulkSignature,
            promoBlocks: bulkPromos,
            includeLocation: bulkIncludeLocation,
            isBulk: ids.length > 1,
          });
        } else {
          // WhatsApp: si hay promos / firma / pedimos ubicación, formateamos
          // el mensaje rico (markdown WhatsApp + emojis + separadores) en
          // lugar de mandar solo el body crudo.
          const enriched = (bulkPromos?.length || bulkSignature || bulkIncludeLocation)
            ? await waFormatter.formatRichMessage({
                body: rendered.body,
                customer: ctxData.customer,
                promoBlocks: bulkPromos,
                signature: bulkSignature,
                includeLocation: bulkIncludeLocation,
              })
            : rendered.body;
          result = await waSvc.sendWhatsApp({ to, body: enriched, preferLink });
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
        duration_ms: Date.now() - startedAt,
        throttle_ms: channel === "email" ? SEND_THROTTLE_MS : 0,
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

// ============================================================
// TEST EMAIL — manda un email de prueba a una dirección suelta
// para verificar que el SMTP esté correctamente configurado.
// No requiere customer ni plantilla: el admin escribe a quién, asunto y body.
// ============================================================
async function testEmail(req, res, next) {
  try {
    if (!gateAdmin(req, res)) return;
    await ensureTables();

    const to = s(req.body?.to);
    const subject = s(req.body?.subject) || "Prueba de envío POS360";
    const body = s(req.body?.body) || "Este es un email de prueba para verificar la configuración SMTP.";

    if (!to) {
      return res.status(400).json({
        ok: false,
        code: "TO_REQUIRED",
        message: "Falta el destinatario.",
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_EMAIL",
        message: "El email no parece válido.",
      });
    }

    // Verificar SMTP antes de intentar enviar (mejor mensaje de error).
    const ping = await emailSvc.ping();
    if (!ping.ok) {
      return res.status(503).json({
        ok: false,
        code: ping.code || "SMTP_UNAVAILABLE",
        message: ping.error || "SMTP no responde. Revisá las variables SMTP_* en CapRover.",
      });
    }

    // Logueamos el envío de prueba (sin customer_id porque es libre).
    const log = await MessageLog.create({
      customer_id: null,
      channel: "email",
      template_id: null,
      to_address: to,
      to_name: null,
      subject,
      body,
      status: "queued",
      sent_by: toInt(req.user?.id, 0) || null,
    });

    const result = await emailSvc.sendEmail({ to, subject, body });

    await log.update({
      status: result.ok ? "sent" : "failed",
      provider: result.provider || null,
      provider_msg_id: result.message_id || null,
      error_message: result.error_message || null,
      sent_at: result.ok ? new Date() : null,
    });

    if (!result.ok) {
      return res.status(502).json({
        ok: false,
        code: result.code || "SMTP_SEND_FAILED",
        message: result.error_message || "No se pudo enviar el email.",
        log_id: log.id,
      });
    }

    return res.json({
      ok: true,
      data: {
        log_id: log.id,
        provider: result.provider,
        message_id: result.message_id,
        to,
        subject,
      },
      message: `Email enviado a ${to}. Revisá la bandeja del destinatario (y spam).`,
    });
  } catch (e) {
    next(e);
  }
}

// ============================================================
// PREVIEW HTML DEL LAYOUT (sin enviar nada)
// Devuelve el HTML completo wrappeado para que el frontend lo muestre en un
// iframe / nueva pestaña. Útil para diseñar plantillas viendo cómo van a
// llegar realmente.
// ============================================================
// Preview del mensaje formateado de WhatsApp (texto plano con markdown
// WhatsApp). El frontend lo muestra en un mockup tipo burbuja.
async function previewWhatsApp(req, res, next) {
  try {
    if (!gateAdmin(req, res)) return;

    const body = String(req.body?.body || "").trim();
    const includeSignature = req.body?.include_signature;
    const includeLocation = req.body?.include_location !== false;
    const customer_id = toInt(req.body?.customer_id, 0);

    let customer = null;
    if (customer_id) {
      const data = await loadCustomerWithStats(customer_id);
      customer = data?.customer || null;
    } else {
      // Demo: cliente ficticio para que el saludo aparezca personalizado.
      customer = { first_name: "Ana", display_name: "Ana López" };
    }

    const signature = await loadUserSignature(toInt(req.user?.id, 0), {
      force: typeof includeSignature === "boolean" ? includeSignature : null,
    });
    const promoBlocks = await loadPromoBlocksByIds(req.body?.promo_block_ids);

    const message = await waFormatter.formatRichMessage({
      body,
      customer,
      promoBlocks,
      signature,
      includeLocation,
    });

    return res.json({ ok: true, data: { message } });
  } catch (e) { next(e); }
}

async function previewLayout(req, res) {
  if (!gateAdmin(req, res)) return;
  const subject = s(req.body?.subject) || "Vista previa";
  const body = s(req.body?.body) || "<p>Contenido de ejemplo. Acá va el cuerpo de tu mensaje.</p>";

  const includeSignature = req.body?.include_signature;
  const signature = await loadUserSignature(toInt(req.user?.id, 0), {
    force: typeof includeSignature === "boolean" ? includeSignature : null,
  });
  const promoBlocks = await loadPromoBlocksByIds(req.body?.promo_block_ids);
  const includeLocation = req.body?.include_location !== false;

  const html = await layoutSvc.wrap({
    body, subject,
    previewText: req.body?.preview_text,
    signature, promoBlocks, includeLocation,
  });
  const branding = await layoutSvc.getBranding();
  res.json({ ok: true, data: { html, branding } });
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
  testEmail,
  previewLayout,
  previewWhatsApp,
};
