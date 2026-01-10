// src/controllers/posSalesOptions.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Implementa:
// - GET /pos/sales/options/sellers
// - GET /pos/sales/options/customers
// - GET /pos/sales/options/products
//
// Devuelve: { ok:true, data:[ { title, value } ] }
//
// NOTA: Es "robusto" por nombres de modelos (Customer/Client, etc).
// Si no existe Customer, cae a extraer clientes desde Sale (customer_name/doc/phone).

const { Op, Sequelize } = require("sequelize");
const models = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function pickModel(...names) {
  for (const n of names) if (models?.[n]) return models[n];
  return null;
}

function normStr(s) {
  return String(s || "").trim();
}

function likeWhere(q, cols) {
  const term = normStr(q);
  if (!term) return null;
  const like = `%${term}%`;
  return {
    [Op.or]: cols.map((c) => ({ [c]: { [Op.like]: like } })),
  };
}

function ok(res, data) {
  return res.json({ ok: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ ok: false, message });
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

    const where = {};
    const qWhere = likeWhere(q, ["name", "full_name", "username", "email"]);
    if (qWhere) Object.assign(where, qWhere);

    // branch_id si existe el campo
    if (branchId && User?.rawAttributes?.branch_id) where.branch_id = branchId;

    const rows = await User.findAll({
      where,
      limit,
      order: [
        User?.rawAttributes?.full_name ? ["full_name", "ASC"] : ["id", "DESC"],
        ["id", "DESC"],
      ],
      attributes: [
        "id",
        ...(User?.rawAttributes?.full_name ? ["full_name"] : []),
        ...(User?.rawAttributes?.name ? ["name"] : []),
        ...(User?.rawAttributes?.username ? ["username"] : []),
        ...(User?.rawAttributes?.email ? ["email"] : []),
      ],
    });

    const data = rows.map((u) => {
      const full = u.full_name || u.name || u.username || u.email || `Usuario #${u.id}`;
      const extra = u.username || u.email || "";
      const title = extra && extra !== full ? `${full} · ${extra}` : full;
      return { title, value: u.id };
    });

    return ok(res, data);
  } catch (e) {
    return fail(res, 500, e?.message || "Error optionsSellers");
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

    // 1) Si existe modelo Customer/Client
    if (Customer) {
      const where = {};
      const cols = [];
      if (Customer?.rawAttributes?.name) cols.push("name");
      if (Customer?.rawAttributes?.full_name) cols.push("full_name");
      if (Customer?.rawAttributes?.document) cols.push("document");
      if (Customer?.rawAttributes?.doc) cols.push("doc");
      if (Customer?.rawAttributes?.dni) cols.push("dni");
      if (Customer?.rawAttributes?.phone) cols.push("phone");
      if (Customer?.rawAttributes?.email) cols.push("email");

      const qWhere = cols.length ? likeWhere(q, cols) : null;
      if (qWhere) Object.assign(where, qWhere);

      if (branchId && Customer?.rawAttributes?.branch_id) where.branch_id = branchId;

      const rows = await Customer.findAll({
        where,
        limit,
        order: [["id", "DESC"]],
        attributes: Object.keys(Customer.rawAttributes),
      });

      const data = rows.map((c) => {
        const name = c.full_name || c.name || `Cliente #${c.id}`;
        const doc = c.document || c.doc || c.dni || "";
        const phone = c.phone || "";
        const parts = [name, doc ? `Doc: ${doc}` : "", phone ? `Tel: ${phone}` : ""].filter(Boolean);
        return { title: parts.join(" · "), value: c.id };
      });

      return ok(res, data);
    }

    // 2) Fallback desde Sale (si no hay Customer)
    if (!Sale) return fail(res, 501, "No existe modelo Customer/Client y tampoco Sale para optionsCustomers");

    // columnas típicas en Sale
    const has = (col) => !!Sale?.rawAttributes?.[col];
    const colName = has("customer_name") ? "customer_name" : null;
    const colDoc = has("customer_doc") ? "customer_doc" : null;
    const colPhone = has("customer_phone") ? "customer_phone" : null;
    const colCustomerId = has("customer_id") ? "customer_id" : null;
    const colBranch = has("branch_id") ? "branch_id" : null;

    if (!colName && !colDoc && !colPhone) {
      return fail(res, 501, "Sale no tiene columnas customer_name/doc/phone para optionsCustomers (fallback)");
    }

    const where = {};
    if (branchId && colBranch) where.branch_id = branchId;

    const term = normStr(q);
    if (term) {
      const like = `%${term}%`;
      const ors = [];
      if (colName) ors.push({ [colName]: { [Op.like]: like } });
      if (colDoc) ors.push({ [colDoc]: { [Op.like]: like } });
      if (colPhone) ors.push({ [colPhone]: { [Op.like]: like } });
      where[Op.or] = ors;
    }

    // DISTINCT "light": traemos filas y armamos set en JS (rápido y simple)
    const rows = await Sale.findAll({
      where,
      limit: Math.max(limit * 3, limit), // traemos un poco más para deduplicar
      order: [["id", "DESC"]],
      attributes: [
        ...(colCustomerId ? [colCustomerId] : []),
        ...(colName ? [colName] : []),
        ...(colDoc ? [colDoc] : []),
        ...(colPhone ? [colPhone] : []),
      ],
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

      const title = [name || "Consumidor Final", doc ? `Doc: ${doc}` : "", phone ? `Tel: ${phone}` : ""].filter(Boolean).join(" · ");
      data.push({ title, value: id ?? title });

      if (data.length >= limit) break;
    }

    return ok(res, data);
  } catch (e) {
    return fail(res, 500, e?.message || "Error optionsCustomers");
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
    if (!Product) return fail(res, 501, "Modelo Product no disponible para optionsProducts");

    const where = {};
    const cols = [];
    if (Product?.rawAttributes?.name) cols.push("name");
    if (Product?.rawAttributes?.title) cols.push("title");
    if (Product?.rawAttributes?.sku) cols.push("sku");
    if (Product?.rawAttributes?.barcode) cols.push("barcode");
    if (Product?.rawAttributes?.code) cols.push("code");

    const qWhere = cols.length ? likeWhere(q, cols) : null;
    if (qWhere) Object.assign(where, qWhere);

    // si el producto está asociado a branch_id directamente
    if (branchId && Product?.rawAttributes?.branch_id) where.branch_id = branchId;

    const rows = await Product.findAll({
      where,
      limit,
      order: [["id", "DESC"]],
      attributes: Object.keys(Product.rawAttributes),
    });

    const data = rows.map((p) => {
      const name = p.name || p.title || `Producto #${p.id}`;
      const sku = p.sku || p.code || "";
      const bc = p.barcode || "";
      const parts = [name, sku ? `SKU: ${sku}` : "", bc ? `BAR: ${bc}` : ""].filter(Boolean);
      return { title: parts.join(" · "), value: p.id };
    });

    return ok(res, data);
  } catch (e) {
    return fail(res, 500, e?.message || "Error optionsProducts");
  }
}

module.exports = {
  optionsSellers,
  optionsCustomers,
  optionsProducts,
};
