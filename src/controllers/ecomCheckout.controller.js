// src/controllers/ecomCheckout.controller.js
// ✅ COPY-PASTE FINAL (DB-first payment methods)
//
// Qué corrige:
// - Respeta payment.method_code
// - Busca ecom_payment_methods (enabled=1) por code
// - Solo mercadopago crea redirect_url/mp
// - cash/transfer/credit_sjt/seller => NO redirect, provider correcto en ecom_payments
//
// Requisitos DB:
// - ecom_payment_methods (tu tabla nueva)
// - ecom_orders / ecom_order_items / ecom_customers / ecom_payments

const crypto = require("crypto");
const { sequelize } = require("../models");

// Si ya tenés un wrapper/servicio de MP en tu proyecto, reemplazá esta función
// por el que ya uses para crear preferencias.
async function createMercadoPagoPreference({ orderPublicCode, amount, buyer }) {
  // ✅ IMPORTANTE:
  // Este controller está DB-first y NO depende del SDK acá.
  // En tu proyecto actual ya estás creando MP porque te devuelve init_point.
  // Entonces: acá llamamos a un "hook" vía SQL/tabla/payload si ya lo tenés,
  // o devolvemos un error claro para que lo conectes a tu implementación real.

  // 👉 Si en tu proyecto existe un service tipo:
  // const mp = require("../services/mercadopago");
  // return await mp.createPreference(...)
  //
  // como no lo veo en esta conversación, dejo un "placeholder" seguro:
  throw new Error("MP_PREFERENCE_NOT_WIRED");
}

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

function genPublicCode() {
  return crypto.randomBytes(6).toString("hex"); // 12 chars
}

