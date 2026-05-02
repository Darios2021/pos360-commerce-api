// src/controllers/mpWebhook.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (DB-FIRST + Node20 fetch) — Webhook MercadoPago robusto
//
// Ruta esperada:
// POST /api/v1/ecom/webhooks/mercadopago
//
// ENV:
// - MP_MODE=test|prod
// - MERCADOPAGO_ACCESS_TOKEN_TEST
// - MERCADOPAGO_ACCESS_TOKEN_PROD
// - MP_WEBHOOK_SECRET      ← secreto del panel MP para verificar firma (recomendado)
//
// Opcionales:
// - MP_WEBHOOK_LOG_PAYLOAD=1
// - MP_WEBHOOK_STRICT=1    ← rechaza si firma inválida o falta topic/id
//
// FIX #2 — Verificación de firma HMAC-SHA256 (2026-04-22):
// - Verifica header x-signature contra MP_WEBHOOK_SECRET
// - Si no hay secret: advierte pero procesa (retrocompatible)
// - Si strict=1 y firma inválida: rechaza con 401

const crypto = require("crypto");
const { sequelize } = require("../models");

function reqId() {
  return crypto.randomBytes(8).toString("hex");
}
function toStr(v) {
  return String(v ?? "").trim();
}
function lower(v) {
  return toStr(v).toLowerCase();
}
function log(rid, ...args) {
  console.log(`[MP WEBHOOK] [${rid}]`, ...args);
}

function normalizeMode(v) {
  const m = lower(v);
  if (m === "test" || m === "sandbox") return "test";
  if (m === "prod" || m === "production" || m === "live") return "prod";
  return "";
}
function getMpMode() {
  return normalizeMode(process.env.MP_MODE) || "prod";
}
function mpToken() {
  const mode = getMpMode();
  const tok =
    mode === "test"
      ? toStr(process.env.MERCADOPAGO_ACCESS_TOKEN_TEST)
      : toStr(process.env.MERCADOPAGO_ACCESS_TOKEN_PROD);

  if (tok) return tok;

  // fallback legacy
  return toStr(process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN);
}

