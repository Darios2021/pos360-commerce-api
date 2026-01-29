// src/controllers/ecomCheckout.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
// POST /api/v1/ecom/checkout
//
// Cambios clave:
// - ✅ Soporta MP_MODE test/prod (desde DB payments.mp_mode o process.env.MP_MODE)
// - ✅ Usa tokens separados: MERCADOPAGO_ACCESS_TOKEN_TEST / _PROD
// - ✅ En TEST usa sandbox_init_point y excluye account_money (saldo) ✅ FIX correcto
// - ✅ notification_url usa MP_NOTIFICATION_URL si existe
// - ✅ Mantiene DB-first y FIX insertId con LAST_INSERT_ID()

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

// ✅ FIX: fallback a LAST_INSERT_ID() dentro de la misma transacción
async function getLastInsertId(transaction) {
  const [rows] = await sequelize.query(`SELECT LAST_INSERT_ID() AS id`, { transaction });
  return toInt(rows?.[0]?.id, 0) || 0;
}

/* ============================================================
   SETTINGS (DB) — best effort
   Queremos leer payments.mp_mode si existe.
   Detecta automáticamente si hay una tabla de settings conocida.
============================================================ */
async function tableExists(tableName, transaction) {
  const [rows] = await sequelize.query(
    `
    SELECT COUNT(*) AS c
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t
    `,
    { replacements: { t: tableName }, transaction }
  );
  return toInt(rows?.[0]?.c, 0) > 0;
}

// Best effort: lee el setting "payments" desde alguna tabla común.
// Soporta esquemas típicos:
// - shop_settings(key, value)
// - ecom_settings(key, value)
// - settings(key, value)
// y variantes (name/code en vez de key).
// Best effort: lee el setting "payments" desde alguna tabla común.
// Soporta esquemas típicos:
// - shop_settings(key, value)
// - shop_settings(key, value_json) ✅
// - ecom_settings(key, value)
// - settings(key, value)
// y variantes (name/code en vez de key).
// Best effort: lee el setting "payments" desde alguna tabla común.
// Soporta esquemas típicos:
// - shop_settings(key, value_json/value/json/data)
// - ecom_settings(key, value/json/data)
// - settings(key, value/json/data)
// y variantes (name/code en vez de key).
// Best effort: lee el setting "payments" desde alguna tabla común.
// Soporta esquemas típicos:
// - shop_settings(key, value_json/value/json/data)
// - ecom_settings(key, value/json/data)
// - settings(key, value/json/data)
// y variantes (name/code en vez de key).
async function loadPaymentsSetting(transaction) {
  const candidates = ["shop_settings", "ecom_settings", "settings"];
  let table = null;

  for (const tname of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await tableExists(tname, transaction)) {
      table = tname;
      break;
    }
  }
  if (!table) return null;

  const cols = await getColumns(table, transaction);

  const keyCol = cols.has("key")
    ? "key"
    : cols.has("name")
    ? "name"
    : cols.has("code")
    ? "code"
    : null;

  // ✅ FIX CLAVE: soportar value_json (tu caso real)
  const valCol = cols.has("value_json")
    ? "value_json"
    : cols.has("value")
    ? "value"
    : cols.has("json")
    ? "json"
    : cols.has("data")
    ? "data"
    : null;

  if (!keyCol || !valCol) return null;

  const [rows] = await sequelize.query(
    `SELECT \`${valCol}\` AS v FROM \`${table}\` WHERE \`${keyCol}\` = :k LIMIT 1`,
    { replacements: { k: "payments" }, transaction }
  );

  const raw = rows?.[0]?.v ?? null;
  if (!raw) return null;

  // value_json puede venir como string JSON o ya objeto
  if (typeof raw === "object") return raw;

  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}


/* ============================================================
   MERCADOPAGO MODE + TOKENS
============================================================ */

