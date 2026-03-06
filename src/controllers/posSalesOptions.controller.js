// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/posSalesOptions.controller.js
//
// Endpoints:
// - GET /pos/sales/options/sellers
// - GET /pos/sales/options/customers
// - GET /pos/sales/options/products
//
// Respuesta:
// { ok:true, data:[ { title, value, stock? } ] }
//
// FIX AHORA:
// ✅ /products devuelve PRODUCTOS VENDIDOS DE VERDAD (sale_items)
// ✅ respeta branch_id
// ✅ busca por snapshots + producto actual
// ✅ evita mostrar catálogo entero que nunca apareció en ventas

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
function getTableName(model, fallback) {
  try {
    const t = model?.getTableName?.();
    if (!t) return fallback;
    if (typeof t === "string") return t;
    if (typeof t?.tableName === "string") return t.tableName;
    return fallback;
  } catch {
    return fallback;
  }
}

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

async function optionsCustomers(req, res) {
  try {
    const q = req.query.q || "";
    const limit = Math.min(Math.max(toInt(req.query.limit, 25), 1), 100);
    const branchId = toInt(req.query.branch_id, 0) || null;

    const Customer = pickModel("Customer", "Customers", "Client", "Clients", "Cliente", "Clientes");
    const Sale = pickModel("Sale", "Sales", "PosSale", "PosSales");

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
 * PRODUCTS:
 * ✅ Devuelve productos vendidos de verdad.
 * Busca desde sale_items (+ sales para sucursal) y enriquece con products.
 */
/**
 * PRODUCTS (vendidos): busca productos que aparecen en ventas
 * query: q, limit, branch_id (opcional)
 */
async function optionsProducts(req, res) {
  try {
    const q = req.query.q || "";
    const limit = Math.min(Math.max(toInt(req.query.limit, 25), 1), 100);
    const branchId = toInt(req.query.branch_id, 0) || null;

    const sequelize = models?.sequelize;
    if (!sequelize) return fail(res, 500, "Sequelize no disponible");

    const term = normStr(q);
    const like = `%${term}%`;

    const sql = `
      SELECT DISTINCT
        si.product_id AS id,
        COALESCE(si.product_name_snapshot, p.name, p.title) AS name,
        COALESCE(si.product_sku_snapshot, p.sku, p.code) AS sku,
        COALESCE(si.product_barcode_snapshot, p.barcode) AS barcode
      FROM sale_items si
      LEFT JOIN products p ON p.id = si.product_id
      LEFT JOIN sales s ON s.id = si.sale_id
      WHERE
        (:branch_id = 0 OR s.branch_id = :branch_id)
        AND (
          :term = '' OR
          si.product_name_snapshot LIKE :like OR
          si.product_sku_snapshot LIKE :like OR
          si.product_barcode_snapshot LIKE :like OR
          p.name LIKE :like OR
          p.sku LIKE :like
        )
      ORDER BY name ASC
      LIMIT :limit
    `;

    const [rows] = await sequelize.query(sql, {
      replacements: {
        branch_id: branchId,
        term,
        like,
        limit,
      },
    });

    const data = (rows || []).map((p) => {
      const parts = [
        p.name || `Producto #${p.id}`,
        p.sku ? `SKU: ${p.sku}` : "",
        p.barcode ? `BAR: ${p.barcode}` : "",
      ].filter(Boolean);

      return {
        title: parts.join(" · "),
        value: Number(p.id),
      };
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