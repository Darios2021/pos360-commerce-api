// src/controllers/ecomCheckout.controller.js
// ✅ COPY-PASTE FINAL (DB-first real: orders + payments + MP)
// POST /api/v1/ecom/checkout

const crypto = require("crypto");
const { sequelize } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function toStr(v) {
  return String(v ?? "").trim();
}
function lower(v) {
  return toStr(v).toLowerCase();
}
function genPublicCode() {
  return crypto.randomBytes(6).toString("hex"); // 12 chars
}

async function getColumns(tableName, transaction) {
  const [rows] = await sequelize.query(
    `
    SELECT COLUMN_NAME AS name
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t
    `,
    { replacements: { t: tableName }, transaction }
  );
  return new Set((rows || []).map((r) => String(r.name)));
}

function buildDynamicInsert(table, colsSet, dataObj) {
  const data = {};
  for (const [k, v] of Object.entries(dataObj || {})) {
    if (v === undefined) continue;
    if (colsSet.has(k)) data[k] = v;
  }
  const keys = Object.keys(data);
  if (!keys.length) return null;

  const cols = keys.join(", ");
  const vals = keys.map((k) => `:${k}`).join(", ");
  return {
    sql: `INSERT INTO ${table} (${cols}) VALUES (${vals})`,
    replacements: data,
  };
}

/**
 * MercadoPago: crear preferencia via API (sin SDK)
 */
async function createMpPreference({ accessToken, publicBaseUrl, order, buyer, items }) {
  if (!accessToken) throw new Error("MP_ACCESS_TOKEN_MISSING");

  const base = String(publicBaseUrl || "").replace(/\/$/, "");
  if (!base) throw new Error("PUBLIC_BASE_URL_MISSING");

  const success = `${base}/shop/checkout/success?order=${order.public_code}`;
  const pending = `${base}/shop/checkout/pending?order=${order.public_code}`;
  const failure = `${base}/shop/checkout/failure?order=${order.public_code}`;

  const mpItems = (items || []).map((it) => ({
    title: String(it.product_name || `Producto #${it.product_id}`),
    quantity: Number(it.qty || 1),
    unit_price: Number(toNum(it.unit_price, 0)),
    currency_id: "ARS",
  }));

  if (!mpItems.length) {
    mpItems.push({
      title: `Pedido ${order.public_code}`,
      quantity: 1,
      unit_price: Number(toNum(order.total, 0)),
      currency_id: "ARS",
    });
  }

  const payload = {
    external_reference: order.public_code,
    payer: {
      name: String(buyer?.name || ""),
      email: String(buyer?.email || ""),
    },
    items: mpItems,
    back_urls: { success, pending, failure },
    auto_return: "approved",
    notification_url: `${base}/api/v1/ecom/webhooks/mercadopago`,
  };

  const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    const msg = data?.message || data?.error || `MP preference error HTTP ${r.status}`;
    const detail = data?.cause || data || null;
    const err = new Error(msg);
    err.detail = detail;
    throw err;
  }

  return {
    id: data.id || null,
    init_point: data.init_point || null,
    sandbox_init_point: data.sandbox_init_point || null,
    raw: data,
  };
}