function normalizeMpMode(v) {
  const m = lower(v);
  if (m === "test" || m === "sandbox") return "test";
  if (m === "prod" || m === "production" || m === "live") return "prod";
  return "";
}

function pickEnvToken(mode) {
  if (mode === "test") return toStr(process.env.MERCADOPAGO_ACCESS_TOKEN_TEST);
  if (mode === "prod") return toStr(process.env.MERCADOPAGO_ACCESS_TOKEN_PROD);

  // fallback legacy (si alguien aún usa MERCADOPAGO_ACCESS_TOKEN único)
  const legacy = toStr(process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN);
  return legacy;
}

async function resolveMpRuntimeConfig(transaction) {
  // 1) DB setting payments.mp_mode (si existe)
  let dbMode = "";
  try {
    const payments = await loadPaymentsSetting(transaction);
    dbMode = normalizeMpMode(payments?.mp_mode);
  } catch {
    // ignore
  }

  // 2) env MP_MODE
  const envMode = normalizeMpMode(process.env.MP_MODE);

  const mode = dbMode || envMode || "prod"; // default prod (si tu server está en producción)
  const accessToken = pickEnvToken(mode);

  const publicBaseUrl =
    toStr(process.env.PUBLIC_BASE_URL) ||
    toStr(process.env.ECOMMERCE_PUBLIC_URL) ||
    toStr(process.env.FRONTEND_PUBLIC_URL) ||
    toStr(process.env.BASE_URL);

  // Preferimos env explícito
  const notificationUrl =
    toStr(process.env.MP_NOTIFICATION_URL) ||
    (publicBaseUrl ? `${String(publicBaseUrl).replace(/\/$/, "")}/api/v1/webhooks/mercadopago` : "");

  return { mode, accessToken, publicBaseUrl, notificationUrl };
}

/**
 * MercadoPago: crear preferencia via API (sin SDK)
 */
/**
 * MercadoPago: crear preferencia via API (sin SDK)
 * ✅ FIX: si MP rechaza excluir account_money => reintenta SIN excluir
 */
async function createMpPreference({ accessToken, publicBaseUrl, notificationUrl, mode, order, buyer, items }) {
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

  const basePayload = {
    external_reference: order.public_code,
    payer: {
      name: String(buyer?.name || ""),
      email: String(buyer?.email || ""),
    },
    items: mpItems,
    back_urls: { success, pending, failure },
    auto_return: "approved",
    notification_url: notificationUrl || `${base}/api/v1/webhooks/mercadopago`,
  };

  // 1) Primer intento: en TEST tratamos de excluir saldo (si MP lo permite)
  const payload1 = { ...basePayload };

  if (mode === "test") {
    payload1.payment_methods = {
      excluded_payment_methods: [{ id: "account_money" }],
    };
  }

  async function mpCreatePreference(payload) {
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
      err.http_status = r.status;
      err.mp_body = data;
      throw err;
    }

    return data;
  }

  try {
    const data = await mpCreatePreference(payload1);
    return {
      id: data.id || null,
      init_point: data.init_point || null,
      sandbox_init_point: data.sandbox_init_point || null,
      raw: data,
    };
  } catch (e) {
    const msg = String(e?.message || "").toLowerCase();
    const bodyMsg = String(e?.mp_body?.message || "").toLowerCase();

    const isAccountMoneyRejected =
      msg.includes("account_money") ||
      bodyMsg.includes("account_money") ||
      JSON.stringify(e?.mp_body || {}).toLowerCase().includes("account_money");

    // 2) Fallback: si MP no permite excluir account_money -> reintenta sin payment_methods
    if (mode === "test" && isAccountMoneyRejected) {
      console.warn("⚠️ MP rechazó excluir account_money. Reintentando sin payment_methods...", {
        mp_message: e?.message,
        mp_body: e?.mp_body || null,
      });

      const payload2 = { ...basePayload }; // sin payment_methods
      const data2 = await mpCreatePreference(payload2);

      return {
        id: data2.id || null,
        init_point: data2.init_point || null,
        sandbox_init_point: data2.sandbox_init_point || null,
        raw: data2,
      };
    }

    throw e;
  }
}



