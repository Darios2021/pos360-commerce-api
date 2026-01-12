// src/controllers/admin.shopPayments.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Admin: Ecommerce Payments (gestión)
// Rutas (van montadas bajo /api/v1/admin/shop):
// - GET    /payments
// - GET    /payments/:paymentId
// - PATCH  /payments/:paymentId
// - POST   /payments/:paymentId/mark-paid
// - POST   /payments/:paymentId/mark-unpaid
//
// Notas:
// - Sin inventar modelos: usamos sequelize.query directo (robusto y DB-match)
// - Sin romper si faltan campos en payload
// - Actualiza también ecom_orders.payment_status/paid_at cuando corresponde

const { sequelize } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toStr(v) {
  return String(v ?? "").trim();
}
function clean(obj) {
  const o = { ...obj };
  Object.keys(o).forEach((k) => {
    if (o[k] === undefined) delete o[k];
  });
  return o;
}

async function listPayments(req, res) {
  const q = toStr(req.query.q);
  const provider = toStr(req.query.provider).toLowerCase();
  const status = toStr(req.query.status).toLowerCase();
  const page = Math.max(1, toInt(req.query.page, 1));
  const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 50)));
  const offset = (page - 1) * limit;

  const where = [];
  const repl = { limit, offset };

  if (provider) {
    where.push("LOWER(p.provider) = :provider");
    repl.provider = provider;
  }
  if (status) {
    where.push("LOWER(p.status) = :status");
    repl.status = status;
  }
  if (q) {
    where.push(`(
      CAST(p.id AS CHAR) LIKE :qq
      OR CAST(p.order_id AS CHAR) LIKE :qq
      OR COALESCE(p.external_reference,'') LIKE :qq
      OR COALESCE(p.reference,'') LIKE :qq
      OR COALESCE(p.payer_email,'') LIKE :qq
      OR COALESCE(o.public_code,'') LIKE :qq
    )`);
    repl.qq = `%${q}%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows] = await sequelize.query(
    `
    SELECT
      p.*,
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
    SELECT COUNT(*) AS c
    FROM ecom_payments p
    JOIN ecom_orders o ON o.id = p.order_id
    ${whereSql}
    `,
    { replacements: repl }
  );

  const total = Number(cnt?.[0]?.c || 0);
  const pages = Math.max(1, Math.ceil(total / limit));

  return res.json({
    ok: true,
    items: rows || [],
    meta: { total, page, pages, limit },
  });
}

async function getPaymentById(req, res) {
  const id = toInt(req.params.paymentId, 0);
  if (!id) return res.status(400).json({ message: "paymentId inválido." });

  const [rows] = await sequelize.query(
    `
    SELECT
      p.*,
      o.public_code,
      o.status AS order_status,
      o.payment_status AS order_payment_status,
      o.total AS order_total,
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
}

async function patchPayment(req, res) {
  const id = toInt(req.params.paymentId, 0);
  if (!id) return res.status(400).json({ message: "paymentId inválido." });

  const body = req.body || {};

  // permitimos editar campos “manuales” típicos:
  // status, reference, note, proof_url, bank_reference, external_status, status_detail, payer_email
  const allowed = clean({
    status: body.status ? toStr(body.status).toLowerCase() : undefined,
    reference: body.reference !== undefined ? toStr(body.reference) || null : undefined,
    note: body.note !== undefined ? toStr(body.note) || null : undefined,
    proof_url: body.proof_url !== undefined ? toStr(body.proof_url) || null : undefined,
    bank_reference: body.bank_reference !== undefined ? toStr(body.bank_reference) || null : undefined,
    external_status: body.external_status !== undefined ? toStr(body.external_status) || null : undefined,
    status_detail: body.status_detail !== undefined ? toStr(body.status_detail) || null : undefined,
    payer_email: body.payer_email !== undefined ? toStr(body.payer_email) || null : undefined,
  });

  if (!Object.keys(allowed).length) {
    return res.status(400).json({ message: "Nada para actualizar." });
  }

  const sets = [];
  const repl = { id };

  for (const [k, v] of Object.entries(allowed)) {
    sets.push(`${k} = :${k}`);
    repl[k] = v;
  }

  await sequelize.query(
    `
    UPDATE ecom_payments
    SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP
    WHERE id = :id
    `,
    { replacements: repl }
  );

  return getPaymentById(req, res);
}

async function markPaid(req, res) {
  const id = toInt(req.params.paymentId, 0);
  if (!id) return res.status(400).json({ message: "paymentId inválido." });

  // buscamos order_id
  const [r] = await sequelize.query(`SELECT id, order_id FROM ecom_payments WHERE id = :id LIMIT 1`, {
    replacements: { id },
  });
  const pay = r?.[0];
  if (!pay) return res.status(404).json({ message: "Pago no encontrado." });

  await sequelize.transaction(async (t) => {
    await sequelize.query(
      `
      UPDATE ecom_payments
      SET status = 'paid',
          external_status = COALESCE(external_status, 'manual_paid'),
          paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
      `,
      { replacements: { id }, transaction: t }
    );

    await sequelize.query(
      `
      UPDATE ecom_orders
      SET payment_status = 'paid',
          paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = :oid
      `,
      { replacements: { oid: pay.order_id }, transaction: t }
    );
  });

  return getPaymentById(req, res);
}

async function markUnpaid(req, res) {
  const id = toInt(req.params.paymentId, 0);
  if (!id) return res.status(400).json({ message: "paymentId inválido." });

  const [r] = await sequelize.query(`SELECT id, order_id FROM ecom_payments WHERE id = :id LIMIT 1`, {
    replacements: { id },
  });
  const pay = r?.[0];
  if (!pay) return res.status(404).json({ message: "Pago no encontrado." });

  await sequelize.transaction(async (t) => {
    await sequelize.query(
      `
      UPDATE ecom_payments
      SET status = 'pending',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
      `,
      { replacements: { id }, transaction: t }
    );

    await sequelize.query(
      `
      UPDATE ecom_orders
      SET payment_status = 'unpaid',
          paid_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = :oid
      `,
      { replacements: { oid: pay.order_id }, transaction: t }
    );
  });

  return getPaymentById(req, res);
}

module.exports = {
  listPayments,
  getPaymentById,
  patchPayment,
  markPaid,
  markUnpaid,
};
