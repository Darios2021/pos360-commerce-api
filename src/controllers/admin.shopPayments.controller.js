// src/controllers/admin.shopPayments.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (ALINEADO A TU ESQUEMA REAL)
//
// Admin ecommerce payments (gestión)
// - Lista + filtros
// - Detalle (incluye order + customer + items)
// - Update (review/meta + estado)
// - Mark paid/unpaid (sincroniza ecom_orders.payment_status / paid_at)
//
// ✅ IMPORTANTE
// Este controller NO asume columnas "mp_*" ni campos raros.
// Usa solo campos típicos que ya viste en tu DB:
// ecom_payments: id, order_id, provider, status, amount, external_id, external_status, external_payload, paid_at, created_at, updated_at
// ecom_orders: public_code, status, payment_status, fulfillment_type, ship_* , total, created_at
// ecom_customers: email, first_name, last_name, phone, doc_number

const { sequelize } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toStr(v) {
  return String(v ?? "").trim();
}
function cleanLike(s) {
  return toStr(s).replace(/[%_]/g, " ").trim();
}
function pickUserId(req) {
  const u = req.usuario || req.user || req.auth || {};
  const id = toInt(u.id ?? u.userId ?? u.usuario_id ?? u.uid ?? u.user_id, 0);
  return id > 0 ? id : null;
}
function paginate(q) {
  const page = Math.max(1, toInt(q.page, 1));
  const limit = Math.min(200, Math.max(1, toInt(q.limit, 25)));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// ======================================================
// Sync payment_status en ecom_orders basado en ecom_payments
// ======================================================
async function syncOrderPaymentStatus(order_id, t) {
  const [rows] = await sequelize.query(
    `
    SELECT 
      SUM(CASE WHEN LOWER(status) IN ('approved','paid') THEN 1 ELSE 0 END) AS paid_count,
      SUM(CASE WHEN LOWER(status) IN ('pending') THEN 1 ELSE 0 END) AS pending_count,
      MAX(paid_at) AS last_paid_at
    FROM ecom_payments
    WHERE order_id = :order_id
    `,
    { replacements: { order_id }, transaction: t }
  );

  const paidCount = toInt(rows?.[0]?.paid_count, 0);
  const pendingCount = toInt(rows?.[0]?.pending_count, 0);
  const lastPaidAt = rows?.[0]?.last_paid_at || null;

  let payment_status = "unpaid";
  let paid_at = null;

  if (paidCount > 0) {
    payment_status = "paid";
    paid_at = lastPaidAt || new Date();
  } else if (pendingCount > 0) {
    payment_status = "pending";
  }

  await sequelize.query(
    `
    UPDATE ecom_orders
    SET payment_status = :payment_status,
        paid_at = :paid_at,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :order_id
    `,
    { replacements: { order_id, payment_status, paid_at }, transaction: t }
  );

  return { payment_status, paid_at };
}

// ======================================================
// GET /api/v1/admin/shop/payments
// Lista pagos (con order + customer)
// Filtros:
// - provider (mercadopago|transfer|cash|other|seller|credit_sjt...)
// - status   (created|pending|approved|rejected|...)
// - q        (public_code / external_id / customer email / customer name / payment id)
// - created_from, created_to (YYYY-MM-DD o datetime)
// - paid_from, paid_to
// - page, limit
// ======================================================
async function listAdminShopPayments(req, res) {
  const { page, limit, offset } = paginate(req.query || {});

  const provider = toStr(req.query?.provider).toLowerCase();
  const status = toStr(req.query?.status).toLowerCase();
  const q = cleanLike(req.query?.q || req.query?.search || "");
  const public_code = cleanLike(req.query?.public_code || "");

  const created_from = toStr(req.query?.created_from);
  const created_to = toStr(req.query?.created_to);

  const paid_from = toStr(req.query?.paid_from);
  const paid_to = toStr(req.query?.paid_to);

  try {
    const repl = { limit, offset };
    const cond = [];

    if (provider) {
      cond.push(`LOWER(p.provider) = :provider`);
      repl.provider = provider;
    }
    if (status) {
      cond.push(`LOWER(p.status) = :status`);
      repl.status = status;
    }
    if (public_code) {
      cond.push(`o.public_code LIKE :public_code`);
      repl.public_code = `%${public_code}%`;
    }
    if (created_from) {
      cond.push(`p.created_at >= :created_from`);
      repl.created_from = created_from;
    }
    if (created_to) {
      cond.push(`p.created_at <= :created_to`);
      repl.created_to = created_to;
    }
    if (paid_from) {
      cond.push(`p.paid_at >= :paid_from`);
      repl.paid_from = paid_from;
    }
    if (paid_to) {
      cond.push(`p.paid_at <= :paid_to`);
      repl.paid_to = paid_to;
    }

    if (q) {
      repl.q = `%${q}%`;
      cond.push(
        `(
          o.public_code LIKE :q
          OR CAST(p.id AS CHAR) = :q_exact
          OR p.external_id LIKE :q
          OR c.email LIKE :q
          OR CONCAT(COALESCE(c.first_name,''),' ',COALESCE(c.last_name,'')) LIKE :q
        )`
      );
      repl.q_exact = q;
    }

    const whereSql = cond.length ? `WHERE ${cond.join(" AND ")}` : "";

    const baseFrom = `
      FROM ecom_payments p
      INNER JOIN ecom_orders o ON o.id = p.order_id
      LEFT JOIN ecom_customers c ON c.id = o.customer_id
    `;

    const [countRows] = await sequelize.query(
      `
      SELECT COUNT(*) AS total
      ${baseFrom}
      ${whereSql}
      `,
      { replacements: repl }
    );

    const total = toInt(countRows?.[0]?.total, 0);
    const pages = Math.max(1, Math.ceil(total / limit));

    const [rows] = await sequelize.query(
      `
      SELECT
        p.id,
        p.order_id,
        p.provider,
        p.status,
        p.amount,
        p.external_id,
        p.external_status,
        p.paid_at,
        p.created_at,
        p.updated_at,

        o.public_code,
        o.status AS order_status,
        o.payment_status AS order_payment_status,
        o.total AS order_total,
        o.currency AS order_currency,
        o.fulfillment_type,
        o.ship_name, o.ship_phone, o.ship_city, o.ship_province, o.ship_zip,

        c.email AS customer_email,
        CONCAT(COALESCE(c.first_name,''), ' ', COALESCE(c.last_name,'')) AS customer_name,
        c.phone AS customer_phone
      ${baseFrom}
      ${whereSql}
      ORDER BY p.id DESC
      LIMIT :limit OFFSET :offset
      `,
      { replacements: repl }
    );

    return res.json({
      ok: true,
      meta: { total, pages, page, limit },
      items: rows || [],
    });
  } catch (e) {
    console.error("❌ listAdminShopPayments error:", e);
    return res.status(500).json({
      ok: false,
      message: "Error listando pagos.",
      detail: e?.message || String(e),
    });
  }
}

// ======================================================
// GET /api/v1/admin/shop/payments/:paymentId
// Detalle pago + pedido + cliente + items
// ======================================================
async function getAdminShopPayment(req, res) {
  const id = toInt(req.params?.paymentId, 0);
  if (!id) return res.status(400).json({ ok: false, message: "ID inválido." });

  try {
    const [rows] = await sequelize.query(
      `
      SELECT
        p.*,

        o.public_code,
        o.status AS order_status,
        o.payment_status AS order_payment_status,
        o.currency AS order_currency,
        o.subtotal AS order_subtotal,
        o.discount_total AS order_discount_total,
        o.shipping_total AS order_shipping_total,
        o.total AS order_total,
        o.fulfillment_type,
        o.ship_name, o.ship_phone, o.ship_address1, o.ship_address2, o.ship_city, o.ship_province, o.ship_zip,
        o.notes AS order_notes,
        o.created_at AS order_created_at,
        o.updated_at AS order_updated_at,
        o.paid_at AS order_paid_at,
        o.cancelled_at AS order_cancelled_at,

        c.email AS customer_email,
        c.first_name AS customer_first_name,
        c.last_name AS customer_last_name,
        c.phone AS customer_phone,
        c.doc_number AS customer_doc_number
      FROM ecom_payments p
      INNER JOIN ecom_orders o ON o.id = p.order_id
      LEFT JOIN ecom_customers c ON c.id = o.customer_id
      WHERE p.id = :id
      LIMIT 1
      `,
      { replacements: { id } }
    );

    const pay = rows?.[0] || null;
    if (!pay) return res.status(404).json({ ok: false, message: "Pago no encontrado." });

    const [items] = await sequelize.query(
      `
      SELECT
        oi.id,
        oi.order_id,
        oi.product_id,
        oi.qty,
        oi.unit_price,
        oi.line_total,
        pr.name AS product_name
      FROM ecom_order_items oi
      LEFT JOIN products pr ON pr.id = oi.product_id
      WHERE oi.order_id = :order_id
      ORDER BY oi.id ASC
      `,
      { replacements: { order_id: pay.order_id } }
    );

    return res.json({ ok: true, item: pay, order_items: items || [] });
  } catch (e) {
    console.error("❌ getAdminShopPayment error:", e);
    return res.status(500).json({ ok: false, message: "Error obteniendo pago.", detail: e?.message || String(e) });
  }
}

// ======================================================
// PATCH /api/v1/admin/shop/payments/:paymentId
// Permite actualizar status/provider/external_status/external_id/paid_at y review_note
// (sin asumir columnas mp_* ni method)
// ======================================================
async function updateAdminShopPayment(req, res) {
  const id = toInt(req.params?.paymentId, 0);
  if (!id) return res.status(400).json({ ok: false, message: "ID inválido." });

  const body = req.body || {};
  const userId = pickUserId(req);

  try {
    const result = await sequelize.transaction(async (t) => {
      const [rows] = await sequelize.query(
        `SELECT id, order_id FROM ecom_payments WHERE id = :id LIMIT 1`,
        { replacements: { id }, transaction: t }
      );
      const row = rows?.[0] || null;
      if (!row) return { error: { status: 404, message: "Pago no encontrado." } };

      const sets = [];
      const repl = { id };

      // ✅ columnas “seguras”
      const map = [
        ["status", "status", (v) => toStr(v).toLowerCase() || null],
        ["provider", "provider", (v) => toStr(v).toLowerCase() || null],
        ["external_status", "external_status", (v) => toStr(v) || null],
        ["external_id", "external_id", (v) => toStr(v) || null],
      ];

      for (const [k, col, fn] of map) {
        if (body[k] === undefined) continue;
        sets.push(`${col} = :${k}`);
        repl[k] = fn(body[k]);
      }

      if (body.paid_at !== undefined) {
        sets.push(`paid_at = :paid_at`);
        repl.paid_at = body.paid_at ? body.paid_at : null;
      }

      // review_note / reviewed_by / reviewed_at (si existen en tu tabla)
      if (body.review_note !== undefined) {
        sets.push(`review_note = :review_note`);
        repl.review_note = toStr(body.review_note) || null;
      }

      // Si tocaron algo => reviewed_by/at (si tu tabla los tiene)
      // Si NO existen en tu tabla, comentá estas 2 líneas.
      if (sets.length) {
        sets.push(`reviewed_at = CURRENT_TIMESTAMP`);
        sets.push(`reviewed_by = :reviewed_by`);
        repl.reviewed_by = userId;
      }

      if (!sets.length) return { ok: true, changed: false, order_id: row.order_id };

      await sequelize.query(
        `
        UPDATE ecom_payments
        SET ${sets.join(", ")},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = :id
        `,
        { replacements: repl, transaction: t }
      );

      const sync = await syncOrderPaymentStatus(row.order_id, t);
      return { ok: true, changed: true, order_id: row.order_id, sync };
    });

    if (result?.error) return res.status(result.error.status || 400).json({ ok: false, message: result.error.message });
    return res.json({ ok: true, ...result });
  } catch (e) {
    console.error("❌ updateAdminShopPayment error:", e);
    return res.status(500).json({ ok: false, message: "Error actualizando pago.", detail: e?.message || String(e) });
  }
}

// ======================================================
// POST /api/v1/admin/shop/payments/:paymentId/mark-paid
// ======================================================
async function markAdminShopPaymentPaid(req, res) {
  const id = toInt(req.params?.paymentId, 0);
  if (!id) return res.status(400).json({ ok: false, message: "ID inválido." });

  const userId = pickUserId(req);

  try {
    const result = await sequelize.transaction(async (t) => {
      const [rows] = await sequelize.query(
        `SELECT id, order_id FROM ecom_payments WHERE id = :id LIMIT 1`,
        { replacements: { id }, transaction: t }
      );
      const row = rows?.[0] || null;
      if (!row) return { error: { status: 404, message: "Pago no encontrado." } };

      await sequelize.query(
        `
        UPDATE ecom_payments
        SET status = 'approved',
            paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
            reviewed_by = :reviewed_by,
            reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = :id
        `,
        { replacements: { id, reviewed_by: userId }, transaction: t }
      );

      const sync = await syncOrderPaymentStatus(row.order_id, t);
      return { ok: true, order_id: row.order_id, sync };
    });

    if (result?.error) return res.status(result.error.status || 400).json({ ok: false, message: result.error.message });
    return res.json({ ok: true, ...result });
  } catch (e) {
    console.error("❌ markAdminShopPaymentPaid error:", e);
    return res.status(500).json({ ok: false, message: "Error marcando como pagado.", detail: e?.message || String(e) });
  }
}

// ======================================================
// POST /api/v1/admin/shop/payments/:paymentId/mark-unpaid
// ======================================================
async function markAdminShopPaymentUnpaid(req, res) {
  const id = toInt(req.params?.paymentId, 0);
  if (!id) return res.status(400).json({ ok: false, message: "ID inválido." });

  const userId = pickUserId(req);

  try {
    const result = await sequelize.transaction(async (t) => {
      const [rows] = await sequelize.query(
        `SELECT id, order_id FROM ecom_payments WHERE id = :id LIMIT 1`,
        { replacements: { id }, transaction: t }
      );
      const row = rows?.[0] || null;
      if (!row) return { error: { status: 404, message: "Pago no encontrado." } };

      await sequelize.query(
        `
        UPDATE ecom_payments
        SET status = 'rejected',
            paid_at = NULL,
            reviewed_by = :reviewed_by,
            reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = :id
        `,
        { replacements: { id, reviewed_by: userId }, transaction: t }
      );

      const sync = await syncOrderPaymentStatus(row.order_id, t);
      return { ok: true, order_id: row.order_id, sync };
    });

    if (result?.error) return res.status(result.error.status || 400).json({ ok: false, message: result.error.message });
    return res.json({ ok: true, ...result });
  } catch (e) {
    console.error("❌ markAdminShopPaymentUnpaid error:", e);
    return res.status(500).json({ ok: false, message: "Error marcando como impago.", detail: e?.message || String(e) });
  }
}

module.exports = {
  listAdminShopPayments,
  getAdminShopPayment,
  updateAdminShopPayment,
  markAdminShopPaymentPaid,
  markAdminShopPaymentUnpaid,
};