// =========================
// Normalizadores (compat front)
// =========================
function normalizeFulfillmentType(body) {
  let ft = lower(body?.fulfillment_type);
  if (!ft) ft = lower(body?.delivery?.mode);
  if (ft === "shipping") ft = "delivery";
  if (ft !== "pickup" && ft !== "delivery") ft = "pickup";
  return ft;
}

function normalizePickupBranchId(body) {
  let id = toInt(body?.pickup_branch_id, 0);
  if (!id) id = toInt(body?.delivery?.pickup_branch_id, 0);
  return id;
}

function normalizeShipping(body) {
  const s = body?.shipping || body?.delivery || null;
  return s && typeof s === "object" ? s : null;
}

function normalizePayment(body) {
  const p = body?.payment && typeof body.payment === "object" ? body.payment : {};
  const x = { ...p };

  let code = lower(x.method_code);

  const legacy = toStr(x.method).toUpperCase();
  if (!code) {
    if (legacy === "MERCADO_PAGO") code = "mercadopago";
    else if (legacy === "TRANSFER") code = "transfer";
    else if (legacy === "CASH") code = "cash";
    else if (legacy === "AGREE") code = "seller";
    else if (legacy === "CREDIT_SJT") code = "credit_sjt";
  }

  const prov = lower(x.provider);
  if (!code && prov) code = prov;

  const allowed = new Set(["mercadopago", "transfer", "cash", "credit_sjt", "seller"]);
  if (!allowed.has(code)) code = "";

  x.method_code = code;
  x.reference = toStr(x.reference) || null;

  return x;
}

