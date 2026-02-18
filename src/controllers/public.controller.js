// src/controllers/public.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
// ✅ FIX: branch_id opcional (usa default por ENV o primer branch activo)
// - /public/catalog, /public/suggestions, /public/products/:id ya NO fallan si falta branch_id
// - respeta branch_id si viene en query
// - mantiene strict_search + exclude_terms + filtros brands/model/sort
// - branding + payment config + product media sin branch_id

const PublicService = require("../services/public.service");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}
function toBoolLike(v, d = false) {
  if (v === undefined || v === null || v === "") return d;
  if (v === true || v === 1 || v === "1") return true;
  if (v === false || v === 0 || v === "0") return false;
  const s = String(v).toLowerCase().trim();
  if (["true", "yes", "si"].includes(s)) return true;
  if (["false", "no"].includes(s)) return false;
  return d;
}
function toCsvList(v) {
  return String(v ?? "")
    .split(",")
    .map((x) => String(x).trim())
    .filter(Boolean);
}

/**
 * ✅ resolveBranchId:
 * - si viene ?branch_id= => lo usa
 * - si no viene:
 *    1) usa ENV SHOP_DEFAULT_BRANCH_ID si existe
 *    2) si no existe, usa el primer branch activo (ORDER BY id ASC)
 *
 * Config:
 *   SHOP_DEFAULT_BRANCH_ID=1  (Casa Central)
 */
async function resolveBranchId(req) {
  const q = toInt(req.query.branch_id, 0);
  if (q) return q;

  const envDefault = toInt(process.env.SHOP_DEFAULT_BRANCH_ID, 0);
  if (envDefault) return envDefault;

  // fallback DB: primer branch activo
  try {
    const branches = await PublicService.listBranches();
    const first = Array.isArray(branches) ? branches.find((b) => toInt(b.id, 0) > 0) : null;
    return toInt(first?.id, 0) || 0;
  } catch {
    return 0;
  }
}

module.exports = {
  async listCategories(req, res) {
    try {
      const items = await PublicService.listCategories();
      return res.json({ ok: true, items });
    } catch (err) {
      console.error("PUBLIC_CATEGORIES_ERROR", err);
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
      console.error("PUBLIC_SUBCATEGORIES_ERROR", err);
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_SUBCATEGORIES_ERROR",
        message: err?.message || "Error listando subcategorías",
      });
    }
  },

  async listBranches(req, res) {
    try {
      const items = await PublicService.listBranches();
      return res.json({ ok: true, items });
    } catch (err) {
      console.error("PUBLIC_BRANCHES_ERROR", err);
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_BRANCHES_ERROR",
        message: err?.message || "Error listando sucursales",
      });
    }
  },

  async listCatalog(req, res) {
    try {
      const branch_id = await resolveBranchId(req);
      if (!branch_id) {
        return res.status(400).json({
          ok: false,
          code: "VALIDATION_ERROR",
          message: "No se pudo resolver branch_id (configurá SHOP_DEFAULT_BRANCH_ID o activá una sucursal)",
        });
      }

      const result = await PublicService.listCatalog({
        branch_id,
        search: toStr(req.query.search),
        category_id: toInt(req.query.category_id) || null,
        subcategory_id: toInt(req.query.subcategory_id) || null,
        include_children: toBoolLike(req.query.include_children, false),
        in_stock: toBoolLike(req.query.in_stock, false),
        page: Math.max(1, toInt(req.query.page, 1)),
        limit: Math.min(100, Math.max(1, toInt(req.query.limit, 24))),

        // ✅ strict_search + exclude_terms
        strict_search: toBoolLike(req.query.strict_search, false),
        exclude_terms: toStr(req.query.exclude_terms),

        // ✅ filtros reales
        brands: toCsvList(req.query.brands), // "XAEA,ONLY"
        model: toStr(req.query.model),       // "POCKET 15W"
        sort: toStr(req.query.sort),         // price_asc|price_desc|newest|name_asc
      });

      return res.json({ ok: true, branch_id, ...result });
    } catch (err) {
      console.error("PUBLIC_CATALOG_ERROR", err);
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_CATALOG_ERROR",
        message: err?.message || "Error listando catálogo",
      });
    }
  },

  async listSuggestions(req, res) {
    try {
      const branch_id = await resolveBranchId(req);
      if (!branch_id) {
        return res.status(400).json({
          ok: false,
          code: "VALIDATION_ERROR",
          message: "No se pudo resolver branch_id (configurá SHOP_DEFAULT_BRANCH_ID o activá una sucursal)",
        });
      }

      const q = toStr(req.query.q);
      const limit = Math.min(20, Math.max(1, toInt(req.query.limit, 8)));

      const items = await PublicService.listSuggestions({ branch_id, q, limit });
      return res.json({ ok: true, branch_id, items });
    } catch (err) {
      console.error("PUBLIC_SUGGESTIONS_ERROR", err);
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_SUGGESTIONS_ERROR",
        message: err?.message || "Error listando sugerencias",
      });
    }
  },

  async getProductById(req, res) {
    try {
      const branch_id = await resolveBranchId(req);
      const product_id = toInt(req.params.id);

      if (!product_id) {
        return res.status(400).json({
          ok: false,
          code: "VALIDATION_ERROR",
          message: "id es obligatorio",
        });
      }
      if (!branch_id) {
        return res.status(400).json({
          ok: false,
          code: "VALIDATION_ERROR",
          message: "No se pudo resolver branch_id (configurá SHOP_DEFAULT_BRANCH_ID o activá una sucursal)",
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

      return res.json({ ok: true, branch_id, item });
    } catch (err) {
      console.error("PUBLIC_PRODUCT_ERROR", err);
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_PRODUCT_ERROR",
        message: err?.message || "Error trayendo producto",
      });
    }
  },

  async getProductMedia(req, res) {
    try {
      const product_id = toInt(req.params.id);
      if (!product_id) {
        return res.status(400).json({
          ok: false,
          code: "VALIDATION_ERROR",
          message: "id es obligatorio",
        });
      }

      const item = await PublicService.getProductMedia({ product_id });
      if (!item) {
        return res.status(404).json({
          ok: false,
          code: "NOT_FOUND",
          message: "Producto no encontrado",
        });
      }

      return res.json({ ok: true, item });
    } catch (err) {
      console.error("PUBLIC_PRODUCT_MEDIA_ERROR", err);
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_PRODUCT_MEDIA_ERROR",
        message: err?.message || "Error trayendo media del producto",
      });
    }
  },

  async getShopBranding(req, res) {
    try {
      const item = await PublicService.getShopBranding();
      return res.json({ ok: true, item });
    } catch (err) {
      console.error("PUBLIC_SHOP_BRANDING_ERROR", err);
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_SHOP_BRANDING_ERROR",
        message: err?.message || "Error trayendo branding",
      });
    }
  },

  async getPaymentConfig(req, res) {
    try {
      const item = await PublicService.getPaymentConfig();
      return res.json({ ok: true, item });
    } catch (err) {
      console.error("PUBLIC_PAYMENT_CONFIG_ERROR", err);
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_PAYMENT_CONFIG_ERROR",
        message: err?.message || "Error trayendo config de pago",
      });
    }
  },
};
