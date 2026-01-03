// src/services/public.service.js
// ✅ COPY-PASTE FINAL (Catalog + Suggestions) usando v_public_catalog (según tu DESCRIBE)
// - Search “menos estricto”: name, description, brand, model, sku, barcode, code, category_name, subcategory_name
// - Chips: por subcategory_id filtra directo en vc.subcategory_id (tu vista lo tiene)
// - "Todos" (padre): vc.category_id = category_id (tu vista lo tiene normalizado)

const { sequelize } = require("../models");

function escLike(s) {
  return String(s ?? "").replace(/[%_\\]/g, (m) => "\\" + m);
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

module.exports = {
  // =====================
  // ✅ Taxonomía
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
    include_children,
    in_stock,
    page,
    limit,
  }) {
    const where = ["vc.branch_id = :branch_id", "vc.is_active = 1"];
    const repl = {
      branch_id: Number(branch_id),
      limit: Number(limit || 24),
      offset: (Math.max(1, Number(page || 1)) - 1) * Number(limit || 24),
    };

    const cid = category_id ? Number(category_id) : 0;
    const sid = subcategory_id ? Number(subcategory_id) : 0;
    void include_children; // compat

    // ✅ Padre
    if (cid) {
      where.push("vc.category_id = :category_id");
      repl.category_id = cid;
    }

    // ✅ Chip: usa subcategory_id de la vista (tu DESCRIBE lo muestra)
    if (sid) {
      where.push("vc.subcategory_id = :subcategory_id");
      repl.subcategory_id = sid;
    }

    // ✅ Search suave: incluye categoría/subcategoría/descripcion
    const q = String(search || "").trim();
    if (q.length) {
      repl.q = `%${escLike(q.toLowerCase())}%`;
      where.push(`
        (
          LOWER(COALESCE(vc.name,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.description,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.brand,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.model,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.sku,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.barcode,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.code,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.category_name,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.subcategory_name,'')) LIKE :q ESCAPE '\\'
        )
      `);
    }

    // ✅ stock (tu vista tiene track_stock + stock_qty)
    if (toBoolLike(in_stock, false)) {
      where.push("(vc.track_stock = 0 OR vc.stock_qty > 0)");
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [[countRow]] = await sequelize.query(
      `
      SELECT COUNT(*) AS total
      FROM v_public_catalog vc
      ${whereSql}
      `,
      { replacements: repl }
    );

    const [items] = await sequelize.query(
      `
      SELECT vc.*
      FROM v_public_catalog vc
      ${whereSql}
      ORDER BY vc.product_id DESC
      LIMIT :limit OFFSET :offset
      `,
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
  async listSuggestions({ branch_id, q, limit }) {
    const query = String(q || "").trim();
    if (!query) return [];

    const repl = {
      branch_id: Number(branch_id),
      limit: Math.min(20, Math.max(1, Number(limit || 8))),
      q: `%${escLike(query.toLowerCase())}%`,
    };

    // ✅ devolvemos items “listos para click”: product_id + name + brand/model + category/subcategory
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
        vc.image_url
      FROM v_public_catalog vc
      WHERE vc.branch_id = :branch_id
        AND vc.is_active = 1
        AND (
          LOWER(COALESCE(vc.name,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.description,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.brand,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.model,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.sku,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.barcode,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.code,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.category_name,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.subcategory_name,'')) LIKE :q ESCAPE '\\'
        )
      GROUP BY vc.product_id
      ORDER BY
        CASE
          WHEN LOWER(COALESCE(vc.name,'')) LIKE :q ESCAPE '\\' THEN 0
          WHEN LOWER(COALESCE(vc.brand,'')) LIKE :q ESCAPE '\\' THEN 1
          WHEN LOWER(COALESCE(vc.model,'')) LIKE :q ESCAPE '\\' THEN 2
          ELSE 3
        END,
        vc.product_id DESC
      LIMIT :limit
      `,
      { replacements: repl }
    );

    return rows || [];
  },

  async getProductById({ branch_id, product_id }) {
    const [rows] = await sequelize.query(
      `
      SELECT *
      FROM v_public_catalog
      WHERE branch_id = :branch_id
        AND product_id = :product_id
      LIMIT 1
      `,
      { replacements: { branch_id, product_id } }
    );
    return rows?.[0] || null;
  },
};
