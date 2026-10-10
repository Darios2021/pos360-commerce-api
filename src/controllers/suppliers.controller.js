// src/controllers/suppliers.controller.js
// Proveedores de mercadería. Tabla `suppliers` (la crea el runner de
// migraciones). SQL directo: no hace falta un modelo para listar y dar de alta.

const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");

function limpiar(v, max) {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

// GET /products/suppliers?q=&inactivos=1&limit=
// Proveedores con la cantidad de productos activos de cada uno.
async function list(req, res, next) {
  try {
    const q = String(req.query.q || "").trim();
    const inactivos = String(req.query.inactivos || "") === "1";
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const rows = await sequelize.query(
      `SELECT s.id, s.name, s.tax_id, s.phone, s.email, s.is_active,
              (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id AND p.is_active = 1) AS products_count,
              (SELECT MAX(p.purchase_date) FROM products p WHERE p.supplier_id = s.id) AS last_purchase
         FROM suppliers s
        WHERE ${inactivos ? "1=1" : "s.is_active = 1"}
          ${q ? "AND (s.name LIKE :q OR s.tax_id LIKE :q OR s.email LIKE :q OR s.phone LIKE :q)" : ""}
        ORDER BY s.name ASC
        LIMIT ${limit}`,
      { type: QueryTypes.SELECT, replacements: { q: `%${q}%` } }
    );
    return res.json({
      ok: true,
      data: rows.map((r) => ({ ...r, is_active: Number(r.is_active) === 1, products_count: Number(r.products_count || 0) })),
    });
  } catch (e) {
    next(e);
  }
}

// GET /products/suppliers/:id → el proveedor y sus productos activos (hasta 200)
async function getOne(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10) || 0;
    const [sup] = await sequelize.query(
      "SELECT id, name, tax_id, phone, email, is_active, created_at FROM suppliers WHERE id = :id LIMIT 1",
      { type: QueryTypes.SELECT, replacements: { id } }
    );
    if (!sup) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Proveedor no encontrado." });
    const productos = await sequelize.query(
      `SELECT p.id, p.name, p.sku, p.supplier_code, p.cost, p.cost_currency, p.price_list, p.purchase_date
         FROM products p
        WHERE p.supplier_id = :id AND p.is_active = 1
        ORDER BY p.name ASC
        LIMIT 200`,
      { type: QueryTypes.SELECT, replacements: { id } }
    );
    return res.json({ ok: true, data: { ...sup, is_active: Number(sup.is_active) === 1, products: productos } });
  } catch (e) {
    next(e);
  }
}

// PUT /products/suppliers/:id  { name, tax_id, phone, email, is_active }
async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10) || 0;
    const name = limpiar(req.body?.name, 160);
    if (!name) return res.status(400).json({ ok: false, code: "NAME_REQUIRED", message: "Falta el nombre del proveedor." });
    const [otro] = await sequelize.query(
      "SELECT id FROM suppliers WHERE is_active = 1 AND LOWER(name) = LOWER(:name) AND id <> :id LIMIT 1",
      { type: QueryTypes.SELECT, replacements: { name, id } }
    );
    if (otro) return res.status(409).json({ ok: false, code: "DUPLICATE", message: "Ya hay otro proveedor con ese nombre." });
    const activo = req.body?.is_active === undefined ? null : (req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === "1" ? 1 : 0);
    const [, meta] = await sequelize.query(
      `UPDATE suppliers
          SET name = :name, tax_id = :tax_id, phone = :phone, email = :email
              ${activo === null ? "" : ", is_active = :activo"}
        WHERE id = :id`,
      {
        replacements: {
          id, name, activo,
          tax_id: limpiar(req.body?.tax_id, 20),
          phone: limpiar(req.body?.phone, 40),
          email: limpiar(req.body?.email, 160),
        },
      }
    );
    if (!Number(meta?.affectedRows ?? 1)) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Proveedor no encontrado." });
    return res.json({ ok: true, data: { id, name } });
  } catch (e) {
    next(e);
  }
}

// POST /products/suppliers  { name, tax_id?, phone?, email? }
// Si ya existe uno activo con el mismo nombre, devuelve ese (no duplica).
async function create(req, res, next) {
  try {
    const name = limpiar(req.body?.name, 160);
    if (!name) return res.status(400).json({ ok: false, code: "NAME_REQUIRED", message: "Falta el nombre del proveedor." });

    const [existente] = await sequelize.query(
      "SELECT id, name, tax_id, phone, email FROM suppliers WHERE is_active = 1 AND LOWER(name) = LOWER(:name) LIMIT 1",
      { type: QueryTypes.SELECT, replacements: { name } }
    );
    if (existente) return res.json({ ok: true, data: existente, existed: true });

    const [id] = await sequelize.query(
      "INSERT INTO suppliers (name, tax_id, phone, email, created_by) VALUES (:name, :tax_id, :phone, :email, :created_by)",
      {
        type: QueryTypes.INSERT,
        replacements: {
          name,
          tax_id: limpiar(req.body?.tax_id, 20),
          phone: limpiar(req.body?.phone, 40),
          email: limpiar(req.body?.email, 160),
          created_by: Number(req.user?.id || req.auth?.user_id || 0) || null,
        },
      }
    );
    return res.status(201).json({ ok: true, data: { id, name } });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, getOne, create, update };
