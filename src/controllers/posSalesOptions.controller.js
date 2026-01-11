// src/controllers/posSalesOptions.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (FULL)
//
// Endpoints:
// - GET /pos/sales/options/sellers
// - GET /pos/sales/options/customers
// - GET /pos/sales/options/products
//
// Respuesta:
// { ok:true, data:[ { title, value, stock? } ] }
//
// FIXES:
// - ✅ /products: filtra SIEMPRE products.is_active=1 (si existe columna)
// - ✅ /products: intenta usar VIEW v_stock_by_branch_product(branch_id, product_id, qty)
//   y devuelve "stock" (qty) para el frontend
// - ✅ /products: si existe track_stock:
//      track_stock=1 => exige qty>0
//      track_stock=0 => permite qty=0
//   (si NO existe track_stock, exige qty>0 cuando usa view)
// - ✅ fallback automático a Product.findAll si la view no existe o cambia
//
// NOTA:
// - Este controller es "larga duración": tolera nombres/modelos distintos.

const { Op } = require("sequelize");
const models = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function normStr(s) {
  return String(s || "").trim();
}
function ok(res, data) {
  return res.json({ ok: true, data });
}
function fail(res, status, message, e = null) {
  // eslint-disable-next-line no-console
  console.error("❌ [posSalesOptions]", message, e?.message || e || "");
  return res.status(status).json({ ok: false, message });
}
function pickModel(...names) {
  for (const n of names) if (models?.[n]) return models[n];
  return null;
}
function hasAttr(Model, col) {
  return !!Model?.rawAttributes?.[col];
}
function likeWhereDynamic(q, cols) {
  const term = normStr(q);
  if (!term) return null;
  const like = `%${term}%`;
  return { [Op.or]: cols.map((c) => ({ [c]: { [Op.like]: like } })) };
}

/**
 * SELLERS: busca usuarios
 * query: q, limit, branch_id (opcional)
 */
async function optionsSellers(req, res) {
  try {
    const q = req.query.q || "";
    const limit = Math.min(Math.max(toInt(req.query.limit, 25), 1), 100);
    const branchId = toInt(req.query.branch_id, 0) || null;

    const User = pickModel("User", "Users", "Usuario", "Usuarios");
    if (!User) return fail(res, 501, "Modelo User no disponible para optionsSellers");

    const cols = [];
    if (hasAttr(User, "full_name")) cols.push("full_name");
    if (hasAttr(User, "name")) cols.push("name");
    if (hasAttr(User, "username")) cols.push("username");
    if (hasAttr(User, "email")) cols.push("email");
    if (hasAttr(User, "identifier")) cols.push("identifier");

    const where = {};
    if (branchId && hasAttr(User, "branch_id")) where.branch_id = branchId;

    const qWhere = cols.length ? likeWhereDynamic(q, cols) : null;
    if (qWhere) Object.assign(where, qWhere);

    const attrs = ["id"];
    if (hasAttr(User, "full_name")) attrs.push("full_name");
    if (hasAttr(User, "name")) attrs.push("name");
    if (hasAttr(User, "username")) attrs.push("username");
    if (hasAttr(User, "email")) attrs.push("email");
    if (hasAttr(User, "identifier")) attrs.push("identifier");

    const order = [];
    if (hasAttr(User, "full_name")) order.push(["full_name", "ASC"]);
    else if (hasAttr(User, "name")) order.push(["name", "ASC"]);
    else if (hasAttr(User, "username")) order.push(["username", "ASC"]);
    order.push(["id", "DESC"]);

    const rows = await User.findAll({ where, limit, order, attributes: attrs });

    const data = rows.map((u) => {
      const full =
        u.full_name ||
        u.name ||
        u.username ||
        u.identifier ||
        u.email ||
        `Usuario #${u.id}`;

      const extra = u.username || u.identifier || u.email || "";
      const title = extra && extra !== full ? `${full} · ${extra}` : full;

      return { title, value: u.id };
    });

    return ok(res, data);
  } catch (e) {
    return fail(res, 500, e?.message || "Error optionsSellers", e);
  }
}

/**
 * CUSTOMERS: busca clientes
 * query: q, limit, branch_id (opcional)
 *
 * Prioridad:
 * 1) Model Customer/Client si existe
 * 2) Fallback: Sale agrupando por customer_name/doc/phone
 */
