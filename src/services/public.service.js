// src/services/public.service.js
// ✅ COPY-PASTE FINAL (MODELO POS/INVENTARIO + SEARCH "ML style")
// - /public/categories: devuelve TODO (padres + hijos) con parent_id
// - Rubros: parent_id IS NULL
// - Subrubros: parent_id = :category_id
// - Catálogo: filtra por vc.category_id (PADRE) y vc.subcategory_id (HIJO) porque v_public_catalog ya trae ambos
// - Search: NO estricto, matchea en name/brand/model/sku/barcode/code/description/category/subcategory
// - Suggestions: endpoint liviano para autocompletar

const { sequelize } = require("../models");

function escLike(s) {
  return String(s).replace(/[%_]/g, (m) => "\\" + m);
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

function clampInt(v, min, max, d) {
  const n = parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return d;
  return Math.max(min, Math.min(max, n));
}

function tokenize(q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return [];
  // hasta 6 tokens para no generar un WHERE enorme
  return s.split(/\s+/).filter(Boolean).slice(0, 6);
}

/**
 * ✅ Búsqueda "menos estricta"
 * - Si hay 1 token: matchea en muchos campos
 * - Si hay varios: hace OR entre tokens (con lo cual "siempre encuentra algo")
 */
function buildSearchWhere(q, repl, alias = "vc") {
  const tokens = tokenize(q);
  if (!tokens.length) return "";

  const fields = [
    `${alias}.name`,
    `${alias}.brand`,
    `${alias}.model`,
    `${alias}.sku`,
    `${alias}.barcode`,
    `${alias}.code`,
    `${alias}.description`,
    `${alias}.category_name`,
    `${alias}.subcategory_name`,
  ];

  const tokenGroups = tokens.map((t, i) => {
    const key = `q${i}`;
    repl[key] = `%${escLike(t)}%`;
    const ors = fields
      .map((f) => `LOWER(COALESCE(${f}, '')) LIKE :${key} ESCAPE '\\\\'`)
      .join(" OR ");
    return `(${ors})`;
  });

  // ✅ OR entre tokens => menos estricto
  return `(${tokenGroups.join(" OR ")})`;
}

module.exports = {
  // =====================
  // ✅ Taxonomía (devuelve TODO)
  // =====================
  async listCategories() {
    const [rows] = await sequelize.query(`
      SELECT id, name, parent_id, is_active
      FROM categories
      WHERE is_active = 1
      ORDER BY
        CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END,
        parent_id ASC,
        name ASC
    `);
    return rows || [];
  },

  async listSubcategories({ category_id }) {
    const [rows] = await sequelize.query(
      `
      SELECT id, name, parent_id, is_active
      FROM categories
      WHERE is_active = 1 AND parent_id = :category_id
      ORDER BY name ASC
      `,
      { replacements: { category_id } }
    );
    return rows || [];
  },

  // =====================
  // ✅ Branches
  // =====================
  async listBranches() {
    const [rows] = await sequelize.query(`
      SELECT id, name, code, address, city
      FROM branches
      WHERE is_active = 1
      ORDER BY name ASC
    `);
    return rows || [];
  },

  // =====================
  // ✅ Catalog
  // =====================
  async listCatalog({
    branch_id,
    search,
    category_id,
    subcategory_id,
    include_children, // compat (en esta vista ya viene normalizado)
    in_stock,
    page,
    limit,
  }) {
    void include_children;

    const where = ["vc.branch_id = :branch_id"];
    const repl = {
      branch_id,
      limit: clampInt(limit, 1, 100, 24),
      offset: (Math.max(1, clampInt(page, 1, 999999, 1)) - 1) * clampInt(limit, 1, 100, 24),
    };

    const cid = Number(category_id || 0);        // padre
    const sid = Number(subcategory_id || 0);     // hijo

    // ✅ Filtro por categoría/subcategoría usando columnas de la VIEW
    if (sid) {
      where.push("vc.subcategory_id = :subcategory_id");
      repl.subcategory_id = sid;

      // si también viene padre, acotamos (seguridad)
      if (cid) {
        where.push("vc.category_id = :category_id");
        repl.category_id = cid;
      }
    } else if (cid) {
      where.push("vc.category_id = :category_id");
      repl.category_id = cid;
    }

    // ✅ Search "ML style"
    const searchSql = buildSearchWhere(search, repl, "vc");
    if (searchSql) where.push(searchSql);

    // ✅ Stock (si lo querés respetar)
    if (toBoolLike(in_stock, true)) {
      where.push("(vc.track_stock = 0 OR vc.stock_qty > 0)");
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [[countRow]] = await sequelize.query(
      `SELECT COUNT(*) AS total
       FROM v_public_catalog vc
       ${whereSql}`,
      { replacements: repl }
    );

    const [items] = await sequelize.query(
      `SELECT vc.*
       FROM v_public_catalog vc
       ${whereSql}
       ORDER BY vc.product_id DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: repl }
    );

    const total = Number(countRow?.total || 0);
    const lim = Number(repl.limit);

    return {
      items: items || [],
      page: Math.max(1, Number(page || 1)),
      limit: lim,
      total,
      pages: total ? Math.ceil(total / lim) : 0,
    };
  },

  // =====================
  // ✅ Suggestions (autocomplete)
  // =====================
  async listSuggestions({ branch_id, q, limit = 8 }) {
    const repl = {
      branch_id,
      limit: clampInt(limit, 1, 15, 8),
    };

    const where = ["vc.branch_id = :branch_id"];
    const searchSql = buildSearchWhere(q, repl, "vc");
    if (searchSql) where.push(searchSql);
    else return []; // sin q => no sugerimos

    const whereSql = `WHERE ${where.join(" AND ")}`;

    // ✅ “score” simple: si matchea al inicio del nombre/brand/model sube
    repl.qprefix = `${String(q || "").trim().toLowerCase()}%`;

    const [rows] = await sequelize.query(
      `
      SELECT
        vc.product_id,
        vc.name,
        vc.brand,
        vc.model,
        vc.category_id,
        vc.category_name,
        vc.subcategory_id,
        vc.subcategory_name,
        vc.image_url,
        vc.price,
        vc.price_discount
      FROM v_public_catalog vc
      ${whereSql}
      GROUP BY vc.product_id
      ORDER BY
        (LOWER(COALESCE(vc.name,''))  LIKE :qprefix) DESC,
        (LOWER(COALESCE(vc.brand,'')) LIKE :qprefix) DESC,
        (LOWER(COALESCE(vc.model,'')) LIKE :qprefix) DESC,
        vc.product_id DESC
      LIMIT :limit
      `,
      { replacements: repl }
    );

    return rows || [];
  },

  // =====================
  // ✅ Product detail
  // =====================
  async getProductById({ branch_id, product_id }) {
    const [rows] = await sequelize.query(
      `SELECT *
       FROM v_public_catalog
       WHERE branch_id = :branch_id AND product_id = :product_id
       LIMIT 1`,
      { replacements: { branch_id, product_id } }
    );
    return rows?.[0] || null;
  },
};
