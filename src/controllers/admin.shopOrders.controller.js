// src/controllers/admin.shopOrders.controller.js
// ✅ Admin Ecommerce Orders (DB pos360)
// - GET /api/v1/admin/shop/orders
// - GET /api/v1/admin/shop/orders/:id
//
// Lee:
// - ecom_orders
// - ecom_order_items (+ products.name)
// - ecom_payments
//
// NO depende de modelos: sequelize.query

const { sequelize } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toStr(v) {
  return String(v ?? "").trim();
}

async function listOrders(req, res) {
  const page = Math.max(1, toInt(req.query.page, 1));
  const limit = Math.min(100, Math.max(5, toInt(req.query.limit, 20)));
  const offset = (page - 1) * limit;

  const q = toStr(req.query.q);
  const status = toStr(req.query.status);
  const fulfillment_type = toStr(req.query.fulfillment_type);
  const branch_id = toInt(req.query.branch_id, 0);

  const where = [];
  const repl = { limit, offset };

  if (status) {
    where.push(`o.status = :status`);
    repl.status = status;
  }
  if (fulfillment_type) {
    where.push(`o.fulfillment_type = :fulfillment_type`);
    repl.fulfillment_type = fulfillment_type;
  }
  if (branch_id) {
    where.push(`o.branch_id = :branch_id`);
    repl.branch_id = branch_id;
  }
  if (q) {
    where.push(`(
      o.public_code LIKE :q
      OR c.email LIKE :q
      OR CONCAT(IFNULL(c.first_name,''),' ',IFNULL(c.last_name,'')) LIKE :q
      OR CAST(o.id AS CHAR) LIKE :q
    )`);
    repl.q = `%${q}%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows] = await sequelize.query(
    `
    SELECT
      o.id,
      o.public_code,
      o.branch_id,
      b.name AS branch_name,
      o.customer_id,
      c.email AS customer_email,
      CONCAT(IFNULL(c.first_name,''),' ',IFNULL(c.last_name,'')) AS customer_name,
      o.status,
      o.currency,
      o.subtotal,
      o.discount_total,
      o.shipping_total,
      o.total,
      o.fulfillment_type,
      o.ship_name,
      o.ship_phone,
      o.ship_city,
      o.ship_province,
      o.ship_zip,
      o.created_at,
      o.updated_at,
      (SELECT COUNT(*) FROM ecom_order_items i WHERE i.order_id = o.id) AS items_count,
      (SELECT COALESCE(SUM(p.amount),0) FROM ecom_payments p WHERE p.order_id = o.id) AS payments_sum,
      (SELECT p.provider FROM ecom_payments p WHERE p.order_id = o.id ORDER BY p.id DESC LIMIT 1) AS last_payment_provider,
      (SELECT p.status FROM ecom_payments p WHERE p.order_id = o.id ORDER BY p.id DESC LIMIT 1) AS last_payment_status
    FROM ecom_orders o
    JOIN branches b ON b.id = o.branch_id
    LEFT JOIN ecom_customers c ON c.id = o.customer_id
    ${whereSql}
    ORDER BY o.id DESC
    LIMIT :limit OFFSET :offset
    `,
    { replacements: repl }
  );

  const [cnt] = await sequelize.query(
    `
    SELECT COUNT(*) AS total
    FROM ecom_orders o
    LEFT JOIN ecom_customers c ON c.id = o.customer_id
    ${whereSql}
    `,
    { replacements: repl }
  );

  const total = Number(cnt?.[0]?.total || 0);
  const pages = Math.max(1, Math.ceil(total / limit));

  return res.json({
    ok: true,
    data: rows || [],
    meta: { page, limit, total, pages },
  });
}

async function getOrderById(req, res) {
  const id = toInt(req.params.id, 0);
  if (!id) return res.status(400).json({ ok: false, message: "ID inválido." });

  const [[order]] = await sequelize.query(
    `
    SELECT
      o.*,
      b.name AS branch_name,
      c.email AS customer_email,
      CONCAT(IFNULL(c.first_name,''),' ',IFNULL(c.last_name,'')) AS customer_name
    FROM ecom_orders o
    JOIN branches b ON b.id = o.branch_id
    LEFT JOIN ecom_customers c ON c.id = o.customer_id
    WHERE o.id = :id
    LIMIT 1
    `,
    { replacements: { id } }
  );

  if (!order) return res.status(404).json({ ok: false, message: "Pedido no encontrado." });

  const [items] = await sequelize.query(
    `
    SELECT
      i.*,
      p.name AS product_name
    FROM ecom_order_items i
    JOIN products p ON p.id = i.product_id
    WHERE i.order_id = :id
    ORDER BY i.id ASC
    `,
    { replacements: { id } }
  );

  const [payments] = await sequelize.query(
    `
    SELECT *
    FROM ecom_payments
    WHERE order_id = :id
    ORDER BY id DESC
    `,
    { replacements: { id } }
  );

  return res.json({ ok: true, order, items: items || [], payments: payments || [] });
}

module.exports = {
  listOrders,
  getOrderById,
};
