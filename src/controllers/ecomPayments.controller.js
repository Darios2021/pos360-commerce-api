// src/controllers/ecomPayments.controller.js
// ✅ COPY-PASTE FINAL
//
// Incluye:
// - POST /api/v1/ecom/payments/:paymentId/mercadopago/preference
// - POST /api/v1/ecom/webhooks/mercadopago
// - POST /api/v1/ecom/payments/:paymentId/transfer/proof  (multipart file)
// - POST /api/v1/admin/shop/payments/:paymentId/review (approve/reject)
//
// Notas:
// - Webhook valida el pago consultando API MercadoPago => "real"
// - Todo es robusto: si faltan columnas/tablas nuevas, no rompe.

const crypto = require("crypto");
const multer = require("multer");
const { sequelize } = require("../models");
const { createPreference, getPayment } = require("../services/mercadopago.service");
const { putObject } = require("../services/s3.service");

// =======================
// Helpers
// =======================
function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toStr(v) {
  return String(v ?? "").trim();
}

async function hasColumn(table, column) {
  const [r] = await sequelize.query(
    `
    SELECT COUNT(*) AS c
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = :t
      AND COLUMN_NAME = :c
    `,
    { replacements: { t: table, c: column } }
  );
  return Number(r?.[0]?.c || 0) > 0;
}

async function hasTable(table) {
  const [r] = await sequelize.query(
    `
    SELECT COUNT(*) AS c
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = :t
    `,
    { replacements: { t: table } }
  );
  return Number(r?.[0]?.c || 0) > 0;
}

async function safeInsertPaymentEvent({ payment_id, provider, event_type, provider_event_id, status_from, status_to, payload }, t) {
  const ok = await hasTable("ecom_payment_events");
  if (!ok) return;

  await sequelize.query(
    `
    INSERT INTO ecom_payment_events
      (payment_id, provider, event_type, provider_event_id, status_from, status_to, payload, created_at)
    VALUES
      (:payment_id, :provider, :event_type, :provider_event_id, :status_from, :status_to, :payload, CURRENT_TIMESTAMP)
    `,
    {
      replacements: {
        payment_id,
        provider: provider || "unknown",
        event_type: event_type || "event",
        provider_event_id: provider_event_id || null,
        status_from: status_from || null,
        status_to: status_to || null,
        payload: payload ? JSON.stringify(payload) : null,
      },
      transaction: t,
    }
  );
}

function mapMpStatusToLocal(mpStatus) {
  const s = toStr(mpStatus).toLowerCase();
  // MP: approved, rejected, in_process, pending, cancelled, refunded, charged_back
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "in_process") return "in_process";
  if (s === "pending") return "pending";
  if (s === "cancelled") return "cancelled";
  if (s === "refunded") return "refunded";
  if (s === "charged_back") return "chargeback";
  return s || "created";
}

async function updateOrderPaymentStatusIfPossible(order_id, payment_status, checkout_provider, paid_at, t) {
  const hasPayStatus = await hasColumn("ecom_orders", "payment_status");
  const hasProvider = await hasColumn("ecom_orders", "checkout_provider");
  const hasPaidAt = await hasColumn("ecom_orders", "paid_at");

  if (!hasPayStatus && !hasProvider && !hasPaidAt) return;

  const sets = [];
  const repl = { id: order_id };

  if (hasPayStatus) {
    sets.push("payment_status = :payment_status");
    repl.payment_status = payment_status || "pending";
  }
  if (hasProvider) {
    sets.push("checkout_provider = :checkout_provider");
    repl.checkout_provider = checkout_provider || null;
  }
  if (hasPaidAt) {
    sets.push("paid_at = :paid_at");
    repl.paid_at = paid_at || null;
  }

  if (!sets.length) return;

  await sequelize.query(
    `
    UPDATE ecom_orders
    SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP
    WHERE id = :id
    `,
    { replacements: repl, transaction: t }
  );
}

async function updatePaymentExtraFieldsIfPossible(payment_id, fields, t) {
  // Solo actualiza columnas si existen
  const possibleCols = [
    "method",
    "currency",
    "external_reference",
    "mp_preference_id",
    "mp_payment_id",
    "mp_merchant_order_id",
    "status_detail",
    "payer_email",
    "proof_url",
    "bank_reference",
    "reviewed_by",
    "reviewed_at",
    "review_note",
  ];

  const sets = [];
  const repl = { id: payment_id };

  for (const k of possibleCols) {
    if (Object.prototype.hasOwnProperty.call(fields, k)) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await hasColumn("ecom_payments", k);
      if (ok) {
        sets.push(`${k} = :${k}`);
        repl[k] = fields[k];
      }
    }
  }

  if (!sets.length) return;

  await sequelize.query(
    `
    UPDATE ecom_payments
    SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP
    WHERE id = :id
    `,
    { replacements: repl, transaction: t }
  );
}

