// src/services/public.service.js
// ✅ COPY-PASTE FINAL (SEARCH ROBUSTO + SUGGESTIONS + CHIPS OK)
//
// - /public/categories: devuelve TODO (padres + hijos) con parent_id
// - Rubros: parent_id IS NULL
// - Subrubros: parent_id = :category_id
// - Catálogo: vc.category_id = padre (normalizado en la vista)
// - Chip: filtra por products.category_id (hijo real) vía subcategory_id
// - Search: menos estricto, busca en name/brand/model/sku/barcode/code/description/category/subcategory
// - Suggestions: autocomplete tipo ML (devuelve top N)

const { sequelize } = require("../models");

function escLike(s) {
  // escapamos % _ para LIKE
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

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

module.exports = {
  // =====================
  // ✅ Taxonomía (POS model)
  // =====================

  // ✅ IMPORTANTE: devolver TODO (padres + hijos)
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

  // ✅ SUBRUBROS REALES = categories hijas
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
  // Branches
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
  // ✅ Catalog (ROBUSTO)
  // =====================
  async listCatalog({
    branch_id,
    search,
    category_id,
    subcategory_id,
    include_children, // compat, no hace falta si tu vista ya normaliza padre
    in_stock,
    page,
    limit,
  }) {
    const where = ["vc.branch_id = :branch_id"];
    const repl = {
      branch_id: toInt(branch_id, 0),
      limit: Math.min(100, Math.max(1, toInt(limit, 24))),
      offset: (Math.max(1, toInt(page, 1)) - 1) * Math.min(100, Math.max(1, toInt(limit, 24))),
    };

    const cid = toInt(category_id, 0);      // padre
    const sid = toInt(subcategory_id, 0);   // hijo (real)
    void include_children;

    // ✅ JOIN SOLO cuando hay chip (sid)
    // Porque v_public_catalog está “aplanado” por padre, pero products.category_id guarda el hijo real
    const joinProducts = sid ? `JOIN products p ON p.id = vc.product_id` : "";

    if (sid) {
      // chip: filtra por categoría real del producto
      where.push("p.category_id = :child_id");
      repl.child_id = sid;

      // opcional: asegurar que el hijo pertenece al padre
      if (cid) {
        where.push(`
          :child_id IN (
            SELECT id FROM categories
            WHERE parent_id = :category_id AND is_active = 1
          )
        `);
        repl.category_id = cid;
      }
    } else if (cid) {
      // “Todos” dentro del rubro (padre normalizado en vista)
      where.push("vc.category_id = :category_id");
      repl.category_id = cid;
    }

    // ✅ SEARCH menos estricto + a prueba de NULL
    const q = String(search || "").trim();
    if (q.length) {
      repl.q = `%${escLike(q.toLowerCase())}%`;

      // OJO: LOWER(COALESCE(...,'')) evita NULL y hace match “tipo ML”
      where.push(`
        (
          LOWER(COALESCE(vc.name,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.brand,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.model,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.sku,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.barcode,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.code,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.description,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.category_name,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.subcategory_name,'')) LIKE :q ESCAPE '\\'
        )
      `);
    }

    // stock (si viene in_stock=1)
    if (toBoolLike(in_stock, false)) {
      where.push("(vc.track_stock = 0 OR vc.stock_qty > 0)");
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [[countRow]] = await sequelize.query(
      `SELECT COUNT(*) AS total
       FROM v_public_catalog vc
       ${joinProducts}
       ${whereSql}`,
      { replacements: repl }
    );

    const [items] = await sequelize.query(
      `SELECT vc.*
       FROM v_public_catalog vc
       ${joinProducts}
       ${whereSql}
       ORDER BY vc.product_id DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: repl }
    );

    const total = Number(countRow?.total || 0);

    return {
      items: items || [],
      page: Math.max(1, toInt(page, 1)),
      limit: repl.limit,
      total,
      pages: total ? Math.ceil(total / repl.limit) : 0,
    };
  },

  // =====================
  // 🔮 Suggestions (autocomplete)
  // =====================
  async listSuggestions({ branch_id, q, limit = 8 }) {
    const branch = toInt(branch_id, 0);
    const text = String(q || "").trim().toLowerCase();
    const lim = Math.min(20, Math.max(1, toInt(limit, 8)));

    if (!branch) return [];
    if (text.length < 2) return [];

    const repl = {
      branch_id: branch,
      q: `%${escLike(text)}%`,
      limit: lim,
    };

    // ✅ buscamos en los mismos campos “menos estrictos”
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
        vc.price_list,
        vc.price_discount
      FROM v_public_catalog vc
      WHERE vc.branch_id = :branch_id
        AND (
          LOWER(COALESCE(vc.name,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.brand,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.model,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.description,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.category_name,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.subcategory_name,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.sku,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.barcode,'')) LIKE :q ESCAPE '\\'
          OR LOWER(COALESCE(vc.code,'')) LIKE :q ESCAPE '\\'
        )
      ORDER BY vc.product_id DESC
      LIMIT :limit
      `,
      { replacements: repl }
    );

    return rows || [];
  },

  // =====================
  // Producto
  // =====================
  async getProductById({ branch_id, product_id }) {
    const [rows] = await sequelize.query(
      `SELECT * FROM v_public_catalog
       WHERE branch_id = :branch_id AND product_id = :product_id
       LIMIT 1`,
      { replacements: { branch_id: toInt(branch_id, 0), product_id: toInt(product_id, 0) } }
    );
    return rows?.[0] || null;
  },
};
