// src/controllers/categories.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (Categories + Subcategories reales)
// - GET /api/v1/categories
// - GET /api/v1/categories/:id
// - POST /api/v1/categories
// - PATCH /api/v1/categories/:id
// - ✅ GET /api/v1/categories/:id/subcategories   (subrubros reales desde tabla subcategories)

const { Category, Subcategory } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

exports.list = async (req, res, next) => {
  try {
    const items = await Category.findAll({
      where: { is_active: 1 },
      attributes: ["id", "name", "parent_id", "is_active"],
      order: [
        ["parent_id", "ASC"],
        ["name", "ASC"],
      ],
    });

    return res.json({ ok: true, items });
  } catch (e) {
    next(e);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const item = await Category.findByPk(req.params.id, {
      attributes: ["id", "name", "parent_id", "is_active"],
    });
    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });
    return res.json({ ok: true, item });
  } catch (e) {
    next(e);
  }
};

exports.create = async (req, res, next) => {
  try {
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
      parent_id: body.parent_id ?? null,
      is_active: body.is_active ?? 1,
    });

    return res.status(201).json({ ok: true, item });
  } catch (e) {
    next(e);
  }
};

exports.update = async (req, res, next) => {
  try {
    const item = await Category.findByPk(req.params.id);
    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const body = req.body || {};
    await item.update({
      name: body.name ?? item.name,
      parent_id: body.parent_id ?? item.parent_id,
      is_active: body.is_active ?? item.is_active,
    });

    return res.json({ ok: true, item });
  } catch (e) {
    next(e);
  }
};

// ✅ NUEVO: subrubros reales por rubro (tabla subcategories)
// GET /api/v1/categories/:id/subcategories?is_active=1
exports.listSubcategories = async (req, res, next) => {
  try {
    const categoryId = toInt(req.params.id, 0);
    if (!categoryId) {
      return res.status(400).json({ ok: false, code: "VALIDATION", message: "id inválido" });
    }

    // opcional: filtrar por is_active (default 1)
    const isActiveRaw = req.query.is_active;
    const where = { category_id: categoryId };

    if (isActiveRaw === undefined) {
      where.is_active = 1;
    } else {
      const v = String(isActiveRaw).toLowerCase();
      where.is_active = v === "1" || v === "true" ? 1 : 0;
    }

    const items = await Subcategory.findAll({
      where,
      attributes: ["id", "category_id", "name", "is_active"],
      order: [["name", "ASC"]],
    });

    return res.json({ ok: true, items });
  } catch (e) {
    next(e);
  }
};
