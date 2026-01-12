// src/controllers/ecomAdminPayments.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Admin Ecommerce Payments
// Rutas sugeridas (admin):
// - GET    /api/v1/admin/ecom/payments
// - GET    /api/v1/admin/ecom/payments/:id
// - PATCH  /api/v1/admin/ecom/payments/:id   (review/update)
// - POST   /api/v1/admin/ecom/payments/:id/mark-paid
// - POST   /api/v1/admin/ecom/payments/:id/mark-unpaid
//
// ✅ Usa SOLO columnas existentes en:
// - ecom_payments (tu tabla actual)
// - ecom_orders (tu tabla actual)
// - ecom_customers, ecom_order_items (asumidas por tu checkout)
//
// NOTA:
// - reviewed_by debería ser el user_id del admin (req.usuario.id / req.user.id etc).
// - Si no tenés auth middleware aún, igual compila; solo reviewed_by quedará null.

const { Op } = require("sequelize");
const { sequelize } = require("../models");

// ---------------------
// helpers
// ---------------------
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
function pickUserId(req) {
  // soporta varios formatos que ya usaste en otros módulos
  const u = req.usuario || req.user || {};
  const id = toInt(u.id ?? u.userId ?? u.usuario_id ?? u.uid ?? u.user_id, 0);
  return id > 0 ? id : null;
}
function cleanLike(s) {
  // evita comodines raros, deja búsqueda “like”
  return toStr(s).replace(/[%_]/g, " ").trim();
}

function buildWhereFromQuery(q) {
  const where = {};

  const id = toInt(q.id, 0);
  if (id) where.id = id;

  const order_id = toInt(q.order_id, 0);
  if (order_id) where.order_id = order_id;

  const provider = toStr(q.provider).toLowerCase();
  if (provider) where.provider = provider;

  const status = toStr(q.status).toLowerCase();
  if (status) where.status = status;

  const method = toStr(q.method).toLowerCase();
  if (method) where.method = method;

  const currency = toStr(q.currency).toUpperCase();
  if (currency) where.currency = currency;

  // rango fechas (created_at)
  const created_from = toStr(q.created_from);
  const created_to = toStr(q.created_to);
  if (created_from || created_to) {
    where.created_at = {};
    if (created_from) where.created_at[Op.gte] = created_from;
    if (created_to) where.created_at[Op.lte] = created_to;
  }

  // paid range
  const paid_from = toStr(q.paid_from);
  const paid_to = toStr(q.paid_to);
  if (paid_from || paid_to) {
    where.paid_at = {};
    if (paid_from) where.paid_at[Op.gte] = paid_from;
    if (paid_to) where.paid_at[Op.lte] = paid_to;
  }

  return where;
}

