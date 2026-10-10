// src/controllers/suppliers.controller.js
// Proveedores de mercadería. Tabla `suppliers` (la crea el runner de
// migraciones). SQL directo: no hace falta un modelo para listar y dar de alta.

const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");

function limpiar(v, max) {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

// GET /products/suppliers?q=  → proveedores activos (los primeros 50 que coinciden)
async function list(req, res, next) {
  try {
    const q = String(req.query.q || "").trim();
    const rows = await sequelize.query(
      `SELECT id, name, tax_id, phone, email
         FROM suppliers
        WHERE is_active = 1 ${q ? "AND (name LIKE :q OR tax_id LIKE :q)" : ""}
        ORDER BY name ASC
        LIMIT 50`,
      { type: QueryTypes.SELECT, replacements: { q: `%${q}%` } }
    );
    return res.json({ ok: true, data: rows });
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

module.exports = { list, create };