async function optionsCustomers(req, res) {
  try {
    const q = req.query.q || "";
    const limit = Math.min(Math.max(toInt(req.query.limit, 25), 1), 100);
    const branchId = toInt(req.query.branch_id, 0) || null;

    const Customer = pickModel("Customer", "Customers", "Client", "Clients", "Cliente", "Clientes");
    const Sale = pickModel("Sale", "Sales", "PosSale", "PosSales");

    // 1) Model Customer/Client
    if (Customer) {
      const where = {};
      const cols = [];
      if (hasAttr(Customer, "name")) cols.push("name");
      if (hasAttr(Customer, "full_name")) cols.push("full_name");
      if (hasAttr(Customer, "document")) cols.push("document");
      if (hasAttr(Customer, "doc")) cols.push("doc");
      if (hasAttr(Customer, "dni")) cols.push("dni");
      if (hasAttr(Customer, "phone")) cols.push("phone");
      if (hasAttr(Customer, "email")) cols.push("email");

      const qWhere = cols.length ? likeWhereDynamic(q, cols) : null;
      if (qWhere) Object.assign(where, qWhere);

      if (branchId && hasAttr(Customer, "branch_id")) where.branch_id = branchId;

      const attrs = ["id"];
      if (hasAttr(Customer, "full_name")) attrs.push("full_name");
      if (hasAttr(Customer, "name")) attrs.push("name");
      if (hasAttr(Customer, "document")) attrs.push("document");
      if (hasAttr(Customer, "doc")) attrs.push("doc");
      if (hasAttr(Customer, "dni")) attrs.push("dni");
      if (hasAttr(Customer, "phone")) attrs.push("phone");
      if (hasAttr(Customer, "email")) attrs.push("email");

      const rows = await Customer.findAll({
        where,
        limit,
        order: [["id", "DESC"]],
        attributes: attrs,
      });

      const data = rows.map((c) => {
        const name = c.full_name || c.name || `Cliente #${c.id}`;
        const doc = c.document || c.doc || c.dni || "";
        const phone = c.phone || "";
        const email = c.email || "";

        const parts = [
          name,
          doc ? `Doc: ${doc}` : "",
          phone ? `Tel: ${phone}` : "",
          email ? email : "",
        ].filter(Boolean);

        return { title: parts.join(" · "), value: c.id };
      });

      return ok(res, data);
    }

    // 2) Fallback: Sale
    if (!Sale) return fail(res, 501, "No existe modelo Customer/Client y tampoco Sale para optionsCustomers");

    const colName = hasAttr(Sale, "customer_name") ? "customer_name" : null;
    const colDoc = hasAttr(Sale, "customer_doc") ? "customer_doc" : null;
    const colPhone = hasAttr(Sale, "customer_phone") ? "customer_phone" : null;
    const colCustomerId = hasAttr(Sale, "customer_id") ? "customer_id" : null;

    if (!colName && !colDoc && !colPhone) {
      return fail(res, 501, "Sale no tiene columnas customer_name/doc/phone para optionsCustomers (fallback)");
    }

    const where = {};
    if (branchId && hasAttr(Sale, "branch_id")) where.branch_id = branchId;

    const term = normStr(q);
    if (term) {
      const like = `%${term}%`;
      const ors = [];
      if (colName) ors.push({ [colName]: { [Op.like]: like } });
      if (colDoc) ors.push({ [colDoc]: { [Op.like]: like } });
      if (colPhone) ors.push({ [colPhone]: { [Op.like]: like } });
      where[Op.or] = ors;
    }

    const attrs = ["id"];
    if (colCustomerId) attrs.push(colCustomerId);
    if (colName) attrs.push(colName);
    if (colDoc) attrs.push(colDoc);
    if (colPhone) attrs.push(colPhone);

    const rows = await Sale.findAll({
      where,
      limit: Math.max(limit * 3, limit),
      order: [["id", "DESC"]],
      attributes: attrs,
    });

    const seen = new Set();
    const data = [];

    for (const r of rows) {
      const name = colName ? normStr(r[colName]) : "";
      const doc = colDoc ? normStr(r[colDoc]) : "";
      const phone = colPhone ? normStr(r[colPhone]) : "";
      const id = colCustomerId ? r[colCustomerId] : null;

      const key = `${id ?? ""}|${name}|${doc}|${phone}`;
      if (!name && !doc && !phone) continue;
      if (seen.has(key)) continue;
      seen.add(key);

      const title = [
        name || "Consumidor Final",
        doc ? `Doc: ${doc}` : "",
        phone ? `Tel: ${phone}` : "",
      ]
        .filter(Boolean)
        .join(" · ");

      data.push({ title, value: id ?? title });
      if (data.length >= limit) break;
    }

    return ok(res, data);
  } catch (e) {
    return fail(res, 500, e?.message || "Error optionsCustomers", e);
  }
}

/**
 * PRODUCTS: busca productos
 * query: q, limit, branch_id (opcional)
 */
