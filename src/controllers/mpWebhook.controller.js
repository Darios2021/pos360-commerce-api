// src/controllers/mpWebhook.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (Mercado Pago Webhook ROBUSTO + LOGS + DB sync)
//
// Mount sugerido (routes):
// POST /api/v1/ecom/mp/webhook
// GET  /api/v1/ecom/mp/webhook   (health/ping)
//
// Qué hace:
// - Recibe notificaciones de MP (payment / merchant_order / etc.)
// - Si puede extraer payment_id => consulta MP API (server-side) y sincroniza:
//   - ecom_payments (provider=mercadopago): status/external_status/status_detail/external_payload/payer_email/external_id
//   - ecom_orders.payment_status (unpaid|pending|paid|failed)
// - Idempotente y con logs por request_id
//
// Requiere ENV:
// - MERCADOPAGO_ACCESS_TOKEN
//
// Opcional (seguridad):
// - MP_WEBHOOK_SECRET  (si está seteado, valida firma X-Signature + X-Request-Id)
//   Si no está, procesa igual (pero deja log WARNING).
//
// Notas:
// - MP suele mandar:
//   - query: ?type=payment&data.id=123
//   - o body: { type:"payment", data:{ id:"123" } }
// - Este controlador soporta varios formatos.

const crypto = require("crypto");
const axios = require("axios");
const { sequelize } = require("../models");

// =====================
// Helpers
// =====================
function reqId() {
  return crypto.randomBytes(8).toString("hex");
}

function log(rid, ...args) {
  console.log(`[MP WEBHOOK] [${rid}]`, ...args);
}

function toStr(v) {
  return String(v ?? "").trim();
}

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function safeJson(v) {
  try {
    return v && typeof v === "object" ? v : JSON.parse(String(v));
  } catch {
    return null;
  }
}

// Extrae payment_id de query/body
function extractPaymentId(req) {
  // query style
  const qDataId = req?.query?.["data.id"] || req?.query?.["data_id"] || req?.query?.data_id;
  const qId = req?.query?.id;

  // body style
  const b = req?.body || {};
  const bDataId = b?.data?.id || b?.data_id || b?.dataId;
  const bId = b?.id;

  const id = qDataId || bDataId || qId || bId;
  const pid = toInt(id, 0);

  return pid > 0 ? pid : null;
}

function extractType(req) {
  const qType = req?.query?.type || req?.query?.topic;
  const bType = req?.body?.type || req?.body?.topic;
  return String(qType || bType || "").trim().toLowerCase();
}

// =====================
// (Opcional) Firma Webhook
// =====================
//
// MP envía headers típicos:
// - x-signature: "ts=...,v1=..."
// - x-request-id: "...uuid..."
// Y se valida con tu secret (MP_WEBHOOK_SECRET)
//
// Como MP puede cambiar formatos, esto es "best-effort":
// - Si MP_WEBHOOK_SECRET NO está => no bloquea (solo log warning).
// - Si está => valida y si falla => 401.
//
function parseXSignature(xSignature) {
  const out = { ts: "", v1: "" };
  const s = String(xSignature || "").trim();
  // formato: ts=1700000000,v1=abcdef...
  for (const part of s.split(",")) {
    const [k, v] = part.split("=").map((x) => String(x || "").trim());
    if (k === "ts") out.ts = v || "";
    if (k === "v1") out.v1 = v || "";
  }
  return out;
}

