// src/controllers/admin.shopPayments.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Admin Shop Payments (panel de gestión)
// - GET   /api/v1/admin/shop/payments                 listAdminPayments
// - GET   /api/v1/admin/shop/payments/:paymentId      getAdminPaymentById
// - PATCH /api/v1/admin/shop/payments/:paymentId      updateAdminPayment
// - POST  /api/v1/admin/shop/payments/:paymentId/mark-paid    markPaymentPaid
// - POST  /api/v1/admin/shop/payments/:paymentId/mark-unpaid  markPaymentUnpaid
// - POST  /api/v1/admin/shop/payments/:paymentId/review       reviewTransferPayment  (compat)
//
// Usa SQL directo con sequelize.query para NO depender de modelos opcionales.
// Compatible con tu schema REAL (external_payload JSON, mp_* columns, etc.)

const { sequelize } = require("../models");

// =====================
// Helpers
// =====================
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toNum(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}
function toStr(v) {
  return String(v ?? "").trim();
}
function pickLike(q) {
  const s = toStr(q);
  if (!s) return "";
  return `%${s.replace(/[%_]/g, "\\$&")}%`;
}

function normalizeProvider(p) {
  const s = toStr(p).toLowerCase();
  if (!s) return "";
  if (s === "mp" || s === "mercado_pago" || s === "mercadopago") return "mercadopago";
  if (s === "transferencia" || s === "transfer") return "transfer";
  if (s === "efectivo" || s === "cash") return "cash";
  return s;
}

function normalizePaymentStatus(s) {
  const v = toStr(s).toLowerCase();
  // dejamos pasar valores controlados
  const allowed = new Set([
    "created",
    "pending",
    "approved",
    "paid",
    "rejected",
    "cancelled",
    "refunded",
    "unpaid",
  ]);
  if (!v) return "";
  return allowed.has(v) ? v : v;
}

function normalizeOrderPaymentStatus(s) {
  const v = toStr(s).toLowerCase();
  const allowed = new Set(["unpaid", "pending", "paid", "cancelled", "refunded"]);
  if (!v) return "";
  return allowed.has(v) ? v : v;
}

async function hasColumn(table, column, t) {
  const [r] = await sequelize.query(
    `
    SELECT COUNT(*) AS c
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = :t
      AND COLUMN_NAME = :c
    `,
    { replacements: { t: table, c: column }, transaction: t }
  );
  return Number(r?.[0]?.c || 0) > 0;
}

async function setOrderPaymentStatusIfExists(order_id, payment_status, t) {
  const ok = await hasColumn("ecom_orders", "payment_status", t);
  if (!ok) return;

  await sequelize.query(
    `
    UPDATE ecom_orders
    SET payment_status = :ps,
        updated_at = CURRENT_TIMESTAMP,
        paid_at = CASE WHEN :ps = 'paid' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END
    WHERE id = :id
    `,
    { replacements: { id: order_id, ps: payment_status }, transaction: t }
  );
}

