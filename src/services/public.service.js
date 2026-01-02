// src/services/public.service.js
// ✅ COPY-PASTE FINAL
// - listCategories / listSubcategories
// - listCatalog con include_children (MercadoLibre style)
// - getProductById

const { sequelize } = require("../models");

function escLike(s) {
  return String(s).replace(/[%_]/g, (m) => "\\" + m);
}

module.exports = {
  // =====================
  // ✅ Taxonomía
  // =====================
  async listCategories() {
    // padres (parent_id IS NULL)
    const [rows] = await sequelize.query(`
      SELECT id, name
      FROM categories
      WHERE is_active = 1 AND parent_id IS NULL
      ORDER BY name ASC
    `);
    return rows || [];
  },

  async listSubcategories({ category_id }) {
    // hijos de un padre
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
  // ✅ Catalog (con include_children)
  // =====================
  async listCatalog({ branch_id, search, category_id, subcategory_id, include_children, in_stock, page, limit }) {
    const where = ["branch_id = :branch_id"];
    const repl = { branch_id, limit, offset: (page - 1) * limit };

    // ✅ Si viene subcategory_id -> filtra directo por subcategory_id
    if (subcategory_id) {
      where.push("subcategory_id = :subcategory_id");
      repl.subcategory_id = subcategory_id;
    } else if (category_id) {
      // ✅ Si include_children=true:
      // - trae productos cuyo category_id sea el padre (por si hay)
      // - o category_id sea alguno de sus hijos (categories.parent_id = category_id)
      if (include_children) {
        where.push(`
          (
            category_id = :category_id
            OR category_id IN (
              SELECT id FROM categories
              WHERE parent_id = :category_id AND is_active = 1
            )
          )
        `);
        repl.category_id = category_id;
      } else {
        // comportamiento clásico
        where.push("category_id = :category_id");
        repl.category_id = category_id;
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

    if (in_stock) where.push("(track_stock = 0 OR stock_qty > 0)");

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
    return { items: items || [], page, limit, total, pages: total ? Math.ceil(total / limit) : 0 };
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