async function optionsProducts(req, res) {
  try {
    const q = req.query.q || "";
    const limit = Math.min(Math.max(toInt(req.query.limit, 25), 1), 100);
    const branchId = toInt(req.query.branch_id, 0) || null;

    const Product = pickModel("Product", "Products", "Producto", "Productos");
    const sequelize = models?.sequelize || models?.Sequelize?.sequelize;

    if (!Product) return fail(res, 501, "Modelo Product no disponible para optionsProducts");

    // ✅ Preferimos VIEW si hay branch
    if (sequelize && branchId) {
      try {
        const term = normStr(q);
        const like = `%${term}%`;
        const hasTrack = hasAttr(Product, "track_stock");

        const sql = hasTrack
          ? `
            SELECT
              p.id AS id,
              p.name AS name,
              p.title AS title,
              p.sku AS sku,
              p.code AS code,
              p.barcode AS barcode,
              p.track_stock AS track_stock,
              COALESCE(v.qty,0) AS qty
            FROM v_stock_by_branch_product v
            INNER JOIN products p ON p.id = v.product_id
            WHERE
              v.branch_id = :branch_id
              AND p.is_active = 1
              AND (p.track_stock = 0 OR COALESCE(v.qty,0) > 0)
              AND (
                :term = '' OR
                p.name LIKE :like OR
                p.title LIKE :like OR
                p.sku LIKE :like OR
                p.code LIKE :like OR
                p.barcode LIKE :like
              )
            ORDER BY p.name ASC, p.id DESC
            LIMIT :limit
          `
          : `
            SELECT
              p.id AS id,
              p.name AS name,
              p.title AS title,
              p.sku AS sku,
              p.code AS code,
              p.barcode AS barcode,
              COALESCE(v.qty,0) AS qty
            FROM v_stock_by_branch_product v
            INNER JOIN products p ON p.id = v.product_id
            WHERE
              v.branch_id = :branch_id
              AND p.is_active = 1
              AND COALESCE(v.qty,0) > 0
              AND (
                :term = '' OR
                p.name LIKE :like OR
                p.title LIKE :like OR
                p.sku LIKE :like OR
                p.code LIKE :like OR
                p.barcode LIKE :like
              )
            ORDER BY p.name ASC, p.id DESC
            LIMIT :limit
          `;

        const [rows] = await sequelize.query(sql, {
          replacements: { branch_id: branchId, term, like, limit },
        });

        const data = (rows || []).map((p) => {
          const name = p.name || p.title || `Producto #${p.id}`;
          const sku = p.sku || p.code || "";
          const bc = p.barcode || "";
          const stock = Number(p.qty || 0);

          const parts = [
            name,
            sku ? `SKU: ${sku}` : "",
            bc ? `BAR: ${bc}` : "",
            String(p.track_stock || 0) === "1" ? `Stock: ${stock}` : "Sin control stock",
          ].filter(Boolean);

          return { title: parts.join(" · "), value: Number(p.id), stock };
        });

        return ok(res, data);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("⚠️ optionsProducts: no pude usar v_stock_by_branch_product, hago fallback. Motivo:", e?.message || e);
      }
    }

    // ✅ Fallback a Product directo (sin stock)
    const where = {};

    if (branchId && hasAttr(Product, "branch_id")) where.branch_id = branchId;
    if (hasAttr(Product, "is_active")) where.is_active = 1;

    const cols = [];
    if (hasAttr(Product, "name")) cols.push("name");
    if (hasAttr(Product, "title")) cols.push("title");
    if (hasAttr(Product, "sku")) cols.push("sku");
    if (hasAttr(Product, "barcode")) cols.push("barcode");
    if (hasAttr(Product, "code")) cols.push("code");

    const qWhere = cols.length ? likeWhereDynamic(q, cols) : null;
    if (qWhere) Object.assign(where, qWhere);

    const attrs = ["id"];
    if (hasAttr(Product, "name")) attrs.push("name");
    if (hasAttr(Product, "title")) attrs.push("title");
    if (hasAttr(Product, "sku")) attrs.push("sku");
    if (hasAttr(Product, "code")) attrs.push("code");
    if (hasAttr(Product, "barcode")) attrs.push("barcode");
    if (hasAttr(Product, "track_stock")) attrs.push("track_stock");

    const order = [];
    if (hasAttr(Product, "name")) order.push(["name", "ASC"]);
    order.push(["id", "DESC"]);

    const rows = await Product.findAll({ where, limit, order, attributes: attrs });

    const data = rows.map((p) => {
      const name = p.name || p.title || `Producto #${p.id}`;
      const sku = p.sku || p.code || "";
      const bc = p.barcode || "";
      const trackTxt = hasAttr(Product, "track_stock")
        ? (String(p.track_stock || 0) === "1" ? "Con control stock" : "Sin control stock")
        : "";

      const parts = [name, sku ? `SKU: ${sku}` : "", bc ? `BAR: ${bc}` : "", trackTxt].filter(Boolean);
      return { title: parts.join(" · "), value: p.id };
    });

    return ok(res, data);
  } catch (e) {
    return fail(res, 500, e?.message || "Error optionsProducts", e);
  }
}

module.exports = {
  optionsSellers,
  optionsCustomers,
  optionsProducts,
};