// =====================
// GET /admin/shop/payments
// =====================
async function listAdminPayments(req, res) {
  const page = Math.max(1, toInt(req.query.page, 1));
  const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 20)));
  const offset = (page - 1) * limit;

  const q = toStr(req.query.q);
  const provider = normalizeProvider(req.query.provider);
  const status = normalizePaymentStatus(req.query.status);
  const order_status = toStr(req.query.order_status).toLowerCase();
  const payment_status = normalizeOrderPaymentStatus(req.query.payment_status);

  try {
    const where = [];
    const repl = { limit, offset };

    if (provider) {
      where.push("p.provider = :provider");
      repl.provider = provider;
    }
    if (status) {
      where.push("p.status = :status");
      repl.status = status;
    }
    if (order_status) {
      where.push("o.status = :order_status");
      repl.order_status = order_status;
    }
    if (payment_status) {
      where.push("o.payment_status = :payment_status");
      repl.payment_status = payment_status;
    }

    if (q) {
      // búsqueda amplia (id/payment/order/public_code/external_reference/payer_email/reference/note)
      where.push(`
        (
          CAST(p.id AS CHAR) LIKE :q
          OR CAST(p.order_id AS CHAR) LIKE :q
          OR COALESCE(o.public_code,'') LIKE :q
          OR COALESCE(p.external_reference,'') LIKE :q
          OR COALESCE(p.payer_email,'') LIKE :q
          OR COALESCE(p.reference,'') LIKE :q
          OR COALESCE(p.note,'') LIKE :q
          OR COALESCE(p.mp_payment_id,'') LIKE :q
          OR COALESCE(p.mp_preference_id,'') LIKE :q
        )
      `);
      repl.q = pickLike(q);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await sequelize.query(
      `
      SELECT
        p.id,
        p.order_id,
        p.provider,
        p.method,
        p.status,
        p.amount,
        p.currency,
        p.reference,
        p.note,
        p.external_id,
        p.external_reference,
        p.mp_preference_id,
        p.mp_payment_id,
        p.mp_merchant_order_id,
        p.external_status,
        p.status_detail,
        p.payer_email,
        p.proof_url,
        p.bank_reference,
        p.reviewed_by,
        p.reviewed_at,
        p.review_note,
        p.created_at,
        p.updated_at,
        p.paid_at,

        o.public_code,
        o.status AS order_status,
        o.payment_status AS order_payment_status,
        o.total AS order_total,
        o.created_at AS order_created_at
      FROM ecom_payments p
      JOIN ecom_orders o ON o.id = p.order_id
      ${whereSql}
      ORDER BY p.id DESC
      LIMIT :limit OFFSET :offset
      `,
      { replacements: repl }
    );

    const [cnt] = await sequelize.query(
      `
      SELECT COUNT(*) AS total
      FROM ecom_payments p
      JOIN ecom_orders o ON o.id = p.order_id
      ${whereSql}
      `,
      { replacements: repl }
    );

    const total = Number(cnt?.[0]?.total || 0);
    const pages = Math.max(1, Math.ceil(total / limit));

    return res.json({
      ok: true,
      items: rows || [],
      meta: { total, pages, page, limit },
    });
  } catch (e) {
    console.error("❌ listAdminPayments:", e);
    return res.status(500).json({ message: "Error listando pagos.", detail: e?.message || String(e) });
  }
}

// =====================
// GET /admin/shop/payments/:paymentId
// =====================
async function getAdminPaymentById(req, res) {
  const id = toInt(req.params.paymentId, 0);
  if (!id) return res.status(400).json({ message: "paymentId inválido." });

  try {
    const [rows] = await sequelize.query(
      `
      SELECT
        p.*,
        o.public_code,
        o.status AS order_status,
        o.payment_status AS order_payment_status,
        o.total AS order_total,
        o.fulfillment_type,
        o.ship_name,
        o.ship_phone,
        o.ship_address1,
        o.ship_address2,
        o.ship_city,
        o.ship_province,
        o.ship_zip,
        o.created_at AS order_created_at
      FROM ecom_payments p
      JOIN ecom_orders o ON o.id = p.order_id
      WHERE p.id = :id
      LIMIT 1
      `,
      { replacements: { id } }
    );

    const item = rows?.[0] || null;
    if (!item) return res.status(404).json({ message: "Pago no encontrado." });

    return res.json({ ok: true, item });
  } catch (e) {
    console.error("❌ getAdminPaymentById:", e);
    return res.status(500).json({ message: "Error leyendo pago.", detail: e?.message || String(e) });
  }
}

