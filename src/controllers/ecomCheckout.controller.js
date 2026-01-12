// src/controllers/ecomCheckout.controller.js
// ✅ COPY-PASTE FINAL (Checkout público robusto + errores claros)

const crypto = require("crypto");
const { sequelize } = require("../models");

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
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
  // ✅ Si no existe la VIEW, tiramos error claro
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
  if (m === "MERCADOPAGO" || m === "MP") return "mercadopago";
  if (m === "TRANSFER" || m === "TRANSFERENCIA") return "transfer";
  if (m === "CASH" || m === "EFECTIVO") return "cash";
  return "other";
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
      (public_code, branch_id, customer_id, status, currency,
       subtotal, discount_total, shipping_total, total,
       fulfillment_type,
       ship_name, ship_phone, ship_address1, ship_address2, ship_city, ship_province, ship_zip,
       notes,
       created_at)
    VALUES
      (:public_code, :branch_id, :customer_id, 'created', 'ARS',
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

async function createPayment({ order_id, provider, amount, t }) {
  const qres = await sequelize.query(
    `
    INSERT INTO ecom_payments (order_id, provider, status, amount, created_at)
    VALUES (:order_id, :provider, 'created', :amount, CURRENT_TIMESTAMP)
    `,
    { replacements: { order_id, provider, amount }, transaction: t }
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

// ============================
// POST /api/v1/ecom/checkout
// ============================
async function checkout(req, res) {
  const payload = req.body || {};
  const items = Array.isArray(payload.items) ? payload.items : [];

  if (!items.length) return res.status(400).json({ message: "Carrito vacío." });

  const normItems = items
    .map((x) => ({
      product_id: Number(x.product_id || x.id || 0),
      qty: toNum(x.qty, 0),
    }))
    .filter((x) => x.product_id > 0 && x.qty > 0);

  if (!normItems.length) return res.status(400).json({ message: "Items inválidos." });

  const fulfillment_type = payload.fulfillment_type === "delivery" ? "delivery" : "pickup";
  const pickup_branch_id = Number(payload.pickup_branch_id || 0) || null;

  const pay_method = normalizeProvider(payload?.payment?.method || payload?.pay_method || "mercadopago");

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

      const customer_id = await upsertCustomer(
        {
          email: payload?.contact?.email || payload?.email,
          first_name: payload?.contact?.first_name || payload?.contact?.name || payload?.first_name,
          last_name: payload?.contact?.last_name || payload?.last_name,
          phone: payload?.contact?.phone || payload?.phone,
          doc_number: payload?.contact?.doc_number || payload?.doc_number,
        },
        t
      );

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

      const pay = await createPayment({ order_id, provider: pay_method, amount: total, t });

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
        },
        payment: pay,
      };
    });

    if (result?.error) return res.status(result.error.status || 400).json(result.error);
    return res.json(result);
  } catch (e) {
    const detail = e?.message || String(e);

    // ✅ Errores controlados (ej: falta view stock)
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