// ✅ Export que espera el route: "checkout"
async function checkout(req, res) {
  const body = req.body || {};
  const request_id = crypto.randomBytes(8).toString("hex");

  const branch_id_input = toInt(body.branch_id, 0);
  const fulfillment_type = normalizeFulfillmentType(body);
  const pickup_branch_id = normalizePickupBranchId(body);

  const buyer = body.buyer || {};
  const buyer_name = toStr(buyer.name);
  const buyer_email = lower(buyer.email);
  const buyer_phone = toStr(buyer.phone);
  const buyer_doc = toStr(buyer.doc_number);

  const shipping = normalizeShipping(body);

  const payment = normalizePayment(body);
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
      message: "Falta payment.method_code (o legacy method/provider).",
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
    const detail = e?.original?.sqlMessage || e?.original?.message || e?.sqlMessage || e?.message || String(e);

    console.error("❌ PAYMENT_METHODS_TABLE_ERROR", { request_id, detail });

    return res.status(500).json({
      ok: false,
      code: "PAYMENT_METHODS_TABLE_ERROR",
      message: "Error leyendo ecom_payment_methods.",
      detail,
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

  const provider = lower(methodRow.provider);

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

          // ✅ FIX: si no viene insertId
          customer_id = toInt(cres?.insertId, 0) || (await getLastInsertId(t)) || null;
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

      // ---- (C) Insert order ----
      const public_code = genPublicCode();
      const branch_id_for_order = fulfillment_type === "pickup" ? pickup_branch_id : branch_id_input;

      const ship_name = fulfillment_type === "delivery" ? toStr(shipping?.contact_name || buyer_name) || null : null;
      const ship_phone = fulfillment_type === "delivery" ? toStr(shipping?.ship_phone || buyer_phone) || null : null;
      const ship_address1 = fulfillment_type === "delivery" ? toStr(shipping?.address1) || null : null;
      const ship_address2 = fulfillment_type === "delivery" ? toStr(shipping?.address2) || null : null;
      const ship_city = fulfillment_type === "delivery" ? toStr(shipping?.city) || null : null;
      const ship_province = fulfillment_type === "delivery" ? toStr(shipping?.province) || null : null;
      const ship_zip = fulfillment_type === "delivery" ? toStr(shipping?.zip) || null : null;

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

      // ✅ FIX: insertId robusto
      let order_id = toInt(ores?.insertId, 0);
      if (!order_id) order_id = await getLastInsertId(t);

      if (!order_id) {
        return {
          error: {
            status: 500,
            code: "ORDER_CREATE_FAILED",
            message: "No se pudo crear el pedido.",
            detail: { debug: "NO_INSERT_ID", ores: ores || null },
          },
        };
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

      // ---- (E) Insert payment (NO MP) ----
      if (provider !== "mercadopago") {
        const external_payload = {
          method_code,
          buyer: { name: buyer_name, email: buyer_email, phone: buyer_phone, doc_number: buyer_doc || null },
          fulfillment_type,
          pickup_branch_id: pickup_branch_id || null,
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

        let pay_id = toInt(pres?.insertId, 0);
        if (!pay_id) pay_id = await getLastInsertId(t);

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
          payment: {
            id: pay_id || null,
            provider,
            status: "created",
            external_reference: public_code,
          },
          redirect_url: null,
          mp: null,
        };
      }

      // ---- (F) MercadoPago ----
      const mpCfg = await resolveMpRuntimeConfig(t);

      if (!mpCfg.accessToken) {
        return {
          error: {
            status: 400,
            code: "MP_NOT_CONFIGURED",
            message: "Mercado Pago no disponible: falta configuración en el servidor.",
            detail: {
              mp_mode: mpCfg.mode,
              missing: mpCfg.mode === "test" ? "MERCADOPAGO_ACCESS_TOKEN_TEST" : "MERCADOPAGO_ACCESS_TOKEN_PROD",
            },
          },
        };
      }

      const mp = await createMpPreference({
        accessToken: mpCfg.accessToken,
        publicBaseUrl: mpCfg.publicBaseUrl,
        notificationUrl: mpCfg.notificationUrl,
        mode: mpCfg.mode,
        order: { public_code, total },
        buyer: { name: buyer_name, email: buyer_email, phone: buyer_phone },
        items: orderItems,
      });

      // ✅ En TEST usamos sandbox_init_point
      const redirect_url =
        mpCfg.mode === "test" ? (mp.sandbox_init_point || mp.init_point || null) : (mp.init_point || null);

      const mpPayload = {
        mp_mode: mpCfg.mode,
        mp_preference: { id: mp.id, init_point: mp.init_point, sandbox_init_point: mp.sandbox_init_point },
        mp_raw: mp.raw || null,
        method_code,
        buyer: { name: buyer_name, email: buyer_email, phone: buyer_phone, doc_number: buyer_doc || null },
        fulfillment_type,
        pickup_branch_id: pickup_branch_id || null,
      };

      const [pres2] = await sequelize.query(
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

      let pay_id = toInt(pres2?.insertId, 0);
      if (!pay_id) pay_id = await getLastInsertId(t);

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
        payment: {
          id: pay_id || null,
          provider: "mercadopago",
          status: "pending",
          external_reference: public_code,
        },
        redirect_url,
        mp: { id: mp.id, init_point: mp.init_point, sandbox_init_point: mp.sandbox_init_point, mode: mpCfg.mode },
      };
    });

    if (result?.error) {
      return res.status(result.error.status || 400).json({
        ok: false,
        code: result.error.code || "CHECKOUT_ERROR",
        message: result.error.message || "Error en checkout.",
        detail: result.error.detail || null,
        request_id,
      });
    }

    return res.json({ ok: true, request_id, ...result });
  } catch (e) {
    const detail =
      e?.original?.sqlMessage ||
      e?.original?.message ||
      e?.sqlMessage ||
      e?.message ||
      (typeof e === "object" ? JSON.stringify(e) : String(e));

    console.error("❌ checkout error:", { request_id, detail });

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