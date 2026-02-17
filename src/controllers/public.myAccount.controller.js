// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/public.myAccount.controller.js
//
// Endpoints:
// - GET /api/v1/public/my/orders?limit=20&offset=0
// - GET /api/v1/public/my/orders/:id   (id numérico o public_code)
//
// ✅ Requiere sesión SHOP (cookie httpOnly) -> ecom_customer_sessions
// ✅ Devuelve orders + items + payments (batch IN) ordenado por created_at DESC

const db = require("../models");
const { getShopCustomerFromRequest } = require("../services/shopSession.service");

function toInt(v, d) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function safeLimit(v) {
  const n = toInt(v, 20);
  return Math.max(1, Math.min(50, n)); // cap 50
}

async function requireShopCustomer(req, res) {
  const customer = await getShopCustomerFromRequest(req);
  if (!customer) {
    res.status(401).json({ ok: false, error: "SHOP_UNAUTHENTICATED" });
    return null;
  }
  return customer;
}

function normalizeOrder(row) {
  return {
    id: row.id,
    public_code: row.public_code,
    branch_id: row.branch_id,
    customer_id: row.customer_id,
    status: row.status,
    payment_status: row.payment_status,
    checkout_provider: row.checkout_provider,
    currency: row.currency,
    subtotal: Number(row.subtotal),
    discount_total: Number(row.discount_total),
    shipping_total: Number(row.shipping_total),
    total: Number(row.total),
    fulfillment_type: row.fulfillment_type,
    ship_name: row.ship_name,
    ship_phone: row.ship_phone,
    ship_address1: row.ship_address1,
    ship_address2: row.ship_address2,
    ship_city: row.ship_city,
    ship_province: row.ship_province,
    ship_zip: row.ship_zip,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    paid_at: row.paid_at,
    cancelled_at: row.cancelled_at,
    items: [],
    payments: [],
  };
}

async function listMyOrders(req, res) {
  const customer = await requireShopCustomer(req, res);
  if (!customer) return;

  const limit = safeLimit(req.query.limit);
  const offset = Math.max(0, toInt(req.query.offset, 0));

  // 1) Orders
  const [ordersRows] = await db.sequelize.query(
    `
    SELECT *
    FROM ecom_orders
    WHERE customer_id = :customer_id
    ORDER BY created_at DESC
    LIMIT :limit OFFSET :offset
    `,
    {
      replacements: {
        customer_id: customer.id,
        limit,
        offset,
      },
    }
  );

  const orders = ordersRows.map(normalizeOrder);
  const orderIds = orders.map((o) => o.id);

  if (orderIds.length === 0) {
    return res.json({
      ok: true,
      customer_id: customer.id,
      paging: { limit, offset, returned: 0 },
      orders: [],
    });
  }

  // 2) Items (batch)
  const [itemsRows] = await db.sequelize.query(
    `
    SELECT *
    FROM ecom_order_items
    WHERE order_id IN (:order_ids)
    ORDER BY id ASC
    `,
    { replacements: { order_ids: orderIds } }
  );

  // 3) Payments (batch)
  const [paymentsRows] = await db.sequelize.query(
    `
    SELECT *
    FROM ecom_payments
    WHERE order_id IN (:order_ids)
    ORDER BY id DESC
    `,
    { replacements: { order_ids: orderIds } }
  );

  const byId = new Map();
  for (const o of orders) byId.set(o.id, o);

  for (const it of itemsRows) {
    const o = byId.get(it.order_id);
    if (!o) continue;
    o.items.push({
      id: it.id,
      order_id: it.order_id,
      product_id: it.product_id,
      qty: Number(it.qty),
      unit_price: Number(it.unit_price),
      line_total: Number(it.line_total),
      created_at: it.created_at,
      updated_at: it.updated_at,
    });
  }

  for (const p of paymentsRows) {
    const o = byId.get(p.order_id);
    if (!o) continue;
    o.payments.push({
      id: p.id,
      order_id: p.order_id,
      provider: p.provider,
      method: p.method,
      status: p.status,
      amount: Number(p.amount),
      currency: p.currency,
      reference: p.reference,
      external_id: p.external_id,
      external_reference: p.external_reference,
      mp_preference_id: p.mp_preference_id,
      mp_payment_id: p.mp_payment_id,
      mp_merchant_order_id: p.mp_merchant_order_id,
      external_status: p.external_status,
      status_detail: p.status_detail,
      payer_email: p.payer_email,
      proof_url: p.proof_url,
      bank_reference: p.bank_reference,
      created_at: p.created_at,
      updated_at: p.updated_at,
      paid_at: p.paid_at,
    });
  }

  return res.json({
    ok: true,
    customer_id: customer.id,
    paging: { limit, offset, returned: orders.length },
    orders,
  });
}

async function getMyOrderDetail(req, res) {
  const customer = await requireShopCustomer(req, res);
  if (!customer) return;

  const rawId = String(req.params.id || "").trim();

  const byNumericId = /^[0-9]+$/.test(rawId);
  const where = byNumericId ? "id = :id" : "public_code = :id";

  const [rows] = await db.sequelize.query(
    `
    SELECT *
    FROM ecom_orders
    WHERE customer_id = :customer_id AND ${where}
    LIMIT 1
    `,
    { replacements: { customer_id: customer.id, id: rawId } }
  );

  const row = rows?.[0];
  if (!row) return res.status(404).json({ ok: false, error: "ORDER_NOT_FOUND" });

  const order = normalizeOrder(row);

  const [itemsRows] = await db.sequelize.query(
    `SELECT * FROM ecom_order_items WHERE order_id = :order_id ORDER BY id ASC`,
    { replacements: { order_id: order.id } }
  );

  const [paymentsRows] = await db.sequelize.query(
    `SELECT * FROM ecom_payments WHERE order_id = :order_id ORDER BY id DESC`,
    { replacements: { order_id: order.id } }
  );

  order.items = itemsRows.map((it) => ({
    id: it.id,
    order_id: it.order_id,
    product_id: it.product_id,
    qty: Number(it.qty),
    unit_price: Number(it.unit_price),
    line_total: Number(it.line_total),
    created_at: it.created_at,
    updated_at: it.updated_at,
  }));

  order.payments = paymentsRows.map((p) => ({
    id: p.id,
    order_id: p.order_id,
    provider: p.provider,
    method: p.method,
    status: p.status,
    amount: Number(p.amount),
    currency: p.currency,
    reference: p.reference,
    external_id: p.external_id,
    external_reference: p.external_reference,
    mp_preference_id: p.mp_preference_id,
    mp_payment_id: p.mp_payment_id,
    mp_merchant_order_id: p.mp_merchant_order_id,
    external_status: p.external_status,
    status_detail: p.status_detail,
    payer_email: p.payer_email,
    proof_url: p.proof_url,
    bank_reference: p.bank_reference,
    created_at: p.created_at,
    updated_at: p.updated_at,
    paid_at: p.paid_at,
  }));

  return res.json({ ok: true, order });
}

module.exports = {
  listMyOrders,
  getMyOrderDetail,
};