function timingSafeEq(a, b) {
  try {
    const ba = Buffer.from(String(a || ""), "utf8");
    const bb = Buffer.from(String(b || ""), "utf8");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

// Construcción típica de firma (según docs de MP para webhooks):
// HMAC-SHA256(secret, `${ts}.${requestId}.${rawBody}`) o variantes.
// Como en Node/Express normalmente no tenemos rawBody por defecto,
// hacemos una validación "segura pero no frágil":
// - Firmamos `${ts}.${requestId}.${JSON.stringify(body)}`
// Si querés 100% exacto, tenés que capturar rawBody en middleware.
// Este esquema igual te sirve para detectar la mayoría de falsificaciones
// cuando vos controlás el pipeline.
function verifyWebhookSignature(req, rid) {
  const secret = toStr(process.env.MP_WEBHOOK_SECRET);
  if (!secret) {
    log(rid, "⚠️ MP_WEBHOOK_SECRET no seteado: webhook sin verificación de firma.");
    return { ok: true, skipped: true };
  }

  const xSig = req?.headers?.["x-signature"] || req?.headers?.["X-Signature"];
  const xReqId = req?.headers?.["x-request-id"] || req?.headers?.["X-Request-Id"];

  const { ts, v1 } = parseXSignature(xSig);
  const requestId = toStr(xReqId);

  if (!ts || !v1 || !requestId) {
    return { ok: false, reason: "MISSING_SIGNATURE_HEADERS" };
  }

  const bodyStr = JSON.stringify(req?.body || {});
  const payload = `${ts}.${requestId}.${bodyStr}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  const ok = timingSafeEq(expected, v1);
  return ok ? { ok: true } : { ok: false, reason: "INVALID_SIGNATURE" };
}

// =====================
// MP API (server-side)
// =====================
async function mpGetPayment(paymentId) {
  const token = toStr(process.env.MERCADOPAGO_ACCESS_TOKEN);
  if (!token) {
    const err = new Error("Falta MERCADOPAGO_ACCESS_TOKEN");
    err.statusCode = 400;
    err.code = "MP_TOKEN_MISSING";
    throw err;
  }

  const url = `https://api.mercadopago.com/v1/payments/${paymentId}`;
  const { data } = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    timeout: 20000,
  });
  return data;
}

function mapMpToInternal(mpStatus, mpStatusDetail) {
  const s = String(mpStatus || "").toLowerCase();
  const d = String(mpStatusDetail || "").toLowerCase();

  // internal: created|pending|paid|failed
  // order.payment_status: unpaid|pending|paid|failed
  if (s === "approved") return { payStatus: "paid", orderPayStatus: "paid", detail: d || "approved" };

  if (s === "in_process" || s === "pending") return { payStatus: "pending", orderPayStatus: "pending", detail: d || s };

  if (s === "authorized") return { payStatus: "pending", orderPayStatus: "pending", detail: d || "authorized" };

  if (s === "rejected" || s === "cancelled" || s === "refunded" || s === "charged_back") {
    return { payStatus: "failed", orderPayStatus: "failed", detail: d || s };
  }

  // fallback conservador
  return { payStatus: "pending", orderPayStatus: "pending", detail: d || s || "unknown" };
}

async function findPaymentRow({ mpPaymentId, mpExternalReference }, t) {
  // 1) Por external_id (mp payment id)
  if (mpPaymentId) {
    const [r1] = await sequelize.query(
      `
      SELECT id, order_id
      FROM ecom_payments
      WHERE provider='mercadopago'
        AND (external_id = :mp_payment_id OR external_id = :mp_payment_id_str)
      ORDER BY id DESC
      LIMIT 1
      `,
      {
        replacements: {
          mp_payment_id: Number(mpPaymentId),
          mp_payment_id_str: String(mpPaymentId),
        },
        transaction: t,
      }
    );
    if (r1 && r1.length) return { payment_id: Number(r1[0].id), order_id: Number(r1[0].order_id) };
  }

  // 2) Por external_reference (public_code) y provider mercadopago
  if (mpExternalReference) {
    const [r2] = await sequelize.query(
      `
      SELECT id, order_id
      FROM ecom_payments
      WHERE provider='mercadopago'
        AND external_reference = :ext
      ORDER BY id DESC
      LIMIT 1
      `,
      { replacements: { ext: String(mpExternalReference) }, transaction: t }
    );
    if (r2 && r2.length) return { payment_id: Number(r2[0].id), order_id: Number(r2[0].order_id) };
  }

  return { payment_id: null, order_id: null };
}

async function updatePaymentFromMp({ payment_id, mp, internalPayStatus, statusDetail, t }) {
  if (!payment_id) return;

  const payerEmail = toStr(mp?.payer?.email || mp?.payer_email || "");

  // Guardamos payload completo en external_payload
  const mpPayloadStr = JSON.stringify(mp || {});

  await sequelize.query(
    `
    UPDATE ecom_payments
    SET
      status = :status,
      external_id = :external_id,
      external_status = :external_status,
      status_detail = :status_detail,
      payer_email = COALESCE(NULLIF(:payer_email,''), payer_email),
      external_reference = COALESCE(NULLIF(:external_reference,''), external_reference),
      external_payload = JSON_SET(COALESCE(external_payload, JSON_OBJECT()), '$.mp_payment', CAST(:mp_payload AS JSON)),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = :id
    `,
    {
      replacements: {
        id: payment_id,
        status: internalPayStatus,
        external_id: mp?.id ? String(mp.id) : null,
        external_status: toStr(mp?.status || "") || null,
        status_detail: toStr(statusDetail || "") || null,
        payer_email: payerEmail ? payerEmail.toLowerCase() : "",
        external_reference: toStr(mp?.external_reference || ""),
        mp_payload: mpPayloadStr,
      },
      transaction: t,
    }
  );
}

