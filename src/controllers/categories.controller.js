// src/controllers/categories.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
// Categories + Subcategories REALES (tabla subcategories)
// + ✅ Reactivación automática si existe inactiva (Opción A)
// - GET    /api/v1/categories
// - GET    /api/v1/categories/:id
// - POST   /api/v1/categories
// - PATCH  /api/v1/categories/:id
// - GET    /api/v1/categories/:id/subcategories
// - POST   /api/v1/categories/:id/subcategories
// - PATCH  /api/v1/categories/:id/subcategories/:subId
// - DELETE /api/v1/categories/:id/subcategories/:subId  (soft delete)

const { Category, Subcategory } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toBoolInt(v, d = 1) {
  if (v === undefined || v === null) return d;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "si"].includes(s)) return 1;
  if (["0", "false", "no", "n"].includes(s)) return 0;
  return d;
}

// ✅ "" / "0" / 0 / undefined => null
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

function handleSequelizeError(res, e) {
  if (e?.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({
      ok: false,
      code: "DUPLICATE",
      message: "Duplicado (constraint UNIQUE).",
      details: e?.errors?.map((x) => x?.message).filter(Boolean),
    });
  }

  if (e?.name === "SequelizeValidationError") {
    return res.status(400).json({
      ok: false,
      code: "VALIDATION",
      message: "Validation error",
      details: e?.errors?.map((x) => x?.message).filter(Boolean),
    });
  }

  return res.status(500).json({
    ok: false,
    code: "INTERNAL",
    message: e?.message || "Error interno",
  });
}

// =====================
// Categories
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

exports.create = async (req, res) => {
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

    // ✅ si viene parent_id, validar que exista
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

    // ✅ OPCIÓN A: si existe (aunque esté inactiva)
    const existing = await Category.findOne({
      where: { name },
      attributes: ["id", "name", "parent_id", "is_active"],
    });

    if (existing) {
      // ♻️ si está inactiva, reactivar y ajustar parent/is_active
      if (Number(existing.is_active ?? 0) === 0) {
        await existing.update({
          parent_id,
          is_active,
        });

        return res.status(200).json({
          ok: true,
          item: existing,
          reactivated: true,
        });
      }

      // si está activa => duplicado
      return res.status(409).json({
        ok: false,
        code: "DUPLICATE",
        message: "Ya existe una categoría con ese nombre.",
      });
    }

    const item = await Category.create({ name, parent_id, is_active });
    return res.status(201).json({ ok: true, item });
  } catch (e) {
    return handleSequelizeError(res, e);
  }
};

exports.update = async (req, res) => {
  try {
    const item = await Category.findByPk(req.params.id);
    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const body = req.body || {};

    const name =
      body.name !== undefined && body.name !== null ? String(body.name).trim() : item.name;

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

    if (parent_id && parent_id === item.id) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "parent_id inválido: no puede ser su propio padre",
      });
    }

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
    return handleSequelizeError(res, e);
  }
};

// =====================
// Subcategories REALES (tabla subcategories) colgadas de /categories/:id
// =====================

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

    const cat = await Category.findByPk(categoryId, { attributes: ["id"] });
    if (!cat) {
      return res.status(404).json({
        ok: false,
        code: "NOT_FOUND",
        message: "Categoría no existe",
      });
    }

    const isActiveRaw = req.query.is_active;
    const where = { category_id: categoryId };

    if (isActiveRaw === undefined) {
      where.is_active = 1;
    } else {
      where.is_active = toBoolInt(isActiveRaw, 1);
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

// POST /api/v1/categories/:id/subcategories
exports.createSubcategory = async (req, res) => {
  try {
    const categoryId = toInt(req.params.id, 0);
    if (!categoryId) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "id inválido",
      });
    }

    const cat = await Category.findByPk(categoryId, { attributes: ["id"] });
    if (!cat) {
      return res.status(404).json({
        ok: false,
        code: "NOT_FOUND",
        message: "Categoría no existe",
      });
    }

    const body = req.body || {};
    const name = String(body.name || "").trim();
    const is_active = toBoolInt(body.is_active, 1);

    if (!name) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "name es obligatorio",
      });
    }

    // ✅ OPCIÓN A: si existe (activo o inactivo) por (category_id, name)
    const existing = await Subcategory.findOne({
      where: { category_id: categoryId, name },
      attributes: ["id", "category_id", "name", "is_active"],
    });

    if (existing) {
      if (Number(existing.is_active ?? 0) === 0) {
        await existing.update({ is_active });

        return res.status(200).json({
          ok: true,
          item: existing,
          reactivated: true,
        });
      }

      return res.status(409).json({
        ok: false,
        code: "DUPLICATE",
        message: "Ya existe una subcategoría con ese nombre en este rubro.",
      });
    }

    const item = await Subcategory.create({
      name,
      category_id: categoryId,
      is_active,
    });

    return res.status(201).json({ ok: true, item });
  } catch (e) {
    return handleSequelizeError(res, e);
  }
};

// PATCH /api/v1/categories/:id/subcategories/:subId
exports.updateSubcategory = async (req, res) => {
  try {
    const categoryId = toInt(req.params.id, 0);
    const subId = toInt(req.params.subId, 0);

    if (!categoryId || !subId) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "id/subId inválidos",
      });
    }

    const item = await Subcategory.findByPk(subId);
    if (!item) {
      return res.status(404).json({
        ok: false,
        code: "NOT_FOUND",
        message: "Subcategoría no existe",
      });
    }

    if (toInt(item.category_id, 0) !== categoryId) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "La subcategoría no pertenece a esta categoría",
      });
    }

    const body = req.body || {};
    const name =
      body.name !== undefined && body.name !== null ? String(body.name).trim() : item.name;

    if (!name) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "name es obligatorio",
      });
    }

    const is_active =
      body.is_active !== undefined ? toBoolInt(body.is_active, item.is_active) : item.is_active;

    await item.update({ name, is_active });

    return res.json({ ok: true, item });
  } catch (e) {
    return handleSequelizeError(res, e);
  }
};

// DELETE /api/v1/categories/:id/subcategories/:subId
// ✅ Soft delete: is_active = 0 (evita duplicados y permite reactivar)
exports.removeSubcategory = async (req, res) => {
  try {
    const categoryId = toInt(req.params.id, 0);
    const subId = toInt(req.params.subId, 0);

    if (!categoryId || !subId) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "id/subId inválidos",
      });
    }

    const item = await Subcategory.findByPk(subId);
    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    if (toInt(item.category_id, 0) !== categoryId) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "La subcategoría no pertenece a esta categoría",
      });
    }

    await item.update({ is_active: 0 });
    return res.json({ ok: true });
  } catch (e) {
    return handleSequelizeError(res, e);
  }
};
