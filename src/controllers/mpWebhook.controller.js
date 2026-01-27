// src/controllers/mpWebhook.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (SIN AXIOS) — Webhook MercadoPago robusto
//
// Objetivo:
// - Recibir notificaciones de MP (payment / merchant_order)
// - Consultar el detalle a MP vía API (fetch nativo Node 20)
// - Actualizar ecom_payments + ecom_orders según status
//
// ENV requeridas:
// - MERCADOPAGO_ACCESS_TOKEN
//
// Opcionales:
// - MP_WEBHOOK_LOG_PAYLOAD=1  (loggea body completo)
// - MP_WEBHOOK_STRICT=1       (si falta topic/id => 400)
//
// Tablas esperadas (mínimo):
// - ecom_payments: id, provider, status, external_id, external_reference, external_status, status_detail,
//                 external_payload (JSON), payer_email, mp_preference_id, updated_at
// - ecom_orders: id, payment_status, status, updated_at
//
// NOTA:
// - Este controller no depende de rutas específicas. Lo podés montar en:
//   POST /api/v1/ecom/webhooks/mercadopago

const crypto = require("crypto");
const { sequelize } = require("../models");

// ---------------------
// helpers
// ---------------------
function reqId() {
  return crypto.randomBytes(8).toString("hex");
}
function toStr(v) {
  return String(v ?? "").trim();
}
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function log(rid, ...args) {
  console.log(`[MP WEBHOOK] [${rid}]`, ...args);
}

function mpToken() {
  return toStr(process.env.MERCADOPAGO_ACCESS_TOKEN);
}

async function mpGetJson(url, rid) {
  const token = mpToken();
  if (!token) {
    const err = new Error("Falta MERCADOPAGO_ACCESS_TOKEN");
    err.code = "MP_TOKEN_MISSING";
    throw err;
  }

  const r = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "pos360-commerce-api/1.0",
      "X-Request-Id": rid,
    },
  });

  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!r.ok) {
    const err = new Error(`MP API error ${r.status}`);
    err.statusCode = r.status;
    err.payload = json || text;
    err.code = "MP_API_ERROR";
    throw err;
  }

  return json;
}

// Deriva paymentId/topic/id desde distintas formas que manda MP
function parseMpNotification(req) {
  // MP a veces manda por query:
  // ?type=payment&data.id=123
  // ?topic=payment&id=123
  // o body json con { type, data: { id } }
  const q = req.query || {};
  const b = req.body || {};

  const type =
    toStr(q.type) ||
    toStr(q.topic) ||
    toStr(b.type) ||
    toStr(b.topic) ||
    toStr(b.action); // a veces viene action

  const dataId =
    toStr(q["data.id"]) ||
    toStr(q["data_id"]) ||
    toStr(q["id"]) ||
    toStr(b?.data?.id) ||
    toStr(b?.data_id) ||
    toStr(b?.id);

  // Normalizamos topic/type
  const t = toStr(type).toLowerCase();
  let topic = "";
  if (t.includes("payment")) topic = "payment";
  else if (t.includes("merchant_order") || t.includes("merchantorder")) topic = "merchant_order";
  else topic = t || "";

  return { topic, id: dataId };
}

function mapPaymentStatus(mpStatus) {
  const s = toStr(mpStatus).toLowerCase();
  // MP statuses comunes: approved, pending, in_process, rejected, cancelled, refunded, charged_back
  if (s === "approved") return "paid";
  if (s === "pending" || s === "in_process") return "pending";
  if (s === "refunded" || s === "charged_back") return "refunded";
  if (s === "cancelled") return "cancelled";
  if (s === "rejected") return "rejected";
  return "pending";
}

async function findPaymentByMpExternal({ mp_payment_id, external_reference, t }) {
  // 1) match por external_id
  if (mp_payment_id) {
    const [rows] = await sequelize.query(
      `
      SELECT id, order_id, provider
      FROM ecom_payments
      WHERE (external_id = :external_id OR mp_payment_id = :external_id)
      LIMIT 1
      `,
      { replacements: { external_id: String(mp_payment_id) }, transaction: t }
    );
    if (rows?.length) return rows[0];
  }

  // 2) match por external_reference (public_code)
  if (external_reference) {
    const [rows] = await sequelize.query(
      `
      SELECT id, order_id, provider
      FROM ecom_payments
      WHERE external_reference = :external_reference
      ORDER BY id DESC
      LIMIT 1
      `,
      { replacements: { external_reference: String(external_reference) }, transaction: t }
    );
    if (rows?.length) return rows[0];
  }

  return null;
}

