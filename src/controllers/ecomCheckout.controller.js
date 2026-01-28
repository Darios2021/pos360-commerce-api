// src/controllers/ecomCheckout.controller.js
// ✅ COPY-PASTE FINAL (DB-first payment methods + MP real)
// POST /api/v1/ecom/checkout
//
// Input esperado:
// {
//   branch_id: 3,
//   fulfillment_type: "pickup" | "delivery",
//   pickup_branch_id?: 3,
//   buyer: { name, email, phone, doc_number? },
//   shipping?: { contact_name?, ship_phone?, address1, address2?, city, province, zip, notes? },
//   payment: { method_code: "cash"|"transfer"|"mercadopago"|"credit_sjt"|"seller", reference? },
//   items: [ { product_id, qty } ]
// }
//
// DB:
// - ecom_orders (tu schema actual)
// - ecom_order_items
// - ecom_payments
// - ecom_customers (se hace upsert "best-effort" por email)
// - ecom_payment_methods (enabled=1)

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

function pick(obj, keys, transformFn) {
  const out = {};
  for (const k of keys) {
    if (obj[k] === undefined) continue;
    out[k] = transformFn ? transformFn(obj[k], k) : obj[k];
  }
  return out;
}

/**
 * MercadoPago: crear preferencia via API (sin SDK)
 */
async function createMpPreference({ accessToken, publicBaseUrl, order, buyer, items }) {
  if (!accessToken) throw new Error("MP_ACCESS_TOKEN_MISSING");

  // back_urls (ajustá si ya tenés rutas específicas en shop)
  const success = `${publicBaseUrl.replace(/\/$/, "")}/shop/checkout/success?order=${order.public_code}`;
  const pending = `${publicBaseUrl.replace(/\/$/, "")}/shop/checkout/pending?order=${order.public_code}`;
  const failure = `${publicBaseUrl.replace(/\/$/, "")}/shop/checkout/failure?order=${order.public_code}`;

  const mpItems = items.map((it) => ({
    title: String(it.product_name || `Producto #${it.product_id}`),
    quantity: Number(it.qty || 1),
    unit_price: Number(toNum(it.unit_price, 0)),
    currency_id: "ARS",
  }));

  // Si no querés mandar items detallados, podés mandar 1 item con el total.
  // Pero así está perfecto para trazabilidad.
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
    notification_url: `${publicBaseUrl.replace(/\/$/, "")}/api/v1/ecom/webhooks/mercadopago`,
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

      // Miramos columnas reales para no romper si tu tabla difiere
      const ccols = await getColumns("ecom_customers", t);

      // Buscar por email si existe columna email
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

          // updated_at si existe
          if (ccols.has("updated_at")) upd.updated_at = new Date();

          // armar SET dinámico
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
          // Insert mínimo: email + lo que exista
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
      // OJO: tu products (por tu API) tiene price, price_list, price_discount
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

      // ---- (C) Insert order (con tu schema exacto) ----
      const public_code = genPublicCode();

      // Para retiro: branch_id = pickup_branch_id
      const branch_id_for_order = fulfillment_type === "pickup" ? pickup_branch_id : branch_id_input;

      const ship_name =
        fulfillment_type === "delivery" ? toStr(shipping?.contact_name || buyer_name) || null : null;
      const ship_phone =
        fulfillment_type === "delivery" ? toStr(shipping?.ship_phone || buyer_phone) || null : null;
      const ship_address1 = fulfillment_type === "delivery" ? toStr(shipping?.address1) || null : null;
      const ship_address2 = fulfillment_type === "delivery" ? toStr(shipping?.address2) || null : null;
      const ship_city = fulfillment_type === "delivery" ? toStr(shipping?.city) || null : null;
      const ship_province = fulfillment_type === "delivery" ? toStr(shipping?.province) || null : null;
      const ship_zip = fulfillment_type === "delivery" ? toStr(shipping?.zip) || null : null;

      // payment_status:
      // - mercadopago => pending
      // - transfer => pending
      // - cash/credit/seller => unpaid
      let order_payment_status = "unpaid";
      if (provider === "mercadopago") order_payment_status = "pending";
      if (provider === "transfer") order_payment_status = "pending";

      const notes = fulfillment_type === "delivery" ? toStr(shipping?.notes) || null : null;

      const [ores] = await sequelize.query(
        `
        INSERT INTO ecom_orders
        (public_code, branch_id, customer_id, status, payment_status, checkout_provider, currency,
         subtotal, discount_total, shipping_total, total, fulfillment_type,
         ship_name, ship_phone, ship_address1, ship_address2, ship_city, ship_province, ship_zip,
         notes, created_at, updated_at)
        VALUES
        (:public_code, :branch_id, :customer_id, 'created', :payment_status, :checkout_provider, 'ARS',
         :subtotal, 0, :shipping_total, :total, :fulfillment_type,
         :ship_name, :ship_phone, :ship_address1, :ship_address2, :ship_city, :ship_province, :ship_zip,
         :notes, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        {
          replacements: {
            public_code,
            branch_id: branch_id_for_order,
            customer_id,
            payment_status: order_payment_status,
            checkout_provider: provider || null,
            subtotal,
            shipping_total,
            total,
            fulfillment_type,
            ship_name,
            ship_phone,
            ship_address1,
            ship_address2,
            ship_city,
            ship_province,
            ship_zip,
            notes,
          },
          transaction: t,
        }
      );

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

      // ---- (E) Insert payment ----
      // ecom_payments: provider + method + status + amount + reference + external_payload + mp_*
      let paymentRow = null;

      if (provider !== "mercadopago") {
        const external_payload = {
          method_code,
          buyer: { name: buyer_name, email: buyer_email, phone: buyer_phone, doc_number: buyer_doc || null },
          fulfillment_type,
        };

        const [pres] = await sequelize.query(
          `
          INSERT INTO ecom_payments
          (order_id, provider, method, status, amount, currency, reference, external_reference, external_payload, created_at, updated_at)
          VALUES
          (:order_id, :provider, :method, 'created', :amount, 'ARS', :reference, :external_reference, :external_payload, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `,
          {
            replacements: {
              order_id,
              provider,
              method: method_code || null,
              amount: total,
              reference: payment_reference,
              external_reference: public_code,
              external_payload: JSON.stringify(external_payload),
            },
            transaction: t,
          }
        );

        const pay_id = toInt(pres?.insertId, 0);

        paymentRow = {
          id: pay_id,
          provider,
          status: "created",
          external_reference: public_code,
        };

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
          payment: paymentRow,
          redirect_url: null,
          mp: null,
        };
      }

      // provider === mercadopago
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

      const [pres] = await sequelize.query(
        `
        INSERT INTO ecom_payments
        (order_id, provider, method, status, amount, currency, external_reference,
         mp_preference_id, external_status, external_payload, created_at, updated_at)
        VALUES
        (:order_id, 'mercadopago', :method, 'pending', :amount, 'ARS', :external_reference,
         :mp_preference_id, 'preference_created', :external_payload, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        {
          replacements: {
            order_id,
            method: method_code || null,
            amount: total,
            external_reference: public_code,
            mp_preference_id: mp.id || null,
            external_payload: JSON.stringify(mpPayload),
          },
          transaction: t,
        }
      );

      const pay_id = toInt(pres?.insertId, 0);

      paymentRow = {
        id: pay_id,
        provider: "mercadopago",
        status: "pending",
        external_reference: public_code,
      };

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
        payment: paymentRow,
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
