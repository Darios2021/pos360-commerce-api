// src/controllers/categories.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (Categories + Subcategories reales)
// - GET /api/v1/categories
// - GET /api/v1/categories/:id
// - POST /api/v1/categories
// - PATCH /api/v1/categories/:id
// - ✅ GET /api/v1/categories/:id/subcategories   (subrubros reales desde tabla subcategories)

const { Category, Subcategory } = require("../models");

// =====================
// Helpers
// =====================
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toBoolInt(v, d = 1) {
  if (v === undefined || v === null) return d;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = String(v).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "y") return 1;
  if (s === "0" || s === "false" || s === "no" || s === "n") return 0;
  return d;
}

/**
 * Normaliza parent_id para evitar 500 por:
 * - "" (string vacío) -> null
 * - "0" / 0 -> null
 * - undefined/null -> null
 * - "12" -> 12
 * - cualquier basura -> null
 */
function normalizeParentId(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (typeof v === "number") {
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  return null;
}

// =====================
// Controllers
// =====================
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

    const parent_id = normalizeParentId(body.parent_id);
    const is_active = toBoolInt(body.is_active, 1);

    // ✅ opcional recomendado: si viene parent_id, validar que exista
    if (parent_id) {
      const parent = await Category.findByPk(parent_id, { attributes: ["id"] });
      if (!parent) {
        return res.status(400).json({
          ok: false,
          code: "VALIDATION",
          message: "parent_id inválido: no existe la categoría padre",
        });
      }
    }

    const item = await Category.create({
      name,
      parent_id,   // ✅ ya normalizado (null o int)
      is_active,
    });

    return res.status(201).json({ ok: true, item });
  } catch (e) {
    // ✅ devolver error útil (evita "Validation error" sin contexto)
    const msg = e?.message || "Error interno";
    const raw = e?.errors?.[0]?.message;
    return res.status(400).json({
      ok: false,
      code: "VALIDATION",
      message: raw || msg,
    });
  }
};

exports.update = async (req, res, next) => {
  try {
    const item = await Category.findByPk(req.params.id);
    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const body = req.body || {};

    const name =
      body.name !== undefined && body.name !== null
        ? String(body.name).trim()
        : item.name;

    if (!name) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "name es obligatorio",
      });
    }

    const parent_id =
      body.parent_id !== undefined ? normalizeParentId(body.parent_id) : item.parent_id;

    const is_active =
      body.is_active !== undefined ? toBoolInt(body.is_active, item.is_active) : item.is_active;

    // ✅ evitar que una categoría sea su propio padre
    if (parent_id && parent_id === item.id) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "parent_id inválido: no puede ser su propio padre",
      });
    }

    // ✅ validar parent si aplica
    if (parent_id) {
      const parent = await Category.findByPk(parent_id, { attributes: ["id"] });
      if (!parent) {
        return res.status(400).json({
          ok: false,
          code: "VALIDATION",
          message: "parent_id inválido: no existe la categoría padre",
        });
      }
    }

    await item.update({ name, parent_id, is_active });

    return res.json({ ok: true, item });
  } catch (e) {
    const msg = e?.message || "Error interno";
    const raw = e?.errors?.[0]?.message;
    return res.status(400).json({
      ok: false,
      code: "VALIDATION",
      message: raw || msg,
    });
  }
};

// ✅ NUEVO: subrubros reales por rubro (tabla subcategories)
// GET /api/v1/categories/:id/subcategories?is_active=1
exports.listSubcategories = async (req, res, next) => {
  try {
    const categoryId = toInt(req.params.id, 0);
    if (!categoryId) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "id inválido",
      });
    }

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