async function getPaymentOrderAndItems(paymentId) {
  const pid = toInt(paymentId, 0);
  if (!pid) {
    const err = new Error("paymentId inválido");
    err.statusCode = 400;
    throw err;
  }

  const [pRows] = await sequelize.query(
    `
    SELECT p.*
    FROM ecom_payments p
    WHERE p.id = :pid
    LIMIT 1
    `,
    { replacements: { pid } }
  );

  const payment = pRows?.[0];
  if (!payment) {
    const err = new Error("Pago no encontrado");
    err.statusCode = 404;
    throw err;
  }

  const [oRows] = await sequelize.query(
    `
    SELECT o.*
    FROM ecom_orders o
    WHERE o.id = :oid
    LIMIT 1
    `,
    { replacements: { oid: payment.order_id } }
  );

  const order = oRows?.[0];
  if (!order) {
    const err = new Error("Pedido no encontrado para ese pago");
    err.statusCode = 404;
    throw err;
  }

  const [items] = await sequelize.query(
    `
    SELECT
      i.*,
      pr.name AS product_name
    FROM ecom_order_items i
    JOIN products pr ON pr.id = i.product_id
    WHERE i.order_id = :oid
    ORDER BY i.id ASC
    `,
    { replacements: { oid: order.id } }
  );

  return { payment, order, items: items || [] };
}

// =======================
// Multer para comprobante (transfer)
// =======================
const transferUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// =======================
// 1) Crear preferencia MP
// POST /api/v1/ecom/payments/:paymentId/mercadopago/preference
// =======================
async function createMercadoPagoPreference(req, res) {
  try {
    const paymentId = req.params.paymentId;
    const { payment, order, items } = await getPaymentOrderAndItems(paymentId);

    const provider = toStr(payment.provider).toLowerCase();
    if (provider !== "mercadopago" && provider !== "mp") {
      return res.status(400).json({ ok: false, message: "Este pago no es MercadoPago.", provider: payment.provider });
    }

    const baseUrl = toStr(process.env.ECOMMERCE_PUBLIC_URL || process.env.FRONTEND_URL || process.env.APP_URL);
    if (!baseUrl) {
      // no es fatal para MP, pero es recomendable
      console.warn("⚠️ Falta ECOMMERCE_PUBLIC_URL/FRONTEND_URL/APP_URL (back_urls).");
    }

    // Armamos items MP desde tu order_items
    const mpItems = (items || []).map((it) => ({
      id: String(it.product_id),
      title: String(it.product_name || `Producto ${it.product_id}`),
      quantity: Number(toNum(it.qty, 1)),
      currency_id: String(order.currency || "ARS"),
      unit_price: Number(toNum(it.unit_price, 0)),
    }));

    const externalRef = String(order.public_code || order.id);

    const prefPayload = {
      external_reference: externalRef,
      items: mpItems,
      statement_descriptor: String(process.env.MP_STATEMENT_DESCRIPTOR || "SAN JUAN TECNOLOGIA").slice(0, 22),
      // back urls (opcionales)
      back_urls: baseUrl
        ? {
            success: `${baseUrl.replace(/\/+$/, "")}/shop/checkout/success?order=${encodeURIComponent(externalRef)}`,
            pending: `${baseUrl.replace(/\/+$/, "")}/shop/checkout/pending?order=${encodeURIComponent(externalRef)}`,
            failure: `${baseUrl.replace(/\/+$/, "")}/shop/checkout/failure?order=${encodeURIComponent(externalRef)}`,
          }
        : undefined,
      auto_return: "approved",
      notification_url: process.env.MP_NOTIFICATION_URL || undefined, // si querés forzar URL pública del webhook
      metadata: {
        order_id: order.id,
        public_code: order.public_code,
        branch_id: order.branch_id,
        payment_id: payment.id,
      },
    };

    // Limpieza de undefined para MP
    if (!prefPayload.back_urls) delete prefPayload.back_urls;
    if (!prefPayload.notification_url) delete prefPayload.notification_url;

    const mpPref = await createPreference(prefPayload);

    await sequelize.transaction(async (t) => {
      // status pending
      await sequelize.query(
        `
        UPDATE ecom_payments
        SET status = 'pending',
            external_id = COALESCE(external_id, :pref_id),
            external_status = 'preference_created',
            external_payload = JSON_SET(COALESCE(external_payload, JSON_OBJECT()),
              '$.mp_preference', CAST(:payload AS JSON)
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = :pid
        `,
        {
          replacements: {
            pid: payment.id,
            pref_id: mpPref?.id || null,
            payload: JSON.stringify(mpPref || {}),
          },
          transaction: t,
        }
      );

      await updatePaymentExtraFieldsIfPossible(
        payment.id,
        {
          mp_preference_id: mpPref?.id || null,
          external_reference: externalRef,
          currency: order.currency || "ARS",
        },
        t
      );

      await updateOrderPaymentStatusIfPossible(order.id, "pending", "MERCADOPAGO", null, t);

      await safeInsertPaymentEvent(
        {
          payment_id: payment.id,
          provider: "mercadopago",
          event_type: "preference_created",
          provider_event_id: mpPref?.id || null,
          status_from: payment.status,
          status_to: "pending",
          payload: mpPref,
        },
        t
      );
    });

    return res.json({
      ok: true,
      order: { id: order.id, public_code: order.public_code, total: order.total, currency: order.currency },
      payment: { id: payment.id, status: "pending", provider: payment.provider, mp_preference_id: mpPref?.id || null },
      mp: {
        id: mpPref?.id || null,
        init_point: mpPref?.init_point || null,
        sandbox_init_point: mpPref?.sandbox_init_point || null,
      },
    });
  } catch (e) {
    console.error("❌ createMercadoPagoPreference:", e);
    return res.status(e?.statusCode || 500).json({
      ok: false,
      code: e?.code || "MP_PREFERENCE_FAILED",
      message: "Error creando preferencia MercadoPago.",
      detail: e?.payload || e?.message || String(e),
    });
  }
}

