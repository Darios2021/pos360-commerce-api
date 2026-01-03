// src/services/public.service.js
// ✅ COPY-PASTE FINAL (FIX 500 "unterminated string literal")
// - NO usar ESCAPE '\' (rompe en MySQL)
// - Usamos ESCAPE '!' + escLike para % _ !
// - Search amplio: name, description, brand, model, sku, barcode, code, category_name, subcategory_name
// - Suggestions con GROUP BY seguro (ONLY_FULL_GROUP_BY friendly)

const { sequelize } = require("../models");

const ESC = "!";

function escLike(s) {
  // escapamos el mismo char de ESC, y los comodines % _
  return String(s ?? "").replace(/[!%_]/g, (m) => ESC + m);
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

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

module.exports = {
  // =====================
  // ✅ Taxonomía
  // =====================
  async listCategories() {
    const [rows] = await sequelize.query(`
      SELECT id, name, parent_id
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
      SELECT id, name, parent_id
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
      branch_id: toInt(branch_id),
      limit: Math.min(100, Math.max(1, toInt(limit, 24))),
      offset: (Math.max(1, toInt(page, 1)) - 1) * Math.min(100, Math.max(1, toInt(limit, 24))),
    };

    const cid = toInt(category_id, 0);
    const sid = toInt(subcategory_id, 0);
    const inc = toBoolLike(include_children, false);

    // ✅ Filtro categoría/subcategoría (según tu contrato)
    // - Chip (subcategory_id): filtrar por vc.subcategory_id
    // - Todos (category_id): vc.category_id = padre
    if (sid) {
      where.push("vc.subcategory_id = :subcategory_id");
      repl.subcategory_id = sid;

      // opcional: validar relación con parent
      if (cid) {
        where.push(`
          :subcategory_id IN (
            SELECT id FROM categories
            WHERE parent_id = :category_id AND is_active = 1
          )
        `);
        repl.category_id = cid;
      }
    } else if (cid) {
      where.push("vc.category_id = :category_id");
      repl.category_id = cid;

      // si el frontend manda include_children=1, tu vista ya está “normalizada”
      // (si NO lo estuviera, acá habría que expandir hijos, pero vos ya lo resolviste en la view)
      void inc;
    }

    // ✅ Search (AMPLIO y tolerante)
    const q = String(search || "").trim().toLowerCase();
    if (q.length) {
      repl.q = `%${escLike(q)}%`;
      where.push(`
        (
          LOWER(COALESCE(vc.name,'')) LIKE :q ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.description,'')) LIKE :q ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.brand,'')) LIKE :q ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.model,'')) LIKE :q ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.sku,'')) LIKE :q ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.barcode,'')) LIKE :q ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.code,'')) LIKE :q ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.category_name,'')) LIKE :q ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.subcategory_name,'')) LIKE :q ESCAPE '${ESC}'
        )
      `);
    }

    // ✅ stock filter (si tu view tiene track_stock y stock_qty, como en tu screenshot)
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
      page: Math.max(1, toInt(page, 1)),
      limit: lim,
      total,
      pages: total ? Math.ceil(total / lim) : 0,
    };
  },

  // =====================
  // ✅ Suggestions (autocomplete)
  // =====================
  async listSuggestions({ branch_id, q, limit }) {
    const where = ["vc.branch_id = :branch_id", "vc.is_active = 1"];
    const repl = {
      branch_id: toInt(branch_id),
      limit: Math.min(15, Math.max(1, toInt(limit, 8))),
    };

    const qq = String(q || "").trim().toLowerCase();
    if (!qq.length) return [];

    repl.q = `%${escLike(qq)}%`;
    where.push(`
      (
        LOWER(COALESCE(vc.name,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.description,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.brand,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.model,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.sku,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.barcode,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.code,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.category_name,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.subcategory_name,'')) LIKE :q ESCAPE '${ESC}'
      )
    `);

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [rows] = await sequelize.query(
      `
      SELECT
        vc.product_id,
        MAX(vc.name) AS name,
        MAX(vc.brand) AS brand,
        MAX(vc.model) AS model,
        MAX(vc.category_id) AS category_id,
        MAX(vc.category_name) AS category_name,
        MAX(vc.subcategory_id) AS subcategory_id,
        MAX(vc.subcategory_name) AS subcategory_name,
        MIN(vc.image_url) AS image_url
      FROM v_public_catalog vc
      ${whereSql}
      GROUP BY vc.product_id
      ORDER BY
        CASE
          WHEN LOWER(MAX(COALESCE(vc.name,''))) LIKE :q ESCAPE '${ESC}' THEN 0
          WHEN LOWER(MAX(COALESCE(vc.brand,''))) LIKE :q ESCAPE '${ESC}' THEN 1
          WHEN LOWER(MAX(COALESCE(vc.model,''))) LIKE :q ESCAPE '${ESC}' THEN 2
          ELSE 3
        END,
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
      `
      SELECT *
      FROM v_public_catalog
      WHERE branch_id = :branch_id AND product_id = :product_id
      LIMIT 1
      `,
      { replacements: { branch_id: toInt(branch_id), product_id: toInt(product_id) } }
    );
    return rows?.[0] || null;
  },
};
