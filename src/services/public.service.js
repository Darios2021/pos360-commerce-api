// src/services/public.service.js
// ✅ COPY-PASTE FINAL (POS taxonomy real con categories.parent_id)
// - Subrubros salen de categories (hijos por parent_id)
// - Chip subrubro filtra por products.category_id = ID_HIJO (NO subcategory_id)
// - "Todos" trae padre + hijos (include_children=1), siempre acotado al rubro

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
  async listCategories() {
    // devuelve TODO (padres + hijos)
    const [rows] = await sequelize.query(`
      SELECT id, name, parent_id
      FROM categories
      WHERE is_active = 1
      ORDER BY parent_id IS NOT NULL, parent_id, name
    `);
    return rows || [];
  },

  async listSubcategories({ category_id }) {
    // hijos por parent_id
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
  // ✅ Catalog
  // =====================
  async listCatalog({
    branch_id,
    search,
    category_id,       // rubro padre
    subcategory_id,    // subrubro = ID hijo (pero filtra por products.category_id)
    include_children,
    in_stock,
    page,
    limit,
  }) {
    const where = ["branch_id = :branch_id"];
    const pg = Math.max(1, Number(page || 1));
    const lim = Math.min(100, Math.max(1, Number(limit || 24)));

    const repl = {
      branch_id,
      limit: lim,
      offset: (pg - 1) * lim,
    };

    const parentId = Number(category_id || 0);
    const childId = Number(subcategory_id || 0);
    const inc = toBoolLike(include_children, false);

    // ✅ 1) CHIP subrubro: products.category_id = ID_HIJO
    if (childId) {
      where.push("category_id = :child_id");
      repl.child_id = childId;

      // (opcional pero recomendado) validar que ese hijo pertenezca al padre actual
      if (parentId) {
        where.push(`
          EXISTS (
            SELECT 1
            FROM categories c
            WHERE c.id = :child_id AND c.parent_id = :parent_id AND c.is_active = 1
          )
        `);
        repl.parent_id = parentId;
      }
    }
    // ✅ 2) "Todos" dentro del rubro: padre + hijos
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

    // stock opcional
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
