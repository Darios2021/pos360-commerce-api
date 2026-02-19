// src/controllers/public.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (FIX /public/products/:id)
// ✅ FIX: handler Express real (req,res)
// ✅ FIX: sequelize importado
// ✅ FIX: sin funciones inexistentes
// ✅ Usa v_public_catalog + product_images + v_stock_by_branch_product
// ✅ FIX CRÍTICO: stock_qty normalizado (evita "Sin stock" si viene "1.000" string)

const { sequelize } = require("../models");
const PublicService = require("../services/public.service");

// =====================
// Helpers
// =====================
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

// ✅ FIX: parse robusto para números que vienen como "1.000" (miles) o "1,000"
function toQtyNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  const s = String(v).trim();
  if (!s) return 0;

  // "1.000" (miles con punto) => 1000
  if (/\.\d{3}$/.test(s) && !s.includes(",")) {
    const n = Number(s.replace(/\./g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  // "1,000" (miles con coma) => 1000
  if (/,\d{3}$/.test(s) && !s.includes(".")) {
    const n = Number(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  // fallback decimal
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * ✅ resolveBranchId:
 * - si viene ?branch_id= => lo usa
 * - si no viene:
 *    1) usa ENV SHOP_DEFAULT_BRANCH_ID si existe
 *    2) si no existe, usa el primer branch activo (ORDER BY id ASC)
 */
async function resolveBranchId(req) {
  const q = toInt(req.query.branch_id, 0);
  if (q) return q;

  const envDefault = toInt(process.env.SHOP_DEFAULT_BRANCH_ID, 0);
  if (envDefault) return envDefault;

  try {
    const branches = await PublicService.listBranches();
    const first = Array.isArray(branches) ? branches.find((b) => toInt(b.id, 0) > 0) : null;
    return toInt(first?.id, 0) || 0;
  } catch {
    return 0;
  }
}

// =====================
// Internal product fetch (DB direct)
// =====================
async function getProductInternal({ branch_id, product_id }) {
  const bid = toInt(branch_id, 0);
  const pid = toInt(product_id, 0);
  if (!pid) return null;

  let item = null;

  // 1) buscar por branch si hay
  if (bid) {
    const [rows] = await sequelize.query(
      `
      SELECT *
      FROM v_public_catalog
      WHERE is_active = 1
        AND branch_id = :branch_id
        AND product_id = :product_id
      LIMIT 1
      `,
      { replacements: { branch_id: bid, product_id: pid } }
    );
    item = rows?.[0] || null;
  }

  // 2) fallback: cualquier sucursal activa (prioriza 1)
  if (!item) {
    const [rowsAny] = await sequelize.query(
      `
      SELECT vc.*
      FROM v_public_catalog vc
      INNER JOIN branches b
        ON b.id = vc.branch_id
       AND b.is_active = 1
      WHERE vc.is_active = 1
        AND vc.product_id = :product_id
      ORDER BY (vc.branch_id = 1) DESC, vc.branch_id ASC
      LIMIT 1
      `,
      { replacements: { product_id: pid } }
    );
    item = rowsAny?.[0] || null;
  }

  if (!item) return null;

  // ✅ imágenes múltiples
  const [imgs] = await sequelize.query(
    `
    SELECT id, url, sort_order
    FROM product_images
    WHERE product_id = :product_id
    ORDER BY sort_order ASC, id ASC
    `,
    { replacements: { product_id: pid } }
  );

  const images = (imgs || [])
    .map((r) => ({
      id: toInt(r.id, 0),
      url: String(r.url || "").trim(),
      sort_order: toInt(r.sort_order, 0),
    }))
    .filter((x) => x.url);

  item.images = images;
  item.image_urls = images.map((x) => x.url);

  if (!String(item.image_url || "").trim() && item.image_urls.length) {
    item.image_url = item.image_urls[0];
  }

  // ✅ stock_qty de la branch elegida
  if (bid) {
    const [rowsStock] = await sequelize.query(
      `
      SELECT qty
      FROM v_stock_by_branch_product
      WHERE product_id = :product_id
        AND branch_id = :branch_id
      LIMIT 1
      `,
      { replacements: { product_id: pid, branch_id: bid } }
    );

    item.stock_qty = toQtyNumber(rowsStock?.[0]?.qty);
  } else {
    item.stock_qty = toQtyNumber(item.stock_qty);
  }

  // ✅ boolean coherente para front (si el front mira in_stock)
  item.in_stock = item.stock_qty > 0;

  return item;
}

// =====================
// Exports
// =====================
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
      const category_id = toInt(req.query.category_id, 0);
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
        category_id: toInt(req.query.category_id, 0) || null,
        subcategory_id: toInt(req.query.subcategory_id, 0) || null,
        include_children: toBoolLike(req.query.include_children, false),
        in_stock: toBoolLike(req.query.in_stock, false),
        page: Math.max(1, toInt(req.query.page, 1)),
        limit: Math.min(100, Math.max(1, toInt(req.query.limit, 24))),
        strict_search: toBoolLike(req.query.strict_search, false),
        exclude_terms: toStr(req.query.exclude_terms),
        brands: toCsvList(req.query.brands),
        model: toStr(req.query.model),
        sort: toStr(req.query.sort),
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

  // ✅ ENDPOINT REAL PARA SHOP:
  // GET /api/v1/public/products/:id?branch_id=3
  async getProduct(req, res) {
    try {
      const product_id = toInt(req.params.id, 0);
      if (!product_id) {
        return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "id inválido" });
      }

      const branch_id = await resolveBranchId(req);

      // Si el service tiene getProductById y devuelve item con stock_qty, lo usamos.
      // Igual lo normalizamos al final.
      let item =
        typeof PublicService.getProductById === "function"
          ? await PublicService.getProductById({ branch_id, product_id })
          : await getProductInternal({ branch_id, product_id });

      if (!item) {
        return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Producto no encontrado" });
      }

      // ✅ FIX FINAL: normalización SIEMPRE, venga del service o del internal
      item.stock_qty = toQtyNumber(item.stock_qty);
      item.in_stock = item.stock_qty > 0;

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
      const product_id = toInt(req.params.id, 0);
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