// =======================
// 2) Webhook MercadoPago
// POST /api/v1/ecom/webhooks/mercadopago
// =======================
async function mercadopagoWebhook(req, res) {
  // MP suele pedir 200 rápido. Igual procesamos con seguridad (consulta API MP).
  try {
    const body = req.body || {};
    // Formatos comunes:
    // { type: "payment", data: { id: "123" } }
    // o { action, api_version, data: { id } }
    const type = toStr(body.type || body.topic || "");
    const dataId = toStr(body?.data?.id || body?.id || "");

    if (!dataId) {
      return res.status(200).json({ ok: true, ignored: true, reason: "NO_DATA_ID" });
    }

    // Validamos por API MP (real)
    const mpPay = await getPayment(dataId);

    const mpStatus = toStr(mpPay.status);
    const localStatus = mapMpStatusToLocal(mpStatus);

    const mpPaymentId = String(mpPay.id || dataId);
    const merchantOrderId = mpPay?.order?.id ? String(mpPay.order.id) : null;
    const externalRef = toStr(mpPay.external_reference);

    // Buscamos payment local:
    // 1) por mp_payment_id si existe columna
    // 2) por external_id
    // 3) por external_reference => ecom_orders.public_code => ecom_payments.order_id
    const paymentColExists = await hasColumn("ecom_payments", "mp_payment_id");

    let paymentRow = null;

    // 1) by mp_payment_id
    if (paymentColExists) {
      const [r] = await sequelize.query(
        `SELECT * FROM ecom_payments WHERE mp_payment_id = :mpid LIMIT 1`,
        { replacements: { mpid: mpPaymentId } }
      );
      paymentRow = r?.[0] || null;
    }

    // 2) by external_id
    if (!paymentRow) {
      const [r] = await sequelize.query(
        `SELECT * FROM ecom_payments WHERE external_id = :eid LIMIT 1`,
        { replacements: { eid: mpPaymentId } }
      );
      paymentRow = r?.[0] || null;
    }

    // 3) by external_reference (order public_code)
    if (!paymentRow && externalRef) {
      const [r] = await sequelize.query(
        `
        SELECT p.*
        FROM ecom_payments p
        JOIN ecom_orders o ON o.id = p.order_id
        WHERE o.public_code = :ref
        ORDER BY p.id DESC
        LIMIT 1
        `,
        { replacements: { ref: externalRef } }
      );
      paymentRow = r?.[0] || null;
    }

    if (!paymentRow) {
      // No rompemos: registramos y respondemos ok
      console.warn("⚠️ Webhook MP: no se encontró ecom_payment local para mp_payment_id:", mpPaymentId);
      return res.status(200).json({ ok: true, ignored: true, reason: "PAYMENT_NOT_FOUND_LOCAL" });
    }

    const oldStatus = toStr(paymentRow.status);

    await sequelize.transaction(async (t) => {
      // Update ecom_payments base
      await sequelize.query(
        `
        UPDATE ecom_payments
        SET status = :status,
            provider = 'mercadopago',
            external_id = COALESCE(external_id, :external_id),
            external_status = :external_status,
            external_payload = JSON_SET(COALESCE(external_payload, JSON_OBJECT()),
              '$.mp_payment', CAST(:payload AS JSON)
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = :pid
        `,
        {
          replacements: {
            pid: paymentRow.id,
            status: localStatus,
            external_id: mpPaymentId,
            external_status: mpStatus || null,
            payload: JSON.stringify(mpPay || {}),
          },
          transaction: t,
        }
      );

      // Update extra fields if exist
      await updatePaymentExtraFieldsIfPossible(
        paymentRow.id,
        {
          mp_payment_id: mpPaymentId,
          mp_merchant_order_id: merchantOrderId,
          external_reference: externalRef || null,
          status_detail: mpPay?.status_detail ? String(mpPay.status_detail) : null,
          payer_email: mpPay?.payer?.email ? String(mpPay.payer.email) : null,
          method: mpPay?.payment_method_id ? String(mpPay.payment_method_id) : null,
          currency: mpPay?.currency_id ? String(mpPay.currency_id) : null,
        },
        t
      );

      // Orden: si approved => paid
      if (localStatus === "approved") {
        await updateOrderPaymentStatusIfPossible(paymentRow.order_id, "paid", "MERCADOPAGO", new Date(), t);

        // si querés además mover status del pedido:
        // (no lo fuerzo porque tu flujo actual usa o.status='created')
        // Podés hacer:
        // UPDATE ecom_orders SET status='paid' WHERE id=:id ...
      } else if (localStatus === "rejected" || localStatus === "cancelled" || localStatus === "expired") {
        await updateOrderPaymentStatusIfPossible(paymentRow.order_id, "failed", "MERCADOPAGO", null, t);
      } else {
        await updateOrderPaymentStatusIfPossible(paymentRow.order_id, "pending", "MERCADOPAGO", null, t);
      }

      await safeInsertPaymentEvent(
        {
          payment_id: paymentRow.id,
          provider: "mercadopago",
          event_type: type || "payment",
          provider_event_id: mpPaymentId,
          status_from: oldStatus,
          status_to: localStatus,
          payload: mpPay,
        },
        t
      );
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("❌ mercadopagoWebhook:", e);
    // MP requiere 200 normalmente para no reintentar infinito, pero si hay error fuerte, igual devolvemos 200 con info.
    return res.status(200).json({ ok: true, processed: false, error: e?.message || String(e) });
  }
}

// =======================
// 3) Subir comprobante transferencia
// POST /api/v1/ecom/payments/:paymentId/transfer/proof (multipart file)
// field: file
// body: bank_reference (opcional)
// =======================
async function uploadTransferProof(req, res) {
  try {
    const paymentId = toInt(req.params.paymentId, 0);
    if (!paymentId) return res.status(400).json({ ok: false, message: "paymentId inválido" });

    const [pRows] = await sequelize.query(`SELECT * FROM ecom_payments WHERE id = :id LIMIT 1`, {
      replacements: { id: paymentId },
    });
    const payment = pRows?.[0];
    if (!payment) return res.status(404).json({ ok: false, message: "Pago no encontrado" });

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, message: "Missing file (field name: file)" });
    }

    const provider = toStr(payment.provider).toLowerCase();
    if (provider !== "transfer" && provider !== "transferencia") {
      // Permitimos igual si quieren forzarlo, pero avisamos
      console.warn("⚠️ uploadTransferProof en payment provider:", payment.provider);
    }

    const original = req.file.originalname || "comprobante";
    const ext = (original.split(".").pop() || "jpg").toLowerCase();
    const safeExt = ["png", "jpg", "jpeg", "webp", "pdf"].includes(ext) ? ext : "jpg";

    const rand = crypto.randomBytes(10).toString("hex");
    const key = `pos360/shop/payments/transfer/${paymentId}/${Date.now()}-${rand}.${safeExt}`;

    const saved = await putObject({
      key,
      body: req.file.buffer,
      contentType: req.file.mimetype || "application/octet-stream",
    });

    const bank_reference = toStr(req.body?.bank_reference || "");

    const oldStatus = toStr(payment.status);

    await sequelize.transaction(async (t) => {
      // Base update (siempre existe)
      await sequelize.query(
        `
        UPDATE ecom_payments
        SET provider = 'transfer',
            status = 'under_review',
            external_status = 'proof_uploaded',
            external_payload = JSON_SET(COALESCE(external_payload, JSON_OBJECT()),
              '$.transfer_proof', CAST(:payload AS JSON)
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = :id
        `,
        {
          replacements: {
            id: paymentId,
            payload: JSON.stringify({
              proof_url: saved.url,
              key: saved.key,
              originalName: original,
              size: req.file.size,
              mime: req.file.mimetype,
              bank_reference: bank_reference || null,
              uploaded_at: new Date().toISOString(),
            }),
          },
          transaction: t,
        }
      );

      await updatePaymentExtraFieldsIfPossible(
        paymentId,
        {
          proof_url: saved.url,
          bank_reference: bank_reference || null,
        },
        t
      );

      await updateOrderPaymentStatusIfPossible(payment.order_id, "pending", "TRANSFER", null, t);

      await safeInsertPaymentEvent(
        {
          payment_id: paymentId,
          provider: "transfer",
          event_type: "proof_uploaded",
          provider_event_id: saved.key || null,
          status_from: oldStatus,
          status_to: "under_review",
          payload: { url: saved.url, key: saved.key, bank_reference: bank_reference || null },
        },
        t
      );
    });

    return res.json({
      ok: true,
      payment_id: paymentId,
      proof_url: saved.url,
      key: saved.key,
      status: "under_review",
      bank_reference: bank_reference || null,
    });
  } catch (e) {
    console.error("❌ uploadTransferProof:", e);
    return res.status(500).json({ ok: false, message: "Error subiendo comprobante.", detail: e?.message || String(e) });
  }
}