// =====================
// PATCH /admin/shop/payments/:paymentId
// body: { status?, external_status?, status_detail?, payer_email?, reference?, note?, bank_reference?, proof_url?, method?, provider? }
// =====================
async function updateAdminPayment(req, res) {
  const id = toInt(req.params.paymentId, 0);
  if (!id) return res.status(400).json({ message: "paymentId inválido." });

  const b = req.body || {};
  const sets = [];
  const repl = { id };

  const provider = normalizeProvider(b.provider);
  const method = toStr(b.method);
  const status = normalizePaymentStatus(b.status);
  const external_status = toStr(b.external_status);
  const status_detail = toStr(b.status_detail);
  const payer_email = toStr(b.payer_email);
  const reference = toStr(b.reference);
  const note = toStr(b.note);
  const bank_reference = toStr(b.bank_reference);
  const proof_url = toStr(b.proof_url);

  if (provider) {
    sets.push("provider = :provider");
    repl.provider = provider;
  }
  if (method) {
    sets.push("method = :method");
    repl.method = method;
  }
  if (status) {
    sets.push("status = :status");
    repl.status = status;
  }
  if (external_status) {
    sets.push("external_status = :external_status");
    repl.external_status = external_status;
  }
  if (status_detail) {
    sets.push("status_detail = :status_detail");
    repl.status_detail = status_detail;
  }
  if (payer_email) {
    sets.push("payer_email = :payer_email");
    repl.payer_email = payer_email;
  }
  if (reference) {
    sets.push("reference = :reference");
    repl.reference = reference;
  }
  if (note) {
    sets.push("note = :note");
    repl.note = note;
  }
  if (bank_reference) {
    sets.push("bank_reference = :bank_reference");
    repl.bank_reference = bank_reference;
  }
  if (proof_url) {
    sets.push("proof_url = :proof_url");
    repl.proof_url = proof_url;
  }

  if (!sets.length) return res.status(400).json({ message: "Nada para actualizar." });

  try {
    await sequelize.query(
      `
      UPDATE ecom_payments
      SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
      `,
      { replacements: repl }
    );

    return getAdminPaymentById(req, res);
  } catch (e) {
    console.error("❌ updateAdminPayment:", e);
    return res.status(500).json({ message: "Error actualizando pago.", detail: e?.message || String(e) });
  }
}

// =====================
// POST /admin/shop/payments/:paymentId/mark-paid
// =====================
async function markPaymentPaid(req, res) {
  const id = toInt(req.params.paymentId, 0);
  if (!id) return res.status(400).json({ message: "paymentId inválido." });

  try {
    const result = await sequelize.transaction(async (t) => {
      const [rows] = await sequelize.query(
        `SELECT id, order_id, provider, status FROM ecom_payments WHERE id = :id LIMIT 1`,
        { replacements: { id }, transaction: t }
      );
      const p = rows?.[0] || null;
      if (!p) return { error: { status: 404, message: "Pago no encontrado." } };

      // pago -> paid
      await sequelize.query(
        `
        UPDATE ecom_payments
        SET status = 'paid',
            external_status = COALESCE(external_status, 'manual_paid'),
            reviewed_at = CURRENT_TIMESTAMP,
            reviewed_by = :uid,
            review_note = COALESCE(NULLIF(review_note,''), 'Marcado pagado manualmente'),
            paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = :id
        `,
        { replacements: { id, uid: req?.usuario?.id || req?.user?.id || null }, transaction: t }
      );

      // order -> paid
      await setOrderPaymentStatusIfExists(p.order_id, "paid", t);

      return { ok: true };
    });

    if (result?.error) return res.status(result.error.status || 400).json({ message: result.error.message });
    return getAdminPaymentById(req, res);
  } catch (e) {
    console.error("❌ markPaymentPaid:", e);
    return res.status(500).json({ message: "Error marcando pago como pagado.", detail: e?.message || String(e) });
  }
}