async function mpGetJson(url, rid) {
  const token = mpToken();
  if (!token) {
    const err = new Error("Falta token MercadoPago (TEST/PROD)");
    err.code = "MP_TOKEN_MISSING";
    err.detail = {
      MP_MODE: getMpMode(),
      missing: getMpMode() === "test" ? "MERCADOPAGO_ACCESS_TOKEN_TEST" : "MERCADOPAGO_ACCESS_TOKEN_PROD",
    };
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

/**
 * Verifica la firma HMAC-SHA256 del webhook de MercadoPago.
 * Docs: https://www.mercadopago.com.ar/developers/es/docs/notifications/webhooks/webhooks-verification
 *
 * Header x-signature: "ts=<timestamp>,v1=<hash>"
 * Mensaje firmado:    "id:{data_id};request-id:{x-request-id};ts:{timestamp};"
 *
 * @returns {true}  firma válida
 * @returns {false} firma presente pero inválida
 * @returns {null}  MP_WEBHOOK_SECRET no configurado (no se puede verificar)
 */
function verifyMpSignature(req, dataId) {
  const secret = toStr(process.env.MP_WEBHOOK_SECRET);
  if (!secret) return null; // sin secret → no verificable

  const xSignature = toStr(req.headers["x-signature"]);
  if (!xSignature) return false;

  const xRequestId = toStr(req.headers["x-request-id"]);

  // Parsear ts y v1 del header "ts=...,v1=..."
  let ts = "";
  let v1 = "";
  for (const part of xSignature.split(",")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const k = part.slice(0, eqIdx).trim();
    const v = part.slice(eqIdx + 1).trim();
    if (k === "ts") ts = v;
    if (k === "v1") v1 = v;
  }

  if (!ts || !v1) return false;

  // Construir el mensaje según la spec de MP
  const parts = [];
  if (dataId) parts.push(`id:${dataId}`);
  if (xRequestId) parts.push(`request-id:${xRequestId}`);
  parts.push(`ts:${ts}`);
  const message = parts.join(";") + ";";

  const expected = crypto.createHmac("sha256", secret).update(message).digest("hex");

  // Comparación timing-safe para evitar timing attacks
  try {
    const bufExpected = Buffer.from(expected, "hex");
    const bufReceived = Buffer.from(v1, "hex");
    if (bufExpected.length !== bufReceived.length) return false;
    return crypto.timingSafeEqual(bufExpected, bufReceived);
  } catch {
    return false;
  }
}

function parseMpNotification(req) {
  const q = req.query || {};
  const b = req.body || {};

  const type =
    toStr(q.type) || toStr(q.topic) || toStr(b.type) || toStr(b.topic) || toStr(b.action);

  const dataId =
    toStr(q["data.id"]) ||
    toStr(q["data_id"]) ||
    toStr(q["id"]) ||
    toStr(b?.data?.id) ||
    toStr(b?.data_id) ||
    toStr(b?.id);

  const t = toStr(type).toLowerCase();
  let topic = "";
  if (t.includes("payment")) topic = "payment";
  else if (t.includes("merchant_order") || t.includes("merchantorder")) topic = "merchant_order";
  else topic = t || "";

  return { topic, id: dataId };
}

function mapMpStatusToLocalPaymentStatus(mpStatus) {
  const s = toStr(mpStatus).toLowerCase();
  if (s === "approved") return "approved";
  if (s === "pending" || s === "in_process") return "pending";
  if (s === "rejected") return "rejected";
  if (s === "cancelled") return "cancelled";
  if (s === "refunded") return "refunded";
  if (s === "charged_back") return "chargeback";
  return s || "pending";
}

function mapLocalToOrderPaymentStatus(localPayStatus) {
  const s = toStr(localPayStatus).toLowerCase();
  if (s === "approved") return "paid";
  if (s === "pending") return "pending";
  return "unpaid";
}

function isApproved(localPayStatus) {
  return toStr(localPayStatus).toLowerCase() === "approved";
}

async function findPaymentByMpExternal({ mp_payment_id, external_id, external_reference, t }) {
  if (mp_payment_id) {
    const [rows] = await sequelize.query(
      `
      SELECT id, order_id
      FROM ecom_payments
      WHERE mp_payment_id = :v
      ORDER BY id DESC
      LIMIT 1
      `,
      { replacements: { v: String(mp_payment_id) }, transaction: t }
    );
    if (rows?.length) return rows[0];
  }

  if (external_id) {
    const [rows] = await sequelize.query(
      `
      SELECT id, order_id
      FROM ecom_payments
      WHERE external_id = :v
      ORDER BY id DESC
      LIMIT 1
      `,
      { replacements: { v: String(external_id) }, transaction: t }
    );
    if (rows?.length) return rows[0];
  }

  if (external_reference) {
    const [rows] = await sequelize.query(
      `
      SELECT p.id, p.order_id
      FROM ecom_payments p
      JOIN ecom_orders o ON o.id = p.order_id
      WHERE o.public_code = :code
      ORDER BY p.id DESC
      LIMIT 1
      `,
      { replacements: { code: String(external_reference) }, transaction: t }
    );
    if (rows?.length) return rows[0];
  }

  return null;
}

async function updatePaymentAndOrder({ paymentRow, mp, merchantOrderId, localPayStatus, rid, t }) {
  const payment_id = Number(paymentRow.id);
  const order_id = Number(paymentRow.order_id);

  const mp_payment_id = mp?.id ? String(mp.id) : null;
  const external_reference = mp?.external_reference ? String(mp.external_reference) : null;

  const mp_status = toStr(mp?.status);
  const mp_status_detail = toStr(mp?.status_detail);
  const payer_email = toStr(mp?.payer?.email || mp?.payer_email || "");

  const approved = isApproved(localPayStatus);

  await sequelize.query(
    `
    UPDATE ecom_payments
    SET
      provider = 'mercadopago',
      status = :status,

      mp_payment_id = COALESCE(:mp_payment_id, mp_payment_id),
      mp_merchant_order_id = COALESCE(:mp_merchant_order_id, mp_merchant_order_id),

      external_id = COALESCE(:external_id, external_id),
      external_reference = COALESCE(:external_reference, external_reference),

      external_status = :external_status,
      status_detail = :status_detail,
      payer_email = COALESCE(NULLIF(:payer_email,''), payer_email),

      external_payload = JSON_SET(
        COALESCE(external_payload, JSON_OBJECT()),
        '$.mp_payment',
        CAST(:mp_payload AS JSON)
      ),

      paid_at = CASE
        WHEN :approved = 1 THEN COALESCE(paid_at, CURRENT_TIMESTAMP)
        ELSE paid_at
      END,

      updated_at = CURRENT_TIMESTAMP
    WHERE id = :id
    `,
    {
      replacements: {
        id: payment_id,
        status: localPayStatus,
        mp_payment_id,
        mp_merchant_order_id: merchantOrderId ? String(merchantOrderId) : null,
        external_id: mp_payment_id,
        external_reference,
        external_status: mp_status || null,
        status_detail: mp_status_detail || null,
        payer_email,
        mp_payload: JSON.stringify(mp || {}),
        approved: approved ? 1 : 0,
      },
      transaction: t,
    }
  );

  const orderPaymentStatus = mapLocalToOrderPaymentStatus(localPayStatus);

  await sequelize.query(
    `
    UPDATE ecom_orders
    SET
      payment_status = :payment_status,
      paid_at = CASE
        WHEN :approved = 1 THEN COALESCE(paid_at, CURRENT_TIMESTAMP)
        ELSE paid_at
      END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = :id
    `,
    {
      replacements: {
        id: order_id,
        payment_status: orderPaymentStatus,
        approved: approved ? 1 : 0,
      },
      transaction: t,
    }
  );

  log(rid, "updated", {
    payment_id,
    order_id,
    mp_payment_id,
    merchantOrderId: merchantOrderId || null,
    mp_status,
    localPayStatus,
    orderPaymentStatus,
  });

  // NOTA: ya no restauramos stock acá. Como ecomCheckout no descuenta
  // al crear la orden (lo hace el admin al "Concretar pedido" desde
  // back office), no hay nada que restaurar si MP rechaza/cancela.
  // Si el admin ya concretó y después MP rechaza, el operador debe
  // hacer la nota de crédito manualmente.
}

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

  // FIX #2 — Verificar firma HMAC-SHA256 del header x-signature
  const signatureResult = verifyMpSignature(req, id);
  if (signatureResult === null) {
    // MP_WEBHOOK_SECRET no configurado → advertencia, continúa
    log(rid, "⚠️ MP_WEBHOOK_SECRET no configurado — firma no verificada. Configurá la variable en .env");
  } else if (signatureResult === false) {
    // Firma presente pero inválida
    log(rid, "SIGNATURE_INVALID", {
      xSignature: req.headers["x-signature"] || null,
      dataId: id,
    });
    if (strict) {
      return res.status(401).json({
        ok: false,
        code: "INVALID_SIGNATURE",
        message: "Firma del webhook inválida.",
        rid,
      });
    }
    log(rid, "⚠️ Firma inválida — continuando porque MP_WEBHOOK_STRICT != 1");
  } else {
    log(rid, "signature OK");
  }

  if (strict && (!topic || !id)) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_WEBHOOK",
      message: "Falta topic/type o id/data.id",
      rid,
    });
  }

  if (!topic || !id) {
    return res.status(200).json({ ok: true, rid, ignored: true });
  }

  try {
    let mpPayment = null;
    let merchantOrderId = null;

    if (topic === "payment") {
      mpPayment = await mpGetJson(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, rid);
    } else if (topic === "merchant_order") {
      merchantOrderId = String(id);

      const mo = await mpGetJson(`https://api.mercadopago.com/merchant_orders/${encodeURIComponent(id)}`, rid);
      const lastPay =
        Array.isArray(mo?.payments) && mo.payments.length ? mo.payments[mo.payments.length - 1] : null;

      if (lastPay?.id) {
        mpPayment = await mpGetJson(
          `https://api.mercadopago.com/v1/payments/${encodeURIComponent(lastPay.id)}`,
          rid
        );
      } else {
        return res.status(200).json({ ok: true, rid, ignored: true, topic, reason: "MO_WITHOUT_PAYMENTS" });
      }
    } else {
      return res.status(200).json({ ok: true, rid, ignored: true, topic });
    }

    const mp_payment_id = mpPayment?.id ? String(mpPayment.id) : null;
    const external_reference = mpPayment?.external_reference ? String(mpPayment.external_reference) : null;

    const localPayStatus = mapMpStatusToLocalPaymentStatus(mpPayment?.status);

    const out = await sequelize.transaction(async (t) => {
      const payRow = await findPaymentByMpExternal({
        mp_payment_id,
        external_id: mp_payment_id,
        external_reference,
        t,
      });

      if (!payRow?.id) {
        log(rid, "payment not found", { mp_payment_id, external_reference, topic });
        return { ok: true, rid, not_found: true, mp_payment_id, external_reference, topic };
      }

      await updatePaymentAndOrder({
        paymentRow: payRow,
        mp: mpPayment,
        merchantOrderId,
        localPayStatus,
        rid,
        t,
      });

      return {
        ok: true,
        rid,
        updated: true,
        localPayStatus,
        payment_id: payRow.id,
        order_id: payRow.order_id,
      };
    });

    // Post-commit: si MP aprobó la compra, disparar alerta Telegram
    // "Compra confirmada". Fire-and-forget — no rompe la respuesta.
    if (out?.updated && out?.localPayStatus === "approved" && out?.order_id) {
      notifyShopPaymentConfirmed({
        order_id: out.order_id,
        mpPayment,
        rid,
      }).catch((e) =>
        log(rid, "notifyShopPaymentConfirmed falló", { error: e?.message || e })
      );

      // Notificación in-app al cliente: "tu pago se acreditó"
      notifyCustomerPaymentApproved(out.order_id).catch((e) =>
        log(rid, "notifyCustomerPaymentApproved falló", { error: e?.message || e })
      );
    }

    return res.status(200).json(out);
  } catch (e) {
    log(rid, "ERROR", { message: e?.message || String(e), statusCode: e?.statusCode, payload: e?.payload || null });

    return res.status(200).json({
      ok: true,
      rid,
      processed: false,
      code: e?.code || "WEBHOOK_ERROR",
      message: "Error procesando webhook MercadoPago",
      detail: e?.payload || e?.detail || e?.message || String(e),
    });
  }
}