// middleware multer exportado para usar en routes
const transferProofMiddleware = transferUpload.single("file");

// =======================
// 4) Admin: aprobar/rechazar pago transferencia
// POST /api/v1/admin/shop/payments/:paymentId/review
// body: { action: "approve"|"reject", note?, bank_reference? }
// =======================
async function reviewTransferPayment(req, res) {
  try {
    const paymentId = toInt(req.params.paymentId, 0);
    if (!paymentId) return res.status(400).json({ ok: false, message: "paymentId inválido" });

    const action = toStr(req.body?.action).toLowerCase();
    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ ok: false, message: "action debe ser approve o reject" });
    }

    const note = toStr(req.body?.note || "");
    const bank_reference = toStr(req.body?.bank_reference || "");

    const reviewerId = req?.usuario?.id || req?.user?.id || null;

    const [pRows] = await sequelize.query(`SELECT * FROM ecom_payments WHERE id = :id LIMIT 1`, {
      replacements: { id: paymentId },
    });
    const payment = pRows?.[0];
    if (!payment) return res.status(404).json({ ok: false, message: "Pago no encontrado" });

    const oldStatus = toStr(payment.status);

    const newStatus = action === "approve" ? "approved" : "rejected";
    const orderPaymentStatus = action === "approve" ? "paid" : "failed";
    const paidAt = action === "approve" ? new Date() : null;

    await sequelize.transaction(async (t) => {
      await sequelize.query(
        `
        UPDATE ecom_payments
        SET status = :status,
            external_status = :ext_status,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = :id
        `,
        {
          replacements: {
            id: paymentId,
            status: newStatus,
            ext_status: action === "approve" ? "transfer_approved" : "transfer_rejected",
          },
          transaction: t,
        }
      );

      await updatePaymentExtraFieldsIfPossible(
        paymentId,
        {
          reviewed_by: reviewerId ? Number(reviewerId) : null,
          reviewed_at: new Date(),
          review_note: note || null,
          bank_reference: bank_reference || null,
        },
        t
      );

      await updateOrderPaymentStatusIfPossible(payment.order_id, orderPaymentStatus, "TRANSFER", paidAt, t);

      await safeInsertPaymentEvent(
        {
          payment_id: paymentId,
          provider: "transfer",
          event_type: action === "approve" ? "approved_by_admin" : "rejected_by_admin",
          provider_event_id: null,
          status_from: oldStatus,
          status_to: newStatus,
          payload: { reviewerId: reviewerId || null, note: note || null, bank_reference: bank_reference || null },
        },
        t
      );
    });

    return res.json({ ok: true, payment_id: paymentId, status: newStatus });
  } catch (e) {
    console.error("❌ reviewTransferPayment:", e);
    return res.status(500).json({ ok: false, message: "Error revisando pago.", detail: e?.message || String(e) });
  }
}

module.exports = {
  createMercadoPagoPreference,
  mercadopagoWebhook,
  uploadTransferProof,
  transferProofMiddleware,
  reviewTransferPayment,
};
