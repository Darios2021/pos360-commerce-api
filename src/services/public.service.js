// src/services/public.service.js
// ✅ COPY-PASTE FINAL (taxonomy real por categories.parent_id)
// - /public/categories => devuelve TODAS (padres + hijos) con parent_id
// - /public/subcategories?category_id=PADRE => devuelve hijos (categories.parent_id = PADRE)
// - /public/catalog:
//    - chip subrubro (subcategory_id) => filtra por products.category_id = subcategory_id (hijo)
//    - "Todos" => category_id=PADRE + include_children=true => padre + hijos
// - in_stock opcional

const { sequelize } = require("../models");

function escLike(s) {
  return String(s).replace(/[%_]/g, (m) => "\\" + m);
}

function toBoolLike(v, d = false) {
  if (v === undefined || v === null || v === "") return d;
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const s = String(v).toLowerCase().trim();
  if (["1", "true", "yes", "si"].includes(s)) return true;
  if (["0", "false", "no"].includes(s)) return false;
  return d;
}

module.exports = {
  // =====================
  // ✅ Taxonomía (REAL)
  // =====================

  // ✅ TODAS las categorías (padres + hijos) con parent_id
  async listCategories() {
    const [rows] = await sequelize.query(`
      SELECT id, name, parent_id
      FROM categories
      WHERE is_active = 1
      ORDER BY parent_id IS NOT NULL, parent_id, name
    `);
    return rows || [];
  },

  // ✅ Hijos de un padre
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
  // ✅ Catalog (como POS)
  // =====================
  async listCatalog({
    branch_id,
    search,
    category_id,      // padre
    subcategory_id,   // hijo (chip) => OJO: es ID de categories hijo
    include_children,
    in_stock,
    page,
    limit,
  }) {
    const where = ["branch_id = :branch_id"];
    const lim = Math.min(100, Math.max(1, Number(limit || 24)));
    const pg = Math.max(1, Number(page || 1));

    const repl = {
      branch_id,
      limit: lim,
      offset: (pg - 1) * lim,
    };

    const parentId = Number(category_id || 0);
    const childId = Number(subcategory_id || 0);
    const inc = toBoolLike(include_children, false);

    // ✅ 1) Subrubro (chip): en tu DB ES products.category_id = hijo
    if (childId) {
      where.push("category_id = :child_id");
      repl.child_id = childId;

      // si además viene padre, validamos pertenencia
      if (parentId) {
        where.push(`
          :child_id IN (
            SELECT id FROM categories
            WHERE id = :child_id AND parent_id = :parent_id AND is_active = 1
          )
        `);
        repl.parent_id = parentId;
      }
    }
    // ✅ 2) Rubro: "Todos" dentro del rubro
    else if (parentId) {
      repl.parent_id = parentId;

      if (inc) {
        where.push(`
          (
            category_id = :parent_id
            OR category_id IN (
              SELECT id FROM categories
              WHERE parent_id = :parent_id AND is_active = 1
            )
          )
        `);
      } else {
        where.push("category_id = :parent_id");
      }
    }

    if (search) {
      repl.q = `%${escLike(search)}%`;
      where.push(`
        (name LIKE :q ESCAPE '\\'
        OR brand LIKE :q ESCAPE '\\'
        OR model LIKE :q ESCAPE '\\'
        OR sku LIKE :q ESCAPE '\\'
        OR barcode LIKE :q ESCAPE '\\')
      `);
    }

    if (toBoolLike(in_stock, true)) {
      where.push("(track_stock = 0 OR stock_qty > 0)");
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [[countRow]] = await sequelize.query(
      `SELECT COUNT(*) AS total FROM v_public_catalog ${whereSql}`,
      { replacements: repl }
    );

    const [items] = await sequelize.query(
      `SELECT * FROM v_public_catalog ${whereSql}
       ORDER BY product_id DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: repl }
    );

    const total = Number(countRow?.total || 0);
    return { items: items || [], page: pg, limit: lim, total, pages: total ? Math.ceil(total / lim) : 0 };
  },

  async getProductById({ branch_id, product_id }) {
    const [rows] = await sequelize.query(
      `SELECT * FROM v_public_catalog
       WHERE branch_id = :branch_id AND product_id = :product_id
       LIMIT 1`,
      { replacements: { branch_id, product_id } }
    );
    return rows?.[0] || null;
  },
};
