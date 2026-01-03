// src/services/public.service.js
// ✅ COPY-PASTE FINAL (MODELO POS/INVENTARIO)
// - /public/categories: devuelve TODO (padres + hijos) con parent_id
// - Rubros: parent_id IS NULL
// - Subrubros: parent_id = :category_id
// - Catálogo:
//    * "Todos" (rubro): vc.category_id = padre
//    * Chip: vc.subcategory_id = hijo (porque tu vista tiene subcategory_id)
// - Search: robusto (LOWER + CONCAT) -> evita errores por ESCAPE / caracteres raros

const { sequelize } = require("../models");

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
  // ✅ Taxonomía (POS model)
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
  // ✅ Catalog (v_public_catalog)
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
    // ✅ defensivo: si no viene branch_id, NO rompas
    const bid = Number(branch_id || 0);

    const where = [];
    const repl = {
      branch_id: bid,
      limit: Number(limit || 24),
      offset: (Math.max(1, Number(page || 1)) - 1) * Number(limit || 24),
    };

    // Si bid es 0, NO filtramos por sucursal (para que no reviente / no quede vacío)
    // Si vos SIEMPRE querés sucursal obligatoria, dejá solo el WHERE fijo y listo.
    if (bid > 0) where.push("vc.branch_id = :branch_id");

    const cid = Number(category_id || 0);        // padre
    const sid = Number(subcategory_id || 0);     // hijo
    const inc = toBoolLike(include_children, false);
    void inc;

    // ✅ "Todos" del rubro (padre)
    if (cid) {
      where.push("vc.category_id = :category_id");
      repl.category_id = cid;
    }

    // ✅ Chip (hijo) -> tu vista TIENE subcategory_id, usalo directo (sin JOIN)
    if (sid) {
      where.push("vc.subcategory_id = :subcategory_id");
      repl.subcategory_id = sid;
    }

    // ✅ SEARCH robusto (no ESCAPE)
    const q = String(search || "").trim().toLowerCase();
    if (q.length) {
      repl.q = q;

      where.push(`(
        LOWER(vc.name) LIKE CONCAT('%', :q, '%')
        OR LOWER(COALESCE(vc.brand, '')) LIKE CONCAT('%', :q, '%')
        OR LOWER(COALESCE(vc.model, '')) LIKE CONCAT('%', :q, '%')
        OR LOWER(COALESCE(vc.sku, '')) LIKE CONCAT('%', :q, '%')
        OR LOWER(COALESCE(vc.barcode, '')) LIKE CONCAT('%', :q, '%')
        OR LOWER(COALESCE(vc.code, '')) LIKE CONCAT('%', :q, '%')
      )`);
    }

    // ✅ stock (tu vista tiene track_stock y stock_qty)
    if (toBoolLike(in_stock, false)) {
      where.push("(vc.track_stock = 0 OR vc.stock_qty > 0)");
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

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

  async getProductById({ branch_id, product_id }) {
    const [rows] = await sequelize.query(
      `SELECT * FROM v_public_catalog
       WHERE (:branch_id = 0 OR branch_id = :branch_id)
         AND product_id = :product_id
       LIMIT 1`,
      { replacements: { branch_id: Number(branch_id || 0), product_id } }
    );
    return rows?.[0] || null;
  },
};