// =====================
// POST /admin/shop/payments/:paymentId/mark-unpaid
// =====================
async function markPaymentUnpaid(req, res) {
  const id = toInt(req.params.paymentId, 0);
  if (!id) return res.status(400).json({ message: "paymentId inválido." });

  try {
    const result = await sequelize.transaction(async (t) => {
      const [rows] = await sequelize.query(
        `SELECT id, order_id, provider, status FROM ecom_payments WHERE id = :id LIMIT 1`,
        { replacements: { id }, transaction: t }
      );
      const p = rows?.[0] || null;
      if (!p) return { error: { status: 404, message: "Pago no encontrado." } };

      await sequelize.query(
        `
        UPDATE ecom_payments
        SET status = 'pending',
            external_status = COALESCE(external_status, 'manual_unpaid'),
            reviewed_at = CURRENT_TIMESTAMP,
            reviewed_by = :uid,
            review_note = COALESCE(NULLIF(review_note,''), 'Marcado NO pagado manualmente'),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = :id
        `,
        { replacements: { id, uid: req?.usuario?.id || req?.user?.id || null }, transaction: t }
      );

      await setOrderPaymentStatusIfExists(p.order_id, "unpaid", t);

      return { ok: true };
    });

    if (result?.error) return res.status(result.error.status || 400).json({ message: result.error.message });
    return getAdminPaymentById(req, res);
  } catch (e) {
    console.error("❌ markPaymentUnpaid:", e);
    return res.status(500).json({ message: "Error marcando pago como no pagado.", detail: e?.message || String(e) });
  }
}

// =====================
// POST /admin/shop/payments/:paymentId/review
// body: { status: "approved"|"rejected"|"paid"|"pending", note?, bank_reference?, proof_url? }
// (Compat con lo que ya venías usando)
// =====================
async function reviewTransferPayment(req, res) {
  const id = toInt(req.params.paymentId, 0);
  if (!id) return res.status(400).json({ message: "paymentId inválido." });

  const body = req.body || {};
  const status = normalizePaymentStatus(body.status);
  const note = toStr(body.note || body.review_note);
  const bank_reference = toStr(body.bank_reference);
  const proof_url = toStr(body.proof_url);

  if (!status) return res.status(400).json({ message: "status requerido." });

  try {
    const result = await sequelize.transaction(async (t) => {
      const [rows] = await sequelize.query(
        `SELECT id, order_id, provider FROM ecom_payments WHERE id = :id LIMIT 1`,
        { replacements: { id }, transaction: t }
      );
      const p = rows?.[0] || null;
      if (!p) return { error: { status: 404, message: "Pago no encontrado." } };

      const sets = [];
      const repl = {
        id,
        uid: req?.usuario?.id || req?.user?.id || null,
        review_note: note || null,
      };

      sets.push("status = :status");
      repl.status = status;

      sets.push("reviewed_at = CURRENT_TIMESTAMP");
      sets.push("reviewed_by = :uid");
      sets.push("review_note = :review_note");

      if (bank_reference) {
        sets.push("bank_reference = :bank_reference");
        repl.bank_reference = bank_reference;
      }
      if (proof_url) {
        sets.push("proof_url = :proof_url");
        repl.proof_url = proof_url;
      }

      // si pasa a paid, set paid_at
      if (status === "paid" || status === "approved") {
        sets.push("paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP)");
      }

      await sequelize.query(
        `
        UPDATE ecom_payments
        SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP
        WHERE id = :id
        `,
        { replacements: repl, transaction: t }
      );

      // orden: sync payment_status
      if (status === "paid" || status === "approved") {
        await setOrderPaymentStatusIfExists(p.order_id, "paid", t);
      } else if (status === "pending" || status === "created" || status === "unpaid") {
        await setOrderPaymentStatusIfExists(p.order_id, "unpaid", t);
      } else if (status === "rejected" || status === "cancelled") {
        await setOrderPaymentStatusIfExists(p.order_id, "unpaid", t);
      }

      return { ok: true };
    });

    if (result?.error) return res.status(result.error.status || 400).json({ message: result.error.message });
    return getAdminPaymentById(req, res);
  } catch (e) {
    console.error("❌ reviewTransferPayment:", e);
    return res.status(500).json({ message: "Error revisando pago.", detail: e?.message || String(e) });
  }
}

module.exports = {
  listAdminPayments,
  getAdminPaymentById,
  updateAdminPayment,
  markPaymentPaid,
  markPaymentUnpaid,
  reviewTransferPayment,
};
