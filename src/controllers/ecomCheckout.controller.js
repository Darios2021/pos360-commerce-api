// src/controllers/ecomCheckout.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (Checkout público ROBUSTO + MercadoPago REAL)
// - Crea ecom_orders + ecom_order_items + ecom_payments
// - Si método = MERCADOPAGO: crea preferencia MP y devuelve redirect_url (init_point)
// - Tokens SIEMPRE en ENV (NO en DB)
//
// Requiere ENV (real):
// - MERCADOPAGO_ACCESS_TOKEN
// Opcional:
// - ECOMMERCE_PUBLIC_URL (back_urls)
// - MP_NOTIFICATION_URL (webhook público)
// - MP_STATEMENT_DESCRIPTOR (<= 22 chars)
//
// Enable MP:
// - shop_settings('payments').mp_enabled (boolean)
// - y que exista MERCADOPAGO_ACCESS_TOKEN en ENV

const crypto = require("crypto");
const { sequelize } = require("../models");
const { createPreference } = require("../services/mercadopago.service");

// =====================
// Helpers
// =====================
function toNum(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toStr(v) {
  return String(v ?? "").trim();
}
function normalizeEmail(v) {
  const s = String(v || "").trim().toLowerCase();
  return s && s.includes("@") ? s : "";
}
function unitPriceFromProductRow(p) {
  const d = toNum(p.price_discount, 0);
  if (d > 0) return d;
  const l = toNum(p.price_list, 0);
  if (l > 0) return l;
  return toNum(p.price, 0);
}
function genPublicCode() {
  return crypto.randomBytes(8).toString("hex").slice(0, 12);
}
function pickInsertId(qres) {
  try {
    if (!Array.isArray(qres)) return null;
    const a = qres[0];
    const b = qres[1];
    const cand = [];
    if (a && typeof a === "object") cand.push(a.insertId, a?.[0]?.insertId);
    if (b && typeof b === "object") cand.push(b.insertId, b?.[0]?.insertId);
    const id = cand.map((x) => Number(x)).find((x) => Number.isFinite(x) && x > 0);
    return id || null;
  } catch {
    return null;
  }
}

async function viewExists(viewName, t) {
  const [r] = await sequelize.query(
    `
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = :name
    LIMIT 1
    `,
    { replacements: { name: viewName }, transaction: t }
  );
  return !!(r && r.length);
}

async function fetchActiveBranches(t) {
  const [rows] = await sequelize.query(
    `SELECT id, name, is_active FROM branches WHERE is_active = 1 ORDER BY id ASC`,
    { transaction: t }
  );
  return rows || [];
}

async function fetchProductsByIds(ids, t) {
  const [rows] = await sequelize.query(
    `
    SELECT 
      p.id,
      p.name,
      p.track_stock,
      p.price,
      p.price_list,
      p.price_discount
    FROM products p
    WHERE p.id IN (:ids)
    `,
    { replacements: { ids }, transaction: t }
  );
  return rows || [];
}

async function stockForBranch(branchId, productIds, t) {
  const okView = await viewExists("v_stock_by_branch_product", t);
  if (!okView) {
    const err = new Error("Falta la VIEW v_stock_by_branch_product (stock por sucursal).");
    err.code = "MISSING_STOCK_VIEW";
    throw err;
  }

  const [rows] = await sequelize.query(
    `
    SELECT product_id, qty
    FROM v_stock_by_branch_product
    WHERE branch_id = :branch_id
      AND product_id IN (:product_ids)
    `,
    { replacements: { branch_id: branchId, product_ids: productIds }, transaction: t }
  );

  const map = new Map();
  for (const r of rows || []) map.set(Number(r.product_id), toNum(r.qty, 0));
  return map;
}

async function branchCanFulfillAll(branchId, items, productsById, t) {
  const productIds = items.map((x) => Number(x.product_id));
  const stockMap = await stockForBranch(branchId, productIds, t);

  const missing = [];
  for (const it of items) {
    const pid = Number(it.product_id);
    const qty = toNum(it.qty, 0);
    const p = productsById.get(pid);

    if (!p) {
      missing.push({ product_id: pid, reason: "PRODUCT_NOT_FOUND" });
      continue;
    }

    if (Number(p.track_stock) === 1 || p.track_stock === true) {
      const avail = toNum(stockMap.get(pid), 0);
      if (avail < qty) {
        missing.push({ product_id: pid, requested: qty, available: avail, reason: "NO_STOCK" });
      }
    }
  }

  return { ok: missing.length === 0, missing };
}

async function pickBranchForDelivery(items, productsById, t) {
  const branches = await fetchActiveBranches(t);
  for (const b of branches) {
    const res = await branchCanFulfillAll(b.id, items, productsById, t);
    if (res.ok) return { branch_id: b.id, picked: true };
  }
  return { branch_id: null, picked: false };
}

async function upsertCustomer({ email, first_name, last_name, phone, doc_number }, t) {
  const em = normalizeEmail(email);
  if (!em) return null;

  const [existing] = await sequelize.query(
    `SELECT id FROM ecom_customers WHERE email = :email LIMIT 1`,
    { replacements: { email: em }, transaction: t }
  );

  if (existing && existing.length) {
    const id = Number(existing[0].id);

    await sequelize.query(
      `
      UPDATE ecom_customers
      SET 
        first_name = COALESCE(NULLIF(:first_name,''), first_name),
        last_name  = COALESCE(NULLIF(:last_name,''), last_name),
        phone      = COALESCE(NULLIF(:phone,''), phone),
        doc_number = COALESCE(NULLIF(:doc_number,''), doc_number),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
      `,
      {
        replacements: {
          id,
          first_name: String(first_name || "").trim(),
          last_name: String(last_name || "").trim(),
          phone: String(phone || "").trim(),
          doc_number: String(doc_number || "").trim(),
        },
        transaction: t,
      }
    );

    return id;
  }

  await sequelize.query(
    `
    INSERT INTO ecom_customers (email, first_name, last_name, phone, doc_number, created_at)
    VALUES (:email, :first_name, :last_name, :phone, :doc_number, CURRENT_TIMESTAMP)
    `,
    {
      replacements: {
        email: em,
        first_name: String(first_name || "").trim() || null,
        last_name: String(last_name || "").trim() || null,
        phone: String(phone || "").trim() || null,
        doc_number: String(doc_number || "").trim() || null,
      },
      transaction: t,
    }
  );

  const [r2] = await sequelize.query(`SELECT id FROM ecom_customers WHERE email = :email LIMIT 1`, {
    replacements: { email: em },
    transaction: t,
  });

  return r2?.[0]?.id ? Number(r2[0].id) : null;
}

function normalizeProvider(method) {
  const m = String(method || "").trim().toUpperCase();
  if (m === "MERCADOPAGO" || m === "MERCADO_PAGO" || m === "MP") return "mercadopago";
  if (m === "TRANSFER" || m === "TRANSFERENCIA") return "transfer";
  if (m === "CASH" || m === "EFECTIVO") return "cash";
  return "other";
}

async function getShopPaymentsSettings(t) {
  try {
    const [rows] = await sequelize.query(
      `SELECT value_json FROM shop_settings WHERE \`key\`='payments' LIMIT 1`,
      { transaction: t }
    );
    const val = rows?.[0]?.value_json || null;
    return val && typeof val === "object" ? val : {};
  } catch {
    return {};
  }
}

async function createOrder({ branch_id, customer_id, payload, subtotal, shipping_total, total, t }) {
  const public_code = genPublicCode();
  const fulfillment_type = payload.fulfillment_type === "delivery" ? "delivery" : "pickup";

  const ship = payload.shipping || {};
  const ship_name = String(payload?.contact?.name || payload?.ship_name || ship?.name || "").trim() || null;
  const ship_phone = String(payload?.contact?.phone || payload?.ship_phone || ship?.phone || "").trim() || null;

  const ship_address1 = String(ship.address1 || "").trim() || null;
  const ship_address2 = String(ship.address2 || "").trim() || null;
  const ship_city = String(ship.city || "").trim() || null;
  const ship_province = String(ship.province || "").trim() || null;
  const ship_zip = String(ship.zip || "").trim() || null;

  const notes = String(payload.notes || "").trim() || null;

  const qres = await sequelize.query(
    `
    INSERT INTO ecom_orders
      (public_code, branch_id, customer_id, status, payment_status, checkout_provider, currency,
       subtotal, discount_total, shipping_total, total,
       fulfillment_type,
       ship_name, ship_phone, ship_address1, ship_address2, ship_city, ship_province, ship_zip,
       notes,
       created_at)
    VALUES
      (:public_code, :branch_id, :customer_id, 'created', 'unpaid', NULL, 'ARS',
       :subtotal, 0.00, :shipping_total, :total,
       :fulfillment_type,
       :ship_name, :ship_phone, :ship_address1, :ship_address2, :ship_city, :ship_province, :ship_zip,
       :notes,
       CURRENT_TIMESTAMP)
    `,
    {
      replacements: {
        public_code,
        branch_id,
        customer_id: customer_id || null,
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

  let order_id = pickInsertId(qres);

  if (!order_id) {
    const [r] = await sequelize.query(
      `SELECT id FROM ecom_orders WHERE public_code = :public_code LIMIT 1`,
      { replacements: { public_code }, transaction: t }
    );
    order_id = r?.[0]?.id ? Number(r[0].id) : null;
  }

  if (!order_id) {
    const [r] = await sequelize.query(`SELECT LAST_INSERT_ID() AS id`, { transaction: t });
    order_id = r?.[0]?.id ? Number(r[0].id) : null;
  }

  if (!order_id) throw new Error("No se pudo crear el pedido (insertId vacío).");

  return { order_id, public_code };
}

async function createOrderItems({ order_id, items, productsById, t }) {
  for (const it of items) {
    const pid = Number(it.product_id);
    const qty = toNum(it.qty, 0);
    const p = productsById.get(pid);
    if (!p) throw new Error(`Producto no encontrado: ${pid}`);

    const unit_price = unitPriceFromProductRow(p);
    const line_total = Number((unit_price * qty).toFixed(2));

    await sequelize.query(
      `
      INSERT INTO ecom_order_items (order_id, product_id, qty, unit_price, line_total, created_at)
      VALUES (:order_id, :product_id, :qty, :unit_price, :line_total, CURRENT_TIMESTAMP)
      `,
      { replacements: { order_id, product_id: pid, qty, unit_price, line_total }, transaction: t }
    );
  }
}

async function setOrderPaymentMeta({ order_id, provider, payment_status, t }) {
  await sequelize.query(
    `
    UPDATE ecom_orders
    SET checkout_provider = :checkout_provider,
        payment_status = :payment_status,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :id
    `,
    {
      replacements: {
        id: order_id,
        checkout_provider: String(provider || "").toLowerCase(),
        payment_status: String(payment_status || "unpaid").toLowerCase(),
      },
      transaction: t,
    }
  );
}

async function createPayment({ order_id, provider, method, amount, reference, note, external_reference, t }) {
  const qres = await sequelize.query(
    `
    INSERT INTO ecom_payments
      (order_id, provider, method, status, amount, currency, reference, note, external_reference, created_at)
    VALUES
      (:order_id, :provider, :method, 'created', :amount, 'ARS', :reference, :note, :external_reference, CURRENT_TIMESTAMP)
    `,
    {
      replacements: {
        order_id,
        provider: String(provider || "other").toLowerCase(),
        method: method ? String(method).toLowerCase() : null,
        amount,
        reference: reference ? String(reference).trim() : null,
        note: note ? String(note).trim() : null,
        external_reference: external_reference ? String(external_reference).trim() : null,
      },
      transaction: t,
    }
  );

  let payment_id = pickInsertId(qres);

  if (!payment_id) {
    const [r] = await sequelize.query(
      `SELECT id FROM ecom_payments WHERE order_id = :order_id ORDER BY id DESC LIMIT 1`,
      { replacements: { order_id }, transaction: t }
    );
    payment_id = r?.[0]?.id ? Number(r[0].id) : null;
  }

  return { payment_id: payment_id || null, provider, status: "created" };
}

async function updatePaymentMpMeta({ payment_id, mpPref, externalRef, payer_email, t }) {
  if (!payment_id) return;

  await sequelize.query(
    `
    UPDATE ecom_payments
    SET
      status = 'pending',
      external_id = :external_id,
      external_reference = :external_reference,
      mp_preference_id = :mp_preference_id,
      external_status = 'preference_created',
      status_detail = NULL,
      payer_email = COALESCE(:payer_email, payer_email),
      external_payload = JSON_SET(COALESCE(external_payload, JSON_OBJECT()), '$.mp_preference', CAST(:mp_payload AS JSON)),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = :id
    `,
    {
      replacements: {
        id: payment_id,
        external_id: mpPref?.id || null,
        external_reference: externalRef || null,
        mp_preference_id: mpPref?.id || null,
        payer_email: payer_email ? String(payer_email).toLowerCase() : null,
        mp_payload: JSON.stringify(mpPref || {}),
      },
      transaction: t,
    }
  );
}

// ============================
// POST /api/v1/ecom/checkout
// ============================
async function checkout(req, res) {
  const payload = req.body || {};
  const items = Array.isArray(payload.items) ? payload.items : [];

  if (!items.length) return res.status(400).json({ message: "Carrito vacío." });

  const normItems = items
    .map((x) => ({
      product_id: toInt(x.product_id || x.id || 0, 0),
      qty: toNum(x.qty, 0),
    }))
    .filter((x) => x.product_id > 0 && x.qty > 0);

  if (!normItems.length) return res.status(400).json({ message: "Items inválidos." });

  const fulfillment_type = payload.fulfillment_type === "delivery" ? "delivery" : "pickup";
  const pickup_branch_id = toInt(payload.pickup_branch_id || 0, 0) || null;

  const pay_provider = normalizeProvider(payload?.payment?.method || payload?.pay_method || "mercadopago");
  const rawPayMethod = String(payload?.payment?.method || "").trim() || null;

  try {
    const result = await sequelize.transaction(async (t) => {
      const productIds = [...new Set(normItems.map((x) => x.product_id))];

      const products = await fetchProductsByIds(productIds, t);
      const productsById = new Map(products.map((p) => [Number(p.id), p]));

      for (const pid of productIds) {
        if (!productsById.has(pid)) {
          return { error: { status: 400, message: `Producto no existe: ${pid}`, code: "PRODUCT_NOT_FOUND" } };
        }
      }

      // Totales
      let subtotal = 0;
      for (const it of normItems) {
        const p = productsById.get(it.product_id);
        const up = unitPriceFromProductRow(p);
        subtotal += up * it.qty;
      }
      subtotal = Number(subtotal.toFixed(2));

      const shipping_total =
        fulfillment_type === "delivery" ? Number(toNum(payload.shipping_total, 0).toFixed(2)) : 0.0;

      const total = Number((subtotal + shipping_total).toFixed(2));

      // Customer
      const customerEmail = payload?.contact?.email || payload?.email || "";
      const customer_id = await upsertCustomer(
        {
          email: customerEmail,
          first_name: payload?.contact?.first_name || payload?.contact?.name || payload?.first_name,
          last_name: payload?.contact?.last_name || payload?.last_name,
          phone: payload?.contact?.phone || payload?.phone,
          doc_number: payload?.contact?.doc_number || payload?.doc_number,
        },
        t
      );

      // Branch
      let branch_id = null;

      if (fulfillment_type === "pickup") {
        if (!pickup_branch_id) {
          return { error: { status: 400, message: "Falta pickup_branch_id para retiro.", code: "MISSING_PICKUP_BRANCH" } };
        }

        const { ok, missing } = await branchCanFulfillAll(pickup_branch_id, normItems, productsById, t);
        if (!ok) {
          return {
            error: {
              status: 409,
              message: "Sin stock suficiente en la sucursal elegida.",
              code: "NO_STOCK_PICKUP",
              missing,
              pickup_branch_id,
            },
          };
        }

        branch_id = pickup_branch_id;
      } else {
        const pick = await pickBranchForDelivery(normItems, productsById, t);
        if (!pick.picked || !pick.branch_id) {
          return {
            error: {
              status: 409,
              message: "No hay stock suficiente para preparar el envío desde ninguna sucursal.",
              code: "NO_STOCK_DELIVERY",
            },
          };
        }
        branch_id = pick.branch_id;
      }

      // Order
      const { order_id, public_code } = await createOrder({
        branch_id,
        customer_id,
        payload,
        subtotal,
        shipping_total,
        total,
        t,
      });

      await createOrderItems({ order_id, items: normItems, productsById, t });

      await sequelize.query(
        `
        UPDATE ecom_orders
        SET subtotal = :subtotal, shipping_total = :shipping_total, total = :total, updated_at = CURRENT_TIMESTAMP
        WHERE id = :id
        `,
        { replacements: { id: order_id, subtotal, shipping_total, total }, transaction: t }
      );

      const externalRef = String(public_code || order_id);

      // Payment (ahora guarda method/reference/note/external_reference)
      const pay = await createPayment({
        order_id,
        provider: pay_provider,
        method: rawPayMethod,
        amount: total,
        reference: payload?.payment?.reference || null,
        note: payload?.payment?.note || null,
        external_reference: externalRef,
        t,
      });

      const paymentsCfg = await getShopPaymentsSettings(t);
      const mpEnabledByAdmin = !!paymentsCfg.mp_enabled;

      // Token real SOLO ENV
      const envMp = !!String(process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim();
      const isMp = pay_provider === "mercadopago";

      // default status order
      let orderPayStatus = "unpaid";

      // ==========================
      // ✅ MercadoPago REAL
      // ==========================
      let redirect_url = null;
      let mp = null;

      if (isMp) {
        if (!mpEnabledByAdmin) {
          return {
            error: { status: 400, code: "MP_DISABLED", message: "Mercado Pago está deshabilitado por configuración." },
          };
        }
        if (!envMp) {
          return {
            error: {
              status: 400,
              code: "MP_TOKEN_MISSING",
              message: "Mercado Pago no está habilitado en el servidor (falta MERCADOPAGO_ACCESS_TOKEN).",
            },
          };
        }

        const baseUrl = toStr(process.env.ECOMMERCE_PUBLIC_URL || process.env.FRONTEND_URL || process.env.APP_URL).replace(
          /\/+$/,
          ""
        );

        const mpItems = normItems.map((it) => {
          const p = productsById.get(it.product_id);
          const unit_price = unitPriceFromProductRow(p);
          return {
            id: String(it.product_id),
            title: String(p?.name || `Producto ${it.product_id}`),
            quantity: Number(toNum(it.qty, 1)),
            currency_id: "ARS",
            unit_price: Number(toNum(unit_price, 0)),
          };
        });

        const prefPayload = {
          external_reference: externalRef,
          items: mpItems,
          statement_descriptor: String(process.env.MP_STATEMENT_DESCRIPTOR || "SAN JUAN TECNOLOGIA").slice(0, 22),
          back_urls: baseUrl
            ? {
                success: `${baseUrl}/shop/checkout/success?order=${encodeURIComponent(externalRef)}`,
                pending: `${baseUrl}/shop/checkout/pending?order=${encodeURIComponent(externalRef)}`,
                failure: `${baseUrl}/shop/checkout/failure?order=${encodeURIComponent(externalRef)}`,
              }
            : undefined,
          auto_return: "approved",
          notification_url: process.env.MP_NOTIFICATION_URL || undefined,
          metadata: {
            order_id,
            public_code,
            branch_id,
            payment_id: pay.payment_id,
          },
        };

        if (!prefPayload.back_urls) delete prefPayload.back_urls;
        if (!prefPayload.notification_url) delete prefPayload.notification_url;

        const mpPref = await createPreference(prefPayload);

        await updatePaymentMpMeta({
          payment_id: pay.payment_id,
          mpPref,
          externalRef,
          payer_email: customerEmail,
          t,
        });

        redirect_url = mpPref?.init_point || mpPref?.sandbox_init_point || null;
        mp = {
          id: mpPref?.id || null,
          init_point: mpPref?.init_point || null,
          sandbox_init_point: mpPref?.sandbox_init_point || null,
        };

        if (!redirect_url) {
          return {
            error: {
              status: 500,
              code: "MP_NO_REDIRECT",
              message: "Mercado Pago no devolvió init_point (preferencia inválida).",
              detail: mpPref || null,
            },
          };
        }

        orderPayStatus = "pending";
      }

      // set order meta final
      await setOrderPaymentMeta({ order_id, provider: pay_provider, payment_status: orderPayStatus, t });

      return {
        order: {
          id: order_id,
          public_code,
          status: "created",
          fulfillment_type,
          branch_id,
          subtotal,
          shipping_total,
          total,
          payment_status: orderPayStatus,
        },
        payment: {
          id: pay.payment_id,
          provider: pay.provider,
          status: isMp ? "pending" : pay.status,
          external_reference: externalRef,
        },
        redirect_url,
        mp,
      };
    });

    if (result?.error) return res.status(result.error.status || 400).json(result.error);
    return res.json(result);
  } catch (e) {
    const detail = e?.message || String(e);

    if (e?.code === "MISSING_STOCK_VIEW") {
      return res.status(500).json({
        message: "No se puede validar stock por sucursal.",
        code: "MISSING_STOCK_VIEW",
        detail,
      });
    }

    console.error("❌ checkout error:", e);
    return res.status(500).json({ message: "Error creando el pedido.", detail });
  }
}

module.exports = { checkout };