// POST /api/v1/ecom/checkout
async function ecomCheckout(req, res) {
  const body = req.body || {};

  const branch_id_input = toInt(body.branch_id, 0);
  const fulfillment_type = toStr(body.fulfillment_type).toLowerCase() || "pickup";

  const pickup_branch_id = toInt(body.pickup_branch_id, 0);

  const buyer = body.buyer || {};
  const buyer_name = toStr(buyer.name);
  const buyer_email = toStr(buyer.email).toLowerCase();
  const buyer_phone = toStr(buyer.phone);
  const buyer_doc = toStr(buyer.doc_number);

  const shipping = body.shipping || null; // puede ser null
  const payment = body.payment || {};
  const method_code = toStr(payment.method_code).toLowerCase();

  const items = Array.isArray(body.items) ? body.items : [];

  // ========= Validaciones mínimas =========
  if (!branch_id_input) {
    return res.status(400).json({
      ok: false,
      code: "MISSING_BRANCH",
      message: "Falta branch_id.",
    });
  }

  if (!["pickup", "delivery"].includes(fulfillment_type)) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_FULFILLMENT",
      message: "fulfillment_type inválido. Usar pickup o delivery.",
    });
  }

  if (fulfillment_type === "pickup" && !pickup_branch_id) {
    return res.status(400).json({
      ok: false,
      code: "MISSING_PICKUP_BRANCH",
      message: "Falta pickup_branch_id para retiro.",
    });
  }

  if (!buyer_name || !buyer_email || !buyer_phone) {
    return res.status(400).json({
      ok: false,
      code: "MISSING_BUYER",
      message: "Faltan datos del comprador (name/email/phone).",
    });
  }

  if (!method_code) {
    return res.status(400).json({
      ok: false,
      code: "MISSING_PAYMENT_METHOD",
      message: "Falta payment.method_code.",
    });
  }

  if (!items.length) {
    return res.status(400).json({
      ok: false,
      code: "EMPTY_CART",
      message: "No hay items para crear el pedido.",
    });
  }

  // ========= Resolver método DB-first =========
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
    });
  }

  if (!methodRow) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_PAYMENT_METHOD",
      message: `Método de pago inválido o deshabilitado: ${method_code}`,
    });
  }

  const provider = toStr(methodRow.provider).toLowerCase();
  const requires_redirect = !!methodRow.requires_redirect;

  // ========= Crear checkout (order + items + payment) =========
  const request_id = crypto.randomBytes(8).toString("hex");

  try {
    const result = await sequelize.transaction(async (t) => {
      // 1) upsert customer (simple, por email)
      let customer_id = null;

      const [crows] = await sequelize.query(
        `SELECT id FROM ecom_customers WHERE LOWER(email) = :email LIMIT 1`,
        { replacements: { email: buyer_email }, transaction: t }
      );

      if (crows?.[0]?.id) {
        customer_id = toInt(crows[0].id, 0);

        await sequelize.query(
          `
          UPDATE ecom_customers
          SET first_name = :first_name,
              last_name  = :last_name,
              phone      = :phone,
              doc_number = :doc_number,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = :id
          `,
          {
            replacements: {
              id: customer_id,
              first_name: buyer_name, // si tu schema separa nombres, adaptalo
              last_name: null,
              phone: buyer_phone || null,
              doc_number: buyer_doc || null,
            },
            transaction: t,
          }
        );
      } else {
        const [ins] = await sequelize.query(
          `
          INSERT INTO ecom_customers (email, first_name, last_name, phone, doc_number, created_at, updated_at)
          VALUES (:email, :first_name, :last_name, :phone, :doc_number, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `,
          {
            replacements: {
              email: buyer_email,
              first_name: buyer_name,
              last_name: null,
              phone: buyer_phone || null,
              doc_number: buyer_doc || null,
            },
            transaction: t,
          }
        );

        // mysql insert id
        customer_id = toInt(ins?.insertId, 0) || null;
      }

      // 2) Calcular totales (simple: toma price_list o price_discount desde products)
      //    Si tu proyecto calcula por otra tabla (prices/branch stock), acá adaptás el SELECT.
      const normalizedItems = items.map((it) => ({
        product_id: toInt(it.product_id, 0),
        qty: Math.max(1, toNum(it.qty, 1)),
      })).filter((x) => x.product_id > 0);

      if (!normalizedItems.length) {
        return { error: { status: 400, code: "INVALID_ITEMS", message: "Items inválidos." } };
      }

      // Traer nombres/precios desde products (fallback seguro)
      const productIds = normalizedItems.map((x) => x.product_id);
      const [prows] = await sequelize.query(
        `
        SELECT id, name,
               COALESCE(NULLIF(price_discount, 0), NULLIF(price_list, 0), NULLIF(price, 0), 0) AS unit_price
        FROM products
        WHERE id IN (:ids)
        `,
        { replacements: { ids: productIds }, transaction: t }
      );

      const priceMap = new Map((prows || []).map((p) => [toInt(p.id, 0), p]));

      let subtotal = 0;
      const orderItemsToInsert = [];

      for (const it of normalizedItems) {
        const p = priceMap.get(it.product_id);
        const unit_price = toNum(p?.unit_price, 0);
        const line_total = unit_price * toNum(it.qty, 1);

        subtotal += line_total;

        orderItemsToInsert.push({
          product_id: it.product_id,
          qty: it.qty,
          unit_price,
          line_total,
          product_name: p?.name || null,
        });
      }

      // shipping_total
      let shipping_total = 0;
      if (fulfillment_type === "delivery") {
        shipping_total = toNum(body.shipping_total, 0) || toNum(shipping?.amount, 0) || 0;
      }

      const total = subtotal + shipping_total;

      // 3) Insert order
      const public_code = genPublicCode();

      const branch_id_for_order = fulfillment_type === "pickup" ? pickup_branch_id : branch_id_input;

      // Shipping fields (si es pickup quedan null)
      const ship_name = fulfillment_type === "delivery" ? toStr(shipping?.contact_name || buyer_name) || null : null;
      const ship_phone = fulfillment_type === "delivery" ? toStr(shipping?.ship_phone || buyer_phone) || null : null;
      const ship_address1 = fulfillment_type === "delivery" ? toStr(shipping?.address1) || null : null;
      const ship_address2 = fulfillment_type === "delivery" ? toStr(shipping?.address2) || null : null;
      const ship_city = fulfillment_type === "delivery" ? toStr(shipping?.city) || null : null;
      const ship_province = fulfillment_type === "delivery" ? toStr(shipping?.province) || null : null;
      const ship_zip = fulfillment_type === "delivery" ? toStr(shipping?.zip) || null : null;

      // payment_status inicial:
      // - MP => pending
      // - transfer => pending (esperando comprobante)
      // - cash/credit_sjt/seller => unpaid (se paga offline)
      let order_payment_status = "unpaid";
      if (provider === "mercadopago") order_payment_status = "pending";
      else if (provider === "transfer") order_payment_status = "pending";

      const [oins] = await sequelize.query(
        `
        INSERT INTO ecom_orders
        (public_code, branch_id, customer_id, status, payment_status, currency,
         subtotal, discount_total, shipping_total, total, fulfillment_type,
         ship_name, ship_phone, ship_address1, ship_address2, ship_city, ship_province, ship_zip,
         created_at, updated_at)
        VALUES
        (:public_code, :branch_id, :customer_id, 'created', :payment_status, 'ARS',
         :subtotal, 0, :shipping_total, :total, :fulfillment_type,
         :ship_name, :ship_phone, :ship_address1, :ship_address2, :ship_city, :ship_province, :ship_zip,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        {
          replacements: {
            public_code,
            branch_id: branch_id_for_order,
            customer_id,
            payment_status: order_payment_status,
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
          },
          transaction: t,
        }
      );

      const order_id = toInt(oins?.insertId, 0);
      if (!order_id) {
        return { error: { status: 500, code: "ORDER_CREATE_FAILED", message: "No se pudo crear el pedido." } };
      }

      // 4) Insert order items
      for (const it of orderItemsToInsert) {
        await sequelize.query(
          `
          INSERT INTO ecom_order_items
          (order_id, product_id, qty, unit_price, line_total, created_at)
          VALUES
          (:order_id, :product_id, :qty, :unit_price, :line_total, CURRENT_TIMESTAMP)
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

      // 5) Crear payment según provider DB-first
      //    IMPORTANTE: para NO-MP => status created, sin redirect
      let paymentRow = null;

      if (provider !== "mercadopago") {
        const [pins] = await sequelize.query(
          `
          INSERT INTO ecom_payments
          (order_id, provider, status, amount, currency, external_reference, created_at, updated_at)
          VALUES
          (:order_id, :provider, 'created', :amount, 'ARS', :external_reference, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `,
          {
            replacements: {
              order_id,
              provider,
              amount: total,
              external_reference: public_code,
            },
            transaction: t,
          }
        );

        const pay_id = toInt(pins?.insertId, 0);

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

      // provider = mercadopago
      // ✅ acá se debe usar tu implementación real de Mercado Pago
      // Si NO lo conectás, te va a responder error claro MP_PREFERENCE_NOT_WIRED.
      const mp = await createMercadoPagoPreference({
        orderPublicCode: public_code,
        amount: total,
        buyer: { name: buyer_name, email: buyer_email, phone: buyer_phone, doc_number: buyer_doc },
      });

      // mp debe devolver { id, init_point, sandbox_init_point } (o similar)
      const mpPreferenceId = toStr(mp?.id) || null;
      const init_point = toStr(mp?.init_point) || null;
      const redirect_url = init_point || null;

      const [pins] = await sequelize.query(
        `
        INSERT INTO ecom_payments
        (order_id, provider, status, amount, currency, external_reference,
         mp_preference_id, external_status, created_at, updated_at)
        VALUES
        (:order_id, 'mercadopago', 'pending', :amount, 'ARS', :external_reference,
         :mp_preference_id, 'preference_created', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        {
          replacements: {
            order_id,
            amount: total,
            external_reference: public_code,
            mp_preference_id: mpPreferenceId,
          },
          transaction: t,
        }
      );

      const pay_id = toInt(pins?.insertId, 0);

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
        mp,
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

    return res.json({
      ok: true,
      request_id,
      ...result,
    });
  } catch (e) {
    // si MP no está cableado => error claro
    const msg = e?.message || String(e);

    if (msg === "MP_PREFERENCE_NOT_WIRED") {
      return res.status(500).json({
        ok: false,
        request_id,
        code: "MP_NOT_WIRED",
        message:
          "El checkout DB-first está listo, pero falta conectar createMercadoPagoPreference() con tu implementación real de Mercado Pago.",
      });
    }

    console.error("❌ ecomCheckout error:", e);
    return res.status(500).json({
      ok: false,
      request_id,
      code: "CHECKOUT_INTERNAL_ERROR",
      message: "Error interno en checkout.",
      detail: msg,
    });
  }
}

module.exports = {
  ecomCheckout,
};