/**
 * Dispara alerta Telegram "Compra confirmada" cuando MP aprueba el pago.
 * Fire-and-forget — nunca lanza, sólo loguea.
 *
 * Lee la orden + items + sucursal de la DB para construir el mensaje.
 */
async function notifyShopPaymentConfirmed({ order_id, mpPayment, rid }) {
  try {
    const tg = require("../services/telegramNotifier.service");

    const [orderRows] = await sequelize.query(
      `SELECT o.id, o.public_code, o.fulfillment_type, o.branch_id, o.total,
              o.ship_address1, o.ship_city, o.ship_province,
              b.name AS branch_name
         FROM ecom_orders o
         LEFT JOIN branches b ON b.id = o.branch_id
        WHERE o.id = :id
        LIMIT 1`,
      { replacements: { id: order_id } }
    );
    const order = orderRows?.[0];
    if (!order) return;

    // Buyer info: viene en external_payload del payment, pero como
    // fallback más confiable lo leemos del último payment de la orden.
    let buyer_name = null,
      buyer_email = null,
      buyer_phone = null,
      method_code = null;
    try {
      const [payRows] = await sequelize.query(
        `SELECT external_payload, method
           FROM ecom_payments
          WHERE order_id = :id
          ORDER BY id DESC LIMIT 1`,
        { replacements: { id: order_id } }
      );
      const raw = payRows?.[0]?.external_payload;
      method_code = payRows?.[0]?.method || null;
      if (raw) {
        const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
        buyer_name = payload?.buyer?.name || null;
        buyer_email = payload?.buyer?.email || null;
        buyer_phone = payload?.buyer?.phone || null;
      }
    } catch (_) {}

    // Si no había buyer en payload, usar lo de MP
    buyer_name = buyer_name || mpPayment?.payer?.first_name || mpPayment?.payer?.email || null;
    buyer_email = buyer_email || mpPayment?.payer?.email || null;

    const [items] = await sequelize.query(
      `SELECT oi.product_id, oi.qty, p.name AS product_name
         FROM ecom_order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = :id`,
      { replacements: { id: order_id } }
    );

    const itemsCount = (items || []).reduce(
      (acc, x) => acc + Number(x?.qty || 0),
      0
    );
    const fmtMoney = (n) =>
      `$ ${new Intl.NumberFormat("es-AR").format(Math.round(Number(n) || 0))}`;

    const isPickup = String(order.fulfillment_type) === "pickup";

    const lines = [
      { k: "Pedido", v: order.public_code || `#${order.id}` },
      { k: "Cliente", v: buyer_name || "—" },
      { k: "Email", v: buyer_email || "—" },
      buyer_phone ? { k: "Teléfono", v: buyer_phone } : null,
      { k: "Total", v: fmtMoney(order.total) },
      { k: "Items", v: String(itemsCount) },
      {
        k: "Tipo",
        v: isPickup
          ? `Retiro en sucursal${order.branch_name ? ` — ${order.branch_name}` : ""}`
          : "Envío a domicilio",
      },
    ].filter(Boolean);

    if (!isPickup) {
      const addr = [order.ship_address1, order.ship_city, order.ship_province]
        .filter(Boolean)
        .join(", ");
      if (addr) lines.push({ k: "Dirección", v: addr });
    }

    // En el webhook MP, el método siempre es Mercado Pago aunque el
    // method_code pueda venir como "credit_card" / "debit_card" desde MP.
    lines.push({ k: "Medio de pago", v: "Mercado Pago" });
    if (mpPayment?.id) {
      lines.push({ k: "MP ID", v: String(mpPayment.id) });
    }

    const adminBase =
      toStr(process.env.ADMIN_BASE_URL) ||
      toStr(process.env.PUBLIC_BASE_URL) ||
      "https://sanjuantecnologia.com";
    const adminUrl = `${adminBase.replace(/\/$/, "")}/app/admin/shop/orders/${order.id}`;
    lines.push(`\n<a href="${adminUrl}">🔧 Gestionar pedido en backoffice</a>`);

    await tg.sendAlert({
      code: "shop_payment_confirmed",
      toggleKey: "alert_shop_payment_confirmed",
      title: "✅ Pago de tienda confirmado (Mercado Pago)",
      lines,
      severity: "low",
      reference_type: "ecom_order",
      reference_id: order.id,
      ref: order.public_code || null,
    });
  } catch (e) {
    console.warn(
      "[mpWebhook] notifyShopPaymentConfirmed falló:",
      e?.message || e
    );
  }
}

/**
 * Notificación in-app al cliente cuando MP aprueba el pago.
 */
async function notifyCustomerPaymentApproved(order_id) {
  try {
    const customerNotifs = require("../services/customerNotifications.service");
    const [rows] = await sequelize.query(
      `SELECT id, customer_id, public_code FROM ecom_orders WHERE id = :id LIMIT 1`,
      { replacements: { id: order_id } }
    );
    const order = rows?.[0];
    if (!order || !order.customer_id) return;
    const code = order.public_code || `#${order.id}`;
    await customerNotifs.create({
      customer_id: order.customer_id,
      type: "payment_approved",
      title: "¡Pago aprobado!",
      body: `Recibimos tu pago del pedido ${code}. Ya estamos preparando todo.`,
      ref_type: "ecom_order",
      ref_id: order.id,
      link: `/shop/account/orders`,
    });
  } catch (e) {
    console.warn("[mpWebhook] notifyCustomerPaymentApproved falló:", e?.message);
  }
}

module.exports = { mercadopagoWebhook };
