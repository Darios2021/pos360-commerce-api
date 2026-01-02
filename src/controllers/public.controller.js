// src/controllers/public.controller.js
// ✅ COPY-PASTE FINAL (con include_children + taxonomy endpoints)

const PublicService = require("../services/public.service");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toNum(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}
function toStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}
function toBoolLike(v, d = false) {
  if (v === undefined || v === null || v === "") return d;
  const s = String(v).toLowerCase();
  if (["1", "true", "yes", "si"].includes(s)) return true;
  if (["0", "false", "no"].includes(s)) return false;
  return d;
}

module.exports = {
  // =====================
  // ✅ Taxonomía
  // =====================
  async listCategories(req, res) {
    try {
      const items = await PublicService.listCategories();
      return res.json({ ok: true, items });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_CATEGORIES_ERROR",
        message: err?.message || "Error listando categorías",
      });
    }
  },

  async listSubcategories(req, res) {
    try {
      const category_id = toInt(req.query.category_id);
      if (!category_id) {
        return res.status(400).json({
          ok: false,
          code: "VALIDATION_ERROR",
          message: "category_id es obligatorio",
        });
      }

      const items = await PublicService.listSubcategories({ category_id });
      return res.json({ ok: true, items });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_SUBCATEGORIES_ERROR",
        message: err?.message || "Error listando subcategorías",
      });
    }
  },

  // =====================
  // Branches
  // =====================
  async listBranches(req, res) {
    try {
      const items = await PublicService.listBranches();
      return res.json({ ok: true, items });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_BRANCHES_ERROR",
        message: err?.message || "Error listando sucursales",
      });
    }
  },

  // =====================
  // Catalog
  // =====================
  async listCatalog(req, res) {
    try {
      const branch_id = toInt(req.query.branch_id);
      if (!branch_id) {
        return res.status(400).json({
          ok: false,
          code: "VALIDATION_ERROR",
          message: "branch_id es obligatorio",
        });
      }

      const result = await PublicService.listCatalog({
        branch_id,
        search: toStr(req.query.search),
        category_id: toInt(req.query.category_id) || null,
        subcategory_id: toInt(req.query.subcategory_id) || null,
        include_children: toBoolLike(req.query.include_children, false), // ✅ NUEVO
        in_stock: toBoolLike(req.query.in_stock, true),
        page: Math.max(1, toInt(req.query.page, 1)),
        limit: Math.min(100, Math.max(1, toInt(req.query.limit, 24))),
      });

      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_CATALOG_ERROR",
        message: err?.message || "Error listando catálogo",
      });
    }
  },

  async getProductById(req, res) {
    try {
      const branch_id = toInt(req.query.branch_id);
      const product_id = toInt(req.params.id);

      if (!branch_id || !product_id) {
        return res.status(400).json({
          ok: false,
          code: "VALIDATION_ERROR",
          message: "branch_id e id son obligatorios",
        });
      }

      const item = await PublicService.getProductById({ branch_id, product_id });
      if (!item) {
        return res.status(404).json({
          ok: false,
          code: "NOT_FOUND",
          message: "Producto no encontrado",
        });
      }

      return res.json({ ok: true, item });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_PRODUCT_ERROR",
        message: err?.message || "Error trayendo producto",
      });
    }
  },
};