function paginate(q) {
  const page = Math.max(1, toInt(q.page, 1));
  const limit = Math.min(200, Math.max(1, toInt(q.limit, 25)));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// ---------------------
// sync order payment_status
// ---------------------
async function syncOrderPaymentStatus(order_id, t) {
  // regla simple:
  // - si hay algún pago con status en ('approved','paid') => order.payment_status='paid' + paid_at
  // - si no => 'unpaid' (o 'pending' si hay pending)
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

// ---------------------
// GET /admin/ecom/payments (list)
// ---------------------
async function listPayments(req, res) {
  const { page, limit, offset } = paginate(req.query || {});
  const where = buildWhereFromQuery(req.query || {});

  // búsqueda general:
  // - public_code
  // - external_reference
  // - mp ids
  // - payer_email
  // - reference/bank_reference
  const q = cleanLike(req.query?.q || req.query?.search || "");
  const wantsJoin = !!q || !!toStr(req.query?.public_code);

  // filtros por order public_code
  const public_code = cleanLike(req.query?.public_code || "");

  try {
    // Construimos query SQL para poder filtrar por datos de order/customer
    const repl = {
      limit,
      offset,
    };

    // where base ecom_payments
    const cond = [];
    const allowedCols = [
      "id",
      "order_id",
      "provider",
      "method",
      "status",
      "currency",
    ];

    for (const k of allowedCols) {
      if (where[k] === undefined) continue;
      cond.push(`p.${k} = :${k}`);
      repl[k] = where[k];
    }

    // created_at range
    if (where.created_at?.[Op.gte]) {
      cond.push(`p.created_at >= :created_from`);
      repl.created_from = where.created_at[Op.gte];
    }
    if (where.created_at?.[Op.lte]) {
      cond.push(`p.created_at <= :created_to`);
      repl.created_to = where.created_at[Op.lte];
    }

    // paid_at range
    if (where.paid_at?.[Op.gte]) {
      cond.push(`p.paid_at >= :paid_from`);
      repl.paid_from = where.paid_at[Op.gte];
    }
    if (where.paid_at?.[Op.lte]) {
      cond.push(`p.paid_at <= :paid_to`);
      repl.paid_to = where.paid_at[Op.lte];
    }

    if (public_code) {
      cond.push(`o.public_code LIKE :public_code`);
      repl.public_code = `%${public_code}%`;
    }

    if (q) {
      repl.q = `%${q}%`;
      cond.push(
        `(
          o.public_code LIKE :q OR
          p.external_reference LIKE :q OR
          p.external_id LIKE :q OR
          p.mp_preference_id LIKE :q OR
          p.mp_payment_id LIKE :q OR
          p.mp_merchant_order_id LIKE :q OR
          p.payer_email LIKE :q OR
          p.reference LIKE :q OR
          p.bank_reference LIKE :q
        )`
      );
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
        p.method,
        p.status,
        p.amount,
        p.currency,
        p.reference,
        p.note,
        p.external_reference,
        p.external_id,
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
        p.paid_at,
        p.created_at,
        p.updated_at,

        o.public_code,
        o.status AS order_status,
        o.payment_status AS order_payment_status,
        o.total AS order_total,
        o.fulfillment_type,
        o.ship_name,
        o.ship_phone,
        o.ship_city,
        o.ship_province,
        o.ship_zip,

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
    console.error("❌ listPayments error:", e);
    return res.status(500).json({ ok: false, message: "Error listando pagos.", detail: e?.message || String(e) });
  }
}

// ---------------------
// GET /admin/ecom/payments/:id (detail)
// ---------------------
async function getPaymentById(req, res) {
  const id = toInt(req.params?.id, 0);
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
        p.name AS product_name
      FROM ecom_order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = :order_id
      ORDER BY oi.id ASC
      `,
      { replacements: { order_id: pay.order_id } }
    );

    return res.json({
      ok: true,
      item: pay,
      order_items: items || [],
    });
  } catch (e) {
    console.error("❌ getPaymentById error:", e);
    return res.status(500).json({ ok: false, message: "Error obteniendo pago.", detail: e?.message || String(e) });
  }
}

// ---------------------
// PATCH /admin/ecom/payments/:id (review/update)
// Body permite:
// { status, method, reference, note, bank_reference, proof_url, external_status, status_detail, payer_email, review_note, paid_at }
// ---------------------
async function updatePayment(req, res) {
  const id = toInt(req.params?.id, 0);
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

      // campos editables
      const map = [
        ["status", "status", (v) => toStr(v).toLowerCase() || null],
        ["method", "method", (v) => toStr(v).toLowerCase() || null],
        ["reference", "reference", (v) => toStr(v) || null],
        ["note", "note", (v) => toStr(v) || null],
        ["bank_reference", "bank_reference", (v) => toStr(v) || null],
        ["proof_url", "proof_url", (v) => toStr(v) || null],
        ["external_status", "external_status", (v) => toStr(v) || null],
        ["status_detail", "status_detail", (v) => toStr(v) || null],
        ["payer_email", "payer_email", (v) => toStr(v).toLowerCase() || null],
      ];

      for (const [k, col, fn] of map) {
        if (body[k] === undefined) continue;
        sets.push(`${col} = :${k}`);
        repl[k] = fn(body[k]);
      }

      // paid_at (si viene)
      if (body.paid_at !== undefined) {
        sets.push(`paid_at = :paid_at`);
        repl.paid_at = body.paid_at ? body.paid_at : null;
      }

      // review fields
      if (body.review_note !== undefined) {
        sets.push(`review_note = :review_note`);
        repl.review_note = toStr(body.review_note) || null;
        sets.push(`reviewed_at = CURRENT_TIMESTAMP`);
        sets.push(`reviewed_by = :reviewed_by`);
        repl.reviewed_by = userId;
      } else {
        // si toca algo, igual marcamos reviewed_at/by
        if (sets.length) {
          sets.push(`reviewed_at = CURRENT_TIMESTAMP`);
          sets.push(`reviewed_by = :reviewed_by`);
          repl.reviewed_by = userId;
        }
      }

      if (!sets.length) {
        return { ok: true, changed: false, order_id: row.order_id };
      }

      await sequelize.query(
        `
        UPDATE ecom_payments
        SET ${sets.join(", ")},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = :id
        `,
        { replacements: repl, transaction: t }
      );

      // sync order payment_status
      const sync = await syncOrderPaymentStatus(row.order_id, t);

      return { ok: true, changed: true, order_id: row.order_id, sync };
    });

    if (result?.error) return res.status(result.error.status || 400).json({ ok: false, message: result.error.message });

    return res.json({ ok: true, ...result });
  } catch (e) {
    console.error("❌ updatePayment error:", e);
    return res.status(500).json({ ok: false, message: "Error actualizando pago.", detail: e?.message || String(e) });
  }
}

// ---------------------
// POST /admin/ecom/payments/:id/mark-paid
// fuerza status=approved + paid_at=now
// ---------------------
async function markPaid(req, res) {
  const id = toInt(req.params?.id, 0);
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
    console.error("❌ markPaid error:", e);
    return res.status(500).json({ ok: false, message: "Error marcando como pagado.", detail: e?.message || String(e) });
  }
}

// ---------------------
// POST /admin/ecom/payments/:id/mark-unpaid
// fuerza status=rejected + paid_at=null (para corregir transferencias)
// ---------------------
async function markUnpaid(req, res) {
  const id = toInt(req.params?.id, 0);
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
    console.error("❌ markUnpaid error:", e);
    return res.status(500).json({ ok: false, message: "Error marcando como impago.", detail: e?.message || String(e) });
  }
}

module.exports = {
  listPayments,
  getPaymentById,
  updatePayment,
  markPaid,
  markUnpaid,
};