async function updatePaymentAndOrder({ paymentRow, mp, mappedStatus, rid, t }) {
  const payment_id = Number(paymentRow.id);
  const order_id = Number(paymentRow.order_id);

  // Datos relevantes
  const mp_payment_id = mp?.id ? String(mp.id) : null;
  const external_reference = mp?.external_reference ? String(mp.external_reference) : null;
  const mp_status = toStr(mp?.status);
  const mp_status_detail = toStr(mp?.status_detail);
  const payer_email = toStr(mp?.payer?.email || mp?.payer_email || "");

  await sequelize.query(
    `
    UPDATE ecom_payments
    SET
      provider = 'mercadopago',
      status = :status,
      external_id = COALESCE(:external_id, external_id),
      external_reference = COALESCE(:external_reference, external_reference),
      external_status = :external_status,
      status_detail = :status_detail,
      payer_email = COALESCE(NULLIF(:payer_email,''), payer_email),
      external_payload = JSON_SET(COALESCE(external_payload, JSON_OBJECT()),
                                 '$.mp_payment', CAST(:mp_payload AS JSON)),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = :id
    `,
    {
      replacements: {
        id: payment_id,
        status: mappedStatus,
        external_id: mp_payment_id,
        external_reference,
        external_status: mp_status || null,
        status_detail: mp_status_detail || null,
        payer_email,
        mp_payload: JSON.stringify(mp || {}),
      },
      transaction: t,
    }
  );

  // Orden: payment_status coherente
  let orderPaymentStatus = mappedStatus;
  if (mappedStatus === "paid") orderPaymentStatus = "paid";
  else if (mappedStatus === "pending") orderPaymentStatus = "pending";
  else orderPaymentStatus = "unpaid";

  await sequelize.query(
    `
    UPDATE ecom_orders
    SET
      payment_status = :payment_status,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = :id
    `,
    {
      replacements: { id: order_id, payment_status: orderPaymentStatus },
      transaction: t,
    }
  );

  log(rid, "updated", { payment_id, order_id, mp_payment_id, mp_status, mappedStatus });
}

// ---------------------
// Controller
// ---------------------
async function mercadopagoWebhook(req, res) {
  const rid = reqId();

  const strict = toStr(process.env.MP_WEBHOOK_STRICT) === "1";
  const logPayload = toStr(process.env.MP_WEBHOOK_LOG_PAYLOAD) === "1";

  const { topic, id } = parseMpNotification(req);

  log(rid, "incoming", {
    method: req.method,
    path: req.originalUrl,
    topic,
    id,
    hasBody: !!req.body,
  });

  if (logPayload) {
    log(rid, "payload.body=", req.body || null);
    log(rid, "payload.query=", req.query || null);
  }

  if (strict && (!topic || !id)) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_WEBHOOK",
      message: "Falta topic/type o id/data.id",
      rid,
    });
  }

  // Si no puedo determinar -> ACK 200 igual (MP reintenta, pero no quiero tumbar)
  if (!topic || !id) {
    return res.status(200).json({ ok: true, rid, ignored: true });
  }

  try {
    // 1) Consultar a MP
    let mpData = null;

    if (topic === "payment") {
      mpData = await mpGetJson(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, rid);
    } else if (topic === "merchant_order") {
      // merchant order: traemos la orden y, si tiene payments, tomamos el último
      const mo = await mpGetJson(
        `https://api.mercadopago.com/merchant_orders/${encodeURIComponent(id)}`,
        rid
      );
      const lastPay = Array.isArray(mo?.payments) && mo.payments.length ? mo.payments[mo.payments.length - 1] : null;
      if (lastPay?.id) {
        mpData = await mpGetJson(
          `https://api.mercadopago.com/v1/payments/${encodeURIComponent(lastPay.id)}`,
          rid
        );
      } else {
        mpData = mo; // fallback
      }
    } else {
      // topic desconocido => ACK
      return res.status(200).json({ ok: true, rid, ignored: true, topic });
    }

    // 2) Derivar ids para matchear ecom_payments
    const mp_payment_id = mpData?.id ? String(mpData.id) : null;
    const external_reference = mpData?.external_reference ? String(mpData.external_reference) : null;

    const mappedStatus = mapPaymentStatus(mpData?.status);

    // 3) Update DB
    const out = await sequelize.transaction(async (t) => {
      const payRow = await findPaymentByMpExternal({ mp_payment_id, external_reference, t });

      if (!payRow?.id) {
        log(rid, "payment not found", { mp_payment_id, external_reference });
        // ACK 200 para que MP no te haga retry infinito
        return { ok: true, rid, not_found: true, mp_payment_id, external_reference };
      }

      await updatePaymentAndOrder({ paymentRow: payRow, mp: mpData, mappedStatus, rid, t });

      return { ok: true, rid, updated: true, mappedStatus, payment_id: payRow.id, order_id: payRow.order_id };
    });

    return res.status(200).json(out);
  } catch (e) {
    const status = Number(e?.statusCode || 200); // Importante: a MP conviene responder 200 para que no te “castigue”
    log(rid, "ERROR", { message: e?.message || String(e), statusCode: e?.statusCode, payload: e?.payload || null });

    return res.status(status).json({
      ok: false,
      rid,
      code: e?.code || "WEBHOOK_ERROR",
      message: "Error procesando webhook MercadoPago",
      detail: e?.payload || e?.message || String(e),
    });
  }
}

module.exports = { mercadopagoWebhook };