async function updateOrderPaymentStatus({ order_id, orderPayStatus, t }) {
  if (!order_id) return;

  await sequelize.query(
    `
    UPDATE ecom_orders
    SET payment_status = :payment_status,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :id
    `,
    {
      replacements: { id: order_id, payment_status: String(orderPayStatus || "pending").toLowerCase() },
      transaction: t,
    }
  );
}

// =====================
// Controllers
// =====================
async function mpWebhook(req, res) {
  const request_id = reqId();

  // 1) Firma (opcional)
  const sig = verifyWebhookSignature(req, request_id);
  if (!sig.ok) {
    log(request_id, "❌ signature invalid:", sig.reason);
    return res.status(401).json({ ok: false, code: sig.reason || "INVALID_SIGNATURE", request_id });
  }

  const type = extractType(req);
  const paymentId = extractPaymentId(req);

  log(request_id, "IN", {
    type,
    paymentId,
    query: req?.query || {},
    body_keys: Object.keys(req?.body || {}),
  });

  // Respuesta rápida si no hay payment id (no rompemos)
  if (!paymentId) {
    log(request_id, "⚠️ No paymentId found. ACK.");
    return res.json({ ok: true, request_id, ack: true, note: "no payment id" });
  }

  try {
    // 2) Consultar pago real en MP
    let mp;
    try {
      mp = await mpGetPayment(paymentId);
    } catch (mpErr) {
      const status = Number(mpErr?.response?.status || mpErr?.statusCode || 502);
      const payload = mpErr?.response?.data || mpErr?.payload || mpErr?.message || String(mpErr);

      log(request_id, "❌ MP API error", { status, payload });

      // Igual devolvemos 200 para que MP no reintente en loop infinito si tu token está mal,
      // pero lo dejamos auditado en logs.
      return res.status(200).json({ ok: true, request_id, ack: true, mp_error: { status, payload } });
    }

    const mpStatus = toStr(mp?.status);
    const mpStatusDetail = toStr(mp?.status_detail);
    const mpExternalReference = toStr(mp?.external_reference);

    const { payStatus, orderPayStatus, detail } = mapMpToInternal(mpStatus, mpStatusDetail);

    log(request_id, "MP payment fetched", {
      mp_id: mp?.id,
      mp_status: mpStatus,
      mp_detail: mpStatusDetail,
      ext_ref: mpExternalReference,
      mapped: { payStatus, orderPayStatus, detail },
    });

    // 3) Sync DB
    const synced = await sequelize.transaction(async (t) => {
      const { payment_id, order_id } = await findPaymentRow(
        { mpPaymentId: paymentId, mpExternalReference: mpExternalReference },
        t
      );

      if (!payment_id || !order_id) {
        // No encontramos registro todavía: igual guardamos ack y listo.
        // Puede pasar si MP notifica antes de que guardes payment_id (raro) o si cambiaste external_reference.
        log(request_id, "⚠️ No DB row found for MP payment", { paymentId, mpExternalReference });
        return { found: false, payment_id: payment_id || null, order_id: order_id || null };
      }

      await updatePaymentFromMp({
        payment_id,
        mp,
        internalPayStatus: payStatus,
        statusDetail: detail,
        t,
      });

      await updateOrderPaymentStatus({ order_id, orderPayStatus, t });

      return { found: true, payment_id, order_id, payStatus, orderPayStatus };
    });

    log(request_id, "OK synced", synced);
    return res.json({ ok: true, request_id, synced });
  } catch (e) {
    log(request_id, "FATAL", e?.message || String(e));
    // ACK 200 para no reintentos eternos, pero lo dejamos logueado
    return res.status(200).json({ ok: true, request_id, ack: true, error: e?.message || String(e) });
  }
}

async function mpWebhookHealth(req, res) {
  return res.json({ ok: true, service: "mp-webhook", ts: new Date().toISOString() });
}

module.exports = {
  mpWebhook,
  mpWebhookHealth,
};