// ✅ Export que espera el route: "checkout"
async function checkout(req, res) {
  const body = req.body || {};
  const request_id = crypto.randomBytes(8).toString("hex");

  const branch_id_input = toInt(body.branch_id, 0);
  const fulfillment_type = lower(body.fulfillment_type) || "pickup";
  const pickup_branch_id = toInt(body.pickup_branch_id, 0);

  const buyer = body.buyer || {};
  const buyer_name = toStr(buyer.name);
  const buyer_email = lower(buyer.email);
  const buyer_phone = toStr(buyer.phone);
  const buyer_doc = toStr(buyer.doc_number);

  const shipping = body.shipping || null;

  const payment = body.payment || {};
  const method_code = lower(payment.method_code);
  const payment_reference = toStr(payment.reference) || null;

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .map((it) => ({
      product_id: toInt(it.product_id, 0),
      qty: Math.max(1, toNum(it.qty, 1)),
    }))
    .filter((x) => x.product_id > 0);

  // ===== Validaciones =====
  if (!branch_id_input) {
    return res.status(400).json({ ok: false, code: "MISSING_BRANCH", message: "Falta branch_id.", request_id });
  }
  if (!["pickup", "delivery"].includes(fulfillment_type)) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_FULFILLMENT",
      message: "fulfillment_type inválido. Usar pickup o delivery.",
      request_id,
    });
  }
  if (fulfillment_type === "pickup" && !pickup_branch_id) {
    return res.status(400).json({
      ok: false,
      code: "MISSING_PICKUP_BRANCH",
      message: "Falta pickup_branch_id para retiro.",
      request_id,
    });
  }
  if (!buyer_name || !buyer_email || !buyer_phone) {
    return res.status(400).json({
      ok: false,
      code: "MISSING_BUYER",
      message: "Faltan datos del comprador (name/email/phone).",
      request_id,
    });
  }
  if (!method_code) {
    return res.status(400).json({
      ok: false,
      code: "MISSING_PAYMENT_METHOD",
      message: "Falta payment.method_code.",
      request_id,
    });
  }
  if (!items.length) {
    return res.status(400).json({ ok: false, code: "EMPTY_CART", message: "No hay items.", request_id });
  }

  // ===== Método DB-first =====
  let methodRow = null;
  try {
    const [mrows] = await sequelize.query(
      `
      SELECT code, title, provider, requires_redirect, allows_proof_upload, is_cash_like
      FROM ecom_payment_methods
      WHERE enabled = 1 AND LOWER(code) = :code
      LIMIT 1
      `,
      { replacements: { code: method_code } }
    );
    methodRow = mrows?.[0] || null;
  } catch (e) {
    return res.status(500).json({
      ok: false,
      code: "PAYMENT_METHODS_TABLE_ERROR",
      message: "Error leyendo ecom_payment_methods.",
      detail: e?.message || String(e),
      request_id,
    });
  }

  if (!methodRow) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_PAYMENT_METHOD",
      message: `Método de pago inválido o deshabilitado: ${method_code}`,
      request_id,
    });
  }

  const provider = lower(methodRow.provider); // mercadopago | cash | transfer | credit_sjt | seller
  const requires_redirect = !!methodRow.requires_redirect;

  // ===== Transacción =====
  try {
    const result = await sequelize.transaction(async (t) => {
      // ---- (A) Upsert customer (best-effort según columnas reales) ----
      let customer_id = null;

      const ccols = await getColumns("ecom_customers", t);

      if (ccols.has("email")) {
        const [crows] = await sequelize.query(
          `SELECT id FROM ecom_customers WHERE LOWER(email) = :email LIMIT 1`,
          { replacements: { email: buyer_email }, transaction: t }
        );
        customer_id = toInt(crows?.[0]?.id, 0) || null;

        const canUpdate =
          ccols.has("first_name") || ccols.has("last_name") || ccols.has("phone") || ccols.has("doc_number");

        if (customer_id && canUpdate) {
          const upd = {};
          if (ccols.has("first_name")) upd.first_name = buyer_name;
          if (ccols.has("last_name")) upd.last_name = null;
          if (ccols.has("phone")) upd.phone = buyer_phone || null;
          if (ccols.has("doc_number")) upd.doc_number = buyer_doc || null;
          if (ccols.has("updated_at")) upd.updated_at = new Date();

          const sets = Object.keys(upd)
            .map((k) => `${k} = :${k}`)
            .join(", ");

          if (sets) {
            await sequelize.query(`UPDATE ecom_customers SET ${sets} WHERE id = :id`, {
              replacements: { id: customer_id, ...upd },
              transaction: t,
            });
          }
        }

        if (!customer_id) {
          const ins = { email: buyer_email };
          if (ccols.has("first_name")) ins.first_name = buyer_name;
          if (ccols.has("last_name")) ins.last_name = null;
          if (ccols.has("phone")) ins.phone = buyer_phone || null;
          if (ccols.has("doc_number")) ins.doc_number = buyer_doc || null;
          if (ccols.has("created_at")) ins.created_at = new Date();
          if (ccols.has("updated_at")) ins.updated_at = new Date();

          const keys = Object.keys(ins);
          const cols = keys.join(", ");
          const vals = keys.map((k) => `:${k}`).join(", ");

          const [cres] = await sequelize.query(`INSERT INTO ecom_customers (${cols}) VALUES (${vals})`, {
            replacements: ins,
            transaction: t,
          });

          customer_id = toInt(cres?.insertId, 0) || null;
        }
      }

      // ---- (B) Traer productos + precios ----
      const productIds = items.map((x) => x.product_id);

      const [prows] = await sequelize.query(
        `
        SELECT id, name,
               COALESCE(NULLIF(price_discount, 0), NULLIF(price_list, 0), NULLIF(price, 0), 0) AS unit_price
        FROM products
        WHERE id IN (:ids)
        `,
        { replacements: { ids: productIds }, transaction: t }
      );

      const pmap = new Map((prows || []).map((p) => [toInt(p.id, 0), p]));

      let subtotal = 0;
      const orderItems = [];

      for (const it of items) {
        const p = pmap.get(it.product_id);
        if (!p) {
          return {
            error: { status: 400, code: "PRODUCT_NOT_FOUND", message: `Producto inexistente: ${it.product_id}` },
          };
        }

        const unit_price = toNum(p.unit_price, 0);
        const qty = toNum(it.qty, 1);
        const line_total = unit_price * qty;

        subtotal += line_total;

        orderItems.push({
          product_id: it.product_id,
          product_name: p.name || null,
          qty,
          unit_price,
          line_total,
        });
      }

      const shipping_total =
        fulfillment_type === "delivery"
          ? toNum(body.shipping_total, 0) || toNum(shipping?.amount, 0) || 0
          : 0;

      const total = subtotal + shipping_total;

      // ---- (C) Insert order (✅ DB-first real: solo columnas existentes) ----
      const public_code = genPublicCode();
      const branch_id_for_order = fulfillment_type === "pickup" ? pickup_branch_id : branch_id_input;

      let order_payment_status = "unpaid";
      if (provider === "mercadopago") order_payment_status = "pending";
      if (provider === "transfer") order_payment_status = "pending";

      const ocols = await getColumns("ecom_orders", t);

      const orderData = {
        public_code,
        branch_id: branch_id_for_order,
        customer_id: customer_id || null,
        status: "created",
        payment_status: order_payment_status,
        checkout_provider: provider || null,
        currency: "ARS",
        subtotal,
        discount_total: 0,
        shipping_total,
        total,
        fulfillment_type,

        // shipping fields (solo si existen)
        ship_name: fulfillment_type === "delivery" ? toStr(shipping?.contact_name || buyer_name) || null : null,
        ship_phone: fulfillment_type === "delivery" ? toStr(shipping?.ship_phone || buyer_phone) || null : null,
        ship_address1: fulfillment_type === "delivery" ? toStr(shipping?.address1) || null : null,
        ship_address2: fulfillment_type === "delivery" ? toStr(shipping?.address2) || null : null,
        ship_city: fulfillment_type === "delivery" ? toStr(shipping?.city) || null : null,
        ship_province: fulfillment_type === "delivery" ? toStr(shipping?.province) || null : null,
        ship_zip: fulfillment_type === "delivery" ? toStr(shipping?.zip) || null : null,
        notes: fulfillment_type === "delivery" ? toStr(shipping?.notes) || null : null,

        created_at: new Date(),
        updated_at: new Date(),
      };

      // fallback por si tu schema usa otros nombres comunes
      if (ocols.has("delivery_address") && orderData.ship_address1 && !orderData.delivery_address) {
        orderData.delivery_address = orderData.ship_address1;
      }
      if (ocols.has("pickup_branch_id") && fulfillment_type === "pickup") {
        orderData.pickup_branch_id = pickup_branch_id;
      }

      const insOrder = buildDynamicInsert("ecom_orders", ocols, orderData);
      if (!insOrder) {
        return { error: { status: 500, code: "ORDER_SCHEMA_EMPTY", message: "No hay columnas insertables en ecom_orders." } };
      }

      const [ores] = await sequelize.query(insOrder.sql, { replacements: insOrder.replacements, transaction: t });
      const order_id = toInt(ores?.insertId, 0);

      if (!order_id) {
        return { error: { status: 500, code: "ORDER_CREATE_FAILED", message: "No se pudo crear el pedido." } };
      }

      // ---- (D) Insert items ----
      for (const it of orderItems) {
        await sequelize.query(
          `
          INSERT INTO ecom_order_items (order_id, product_id, qty, unit_price, line_total, created_at)
          VALUES (:order_id, :product_id, :qty, :unit_price, :line_total, CURRENT_TIMESTAMP)
          `,
          {
            replacements: {
              order_id,
              product_id: it.product_id,
              qty: it.qty,
              unit_price: it.unit_price,
              line_total: it.line_total,
            },
            transaction: t,
          }
        );
      }

      // ---- (E) Insert payment (✅ DB-first real: solo columnas existentes) ----
      const pcols = await getColumns("ecom_payments", t);

      const basePaymentData = {
        order_id,
        provider,
        method: method_code || null,
        status: provider === "mercadopago" ? "pending" : "created",
        amount: total,
        currency: "ARS",
        reference: payment_reference,
        external_reference: public_code,
        external_status: provider === "mercadopago" ? "preference_created" : null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      // NO MP: guardamos payload si existe la columna
      if (provider !== "mercadopago") {
        const external_payload = {
          method_code,
          buyer: { name: buyer_name, email: buyer_email, phone: buyer_phone, doc_number: buyer_doc || null },
          fulfillment_type,
        };
        basePaymentData.external_payload = JSON.stringify(external_payload);

        const insPay = buildDynamicInsert("ecom_payments", pcols, basePaymentData);
        if (!insPay) {
          return { error: { status: 500, code: "PAYMENT_SCHEMA_EMPTY", message: "No hay columnas insertables en ecom_payments." } };
        }

        const [pres] = await sequelize.query(insPay.sql, { replacements: insPay.replacements, transaction: t });
        const pay_id = toInt(pres?.insertId, 0);

        return {
          order: {
            id: order_id,
            public_code,
            status: "created",
            fulfillment_type,
            branch_id: branch_id_for_order,
            subtotal,
            shipping_total,
            total,
            payment_status: order_payment_status,
          },
          payment: { id: pay_id, provider, status: "created", external_reference: public_code },
          redirect_url: null,
          mp: null,
        };
      }

      // MP: crear preferencia
      const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || "";
      const publicBaseUrl =
        process.env.PUBLIC_BASE_URL || process.env.FRONTEND_PUBLIC_URL || process.env.BASE_URL || "";

      const mp = await createMpPreference({
        accessToken,
        publicBaseUrl,
        order: { public_code, total },
        buyer: { name: buyer_name, email: buyer_email, phone: buyer_phone },
        items: orderItems,
      });

      const redirect_url = mp.init_point || null;

      const mpPayload = {
        mp_preference: { id: mp.id, init_point: mp.init_point, sandbox_init_point: mp.sandbox_init_point },
        mp_raw: mp.raw || null,
        method_code,
        buyer: { name: buyer_name, email: buyer_email, phone: buyer_phone, doc_number: buyer_doc || null },
        fulfillment_type,
      };

      const mpPaymentData = {
        ...basePaymentData,
        provider: "mercadopago",
        status: "pending",
        mp_preference_id: mp.id || null,
        external_payload: JSON.stringify(mpPayload),
      };

      const insPay = buildDynamicInsert("ecom_payments", pcols, mpPaymentData);
      if (!insPay) {
        return { error: { status: 500, code: "PAYMENT_SCHEMA_EMPTY", message: "No hay columnas insertables en ecom_payments." } };
      }

      const [pres] = await sequelize.query(insPay.sql, { replacements: insPay.replacements, transaction: t });
      const pay_id = toInt(pres?.insertId, 0);

      return {
        order: {
          id: order_id,
          public_code,
          status: "created",
          fulfillment_type,
          branch_id: branch_id_for_order,
          subtotal,
          shipping_total,
          total,
          payment_status: "pending",
        },
        payment: { id: pay_id, provider: "mercadopago", status: "pending", external_reference: public_code },
        redirect_url,
        mp: { id: mp.id, init_point: mp.init_point, sandbox_init_point: mp.sandbox_init_point },
      };
    });

    if (result?.error) {
      return res.status(result.error.status || 400).json({
        ok: false,
        code: result.error.code || "CHECKOUT_ERROR",
        message: result.error.message || "Error en checkout.",
        request_id,
      });
    }

    return res.json({ ok: true, request_id, ...result });
  } catch (e) {
    const detail = e?.detail || e?.original?.sqlMessage || e?.message || String(e);
    console.error("❌ checkout error:", e);

    return res.status(500).json({
      ok: false,
      code: "ORDER_CREATE_FAILED",
      message: "No se pudo crear el pedido.",
      detail,
      request_id,
    });
  }
}

module.exports = { checkout };
