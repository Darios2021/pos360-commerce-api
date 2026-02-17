// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/public.account.controller.js
//
// Endpoints (montados bajo /api/v1/public/account):
// - GET    /orders?limit&offset
// - GET    /orders/:id
// - GET    /favorites
// - POST   /favorites { product_id }
// - DELETE /favorites/:product_id
//
// DB: ecom_orders, ecom_order_items, products, product_images, ecom_favorites

const { sequelize } = require("../config/sequelize");

function toInt(v, def = 0) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : def;
}

exports.getMyOrders = async (req, res) => {
  const customerId = req.customer.id;
  const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 100);
  const offset = Math.max(toInt(req.query.offset, 0), 0);

  const sql = `
    SELECT
      o.id,
      o.public_code,
      o.status,
      o.payment_status,
      o.checkout_provider,
      o.currency,
      o.subtotal,
      o.discount_total,
      o.shipping_total,
      o.total,
      o.fulfillment_type,
      o.created_at,
      o.paid_at,
      o.cancelled_at,

      (SELECT COUNT(*)
       FROM ecom_order_items oi
       WHERE oi.order_id = o.id) AS items_count,

      (SELECT oi.product_id
       FROM ecom_order_items oi
       WHERE oi.order_id = o.id
       ORDER BY oi.id ASC
       LIMIT 1) AS first_product_id,

      (SELECT p.name
       FROM ecom_order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = o.id
       ORDER BY oi.id ASC
       LIMIT 1) AS first_product_name,

      (SELECT pi.url
       FROM ecom_order_items oi
       JOIN product_images pi ON pi.product_id = oi.product_id
       WHERE oi.order_id = o.id
       ORDER BY COALESCE(pi.position, 999999) ASC, pi.id ASC
       LIMIT 1) AS first_product_image_url

    FROM ecom_orders o
    WHERE o.customer_id = :customerId
    ORDER BY o.created_at DESC
    LIMIT :limit OFFSET :offset
  `;

  const countSql = `
    SELECT COUNT(*) AS total
    FROM ecom_orders o
    WHERE o.customer_id = :customerId
  `;

  const [items] = await sequelize.query(sql, {
    replacements: { customerId, limit, offset },
  });

  const [countRows] = await sequelize.query(countSql, {
    replacements: { customerId },
  });

  const total = Number(countRows?.[0]?.total || 0);
  return res.json({ items, total, limit, offset });
};

exports.getMyOrderDetail = async (req, res) => {
  const customerId = req.customer.id;
  const orderId = toInt(req.params.id, 0);
  if (!orderId) return res.status(400).json({ message: "order_id inválido" });

  const orderSql = `
    SELECT *
    FROM ecom_orders
    WHERE id = :orderId AND customer_id = :customerId
    LIMIT 1
  `;

  const itemsSql = `
    SELECT
      oi.id,
      oi.order_id,
      oi.product_id,
      oi.qty,
      oi.unit_price,
      oi.line_total,
      p.name AS product_name,
      (SELECT pi.url
       FROM product_images pi
       WHERE pi.product_id = oi.product_id
       ORDER BY COALESCE(pi.position, 999999) ASC, pi.id ASC
       LIMIT 1) AS image_url
    FROM ecom_order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = :orderId
    ORDER BY oi.id ASC
  `;

  const [orderRows] = await sequelize.query(orderSql, {
    replacements: { orderId, customerId },
  });

  const order = orderRows?.[0];
  if (!order) return res.status(404).json({ message: "Pedido no encontrado" });

  const [items] = await sequelize.query(itemsSql, {
    replacements: { orderId },
  });

  return res.json({ order, items });
};

exports.getMyFavorites = async (req, res) => {
  const customerId = req.customer.id;

  const sql = `
    SELECT
      f.id,
      f.product_id,
      f.created_at,
      p.name,
      p.price,
      (SELECT pi.url
       FROM product_images pi
       WHERE pi.product_id = p.id
       ORDER BY COALESCE(pi.position, 999999) ASC, pi.id ASC
       LIMIT 1) AS image_url
    FROM ecom_favorites f
    JOIN products p ON p.id = f.product_id
    WHERE f.customer_id = :customerId
    ORDER BY f.id DESC
  `;

  const [items] = await sequelize.query(sql, { replacements: { customerId } });
  return res.json({ items });
};

exports.addFavorite = async (req, res) => {
  const customerId = req.customer.id;
  const productId = toInt(req.body?.product_id, 0);
  if (!productId) return res.status(400).json({ message: "product_id inválido" });

  const sql = `
    INSERT INTO ecom_favorites (customer_id, product_id, created_at)
    VALUES (:customerId, :productId, NOW())
    ON DUPLICATE KEY UPDATE created_at = created_at
  `;

  await sequelize.query(sql, { replacements: { customerId, productId } });
  return res.json({ ok: true });
};

exports.removeFavorite = async (req, res) => {
  const customerId = req.customer.id;
  const productId = toInt(req.params.product_id, 0);
  if (!productId) return res.status(400).json({ message: "product_id inválido" });

  const sql = `
    DELETE FROM ecom_favorites
    WHERE customer_id = :customerId AND product_id = :productId
    LIMIT 1
  `;

  await sequelize.query(sql, { replacements: { customerId, productId } });
  return res.json({ ok: true });
};
