// src/controllers/categories.controller.js
const { Category } = require("../models");

/**
 * LISTAR CATEGORÍAS
 *
 * Casos de uso:
 *  - GET /api/v1/categories
 *      → devuelve TODAS (compatibilidad hacia atrás)
 *
 *  - GET /api/v1/categories?parent_id=
 *  - GET /api/v1/categories?parent_id=null
 *      → devuelve RUBROS (parent_id IS NULL)
 *
 *  - GET /api/v1/categories?parent_id=5
 *      → devuelve SUB-RUBROS del rubro 5
 */
exports.list = async (req, res) => {
  const { parent_id } = req.query;

  const where = {};

  if (parent_id !== undefined) {
    // rubros
    if (parent_id === "" || parent_id === "null") {
      where.parent_id = null;
    } else {
      // subrubros
      where.parent_id = Number(parent_id);
    }
  }

  const items = await Category.findAll({
    where,
    order: [["name", "ASC"]],
  });

  res.json({ ok: true, items });
};

exports.getOne = async (req, res) => {
  const item = await Category.findByPk(req.params.id);
  if (!item) {
    return res.status(404).json({ ok: false, code: "NOT_FOUND" });
  }
  res.json({ ok: true, item });
};

exports.create = async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || "").trim();

  if (!name) {
    return res.status(400).json({
      ok: false,
      code: "VALIDATION",
      message: "name es obligatorio",
    });
  }

  const item = await Category.create({
    name,
    description: body.description || null,
    parent_id: body.parent_id ?? null, // 👈 clave para rubro / subrubro
    is_active: body.is_active ?? 1,
  });

  res.status(201).json({ ok: true, item });
};

exports.update = async (req, res) => {
  const item = await Category.findByPk(req.params.id);
  if (!item) {
    return res.status(404).json({ ok: false, code: "NOT_FOUND" });
  }

  const body = req.body || {};

  await item.update({
    name: body.name ?? item.name,
    description: body.description ?? item.description,
    parent_id: body.parent_id ?? item.parent_id,
    is_active: body.is_active ?? item.is_active,
  });

  res.json({ ok: true, item });
};
