// src/services/public.service.js
// ✅ COPY-PASTE FINAL (MODELO POS/INVENTARIO)
// - Rubros: categories parent_id IS NULL
// - Subrubros: categories parent_id = :category_id
// - Catálogo: "Todos" = category_id = padre OR category_id IN (hijos del padre)
// - Chip: filtra por category_id = hijo (y también acota por padre opcionalmente)

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

module.exports = {
  // =====================
  // ✅ Taxonomía (POS model)
  // =====================
  async listCategories() {
    const [rows] = await sequelize.query(`
      SELECT id, name, parent_id
      FROM categories
      WHERE is_active = 1 AND parent_id IS NULL
      ORDER BY name ASC
    `);
    return rows || [];
  },

  // ✅ SUBRUBROS REALES = categories hijas
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
  // ✅ Catalog
  // =====================
  async listCatalog({
    branch_id,
    search,
    category_id,
    subcategory_id, // (compat viejo, lo tratamos como "category_id hijo")
    include_children,
    in_stock,
    page,
    limit,
  }) {
    const where = ["branch_id = :branch_id"];
    const repl = {
      branch_id,
      limit: Number(limit || 24),
      offset: (Math.max(1, Number(page || 1)) - 1) * Number(limit || 24),
    };

    const cid = Number(category_id || 0);
    const sid = Number(subcategory_id || 0);
    const inc = toBoolLike(include_children, false);

    // ✅ Si viene subcategory_id => es el HIJO (category_id del producto)
    if (sid) {
      where.push("category_id = :child_id");
      repl.child_id = sid;

      // Si además viene el padre, acotamos por seguridad (que el hijo pertenezca al padre)
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
      repl.category_id = cid;

      // ✅ "Todos" dentro del rubro
      if (inc) {
        where.push(`
          (
            category_id = :category_id
            OR category_id IN (
              SELECT id FROM categories
              WHERE parent_id = :category_id AND is_active = 1
            )
          )
        `);
      } else {
        where.push("category_id = :category_id");
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
       WHERE branch_id = :branch_id AND product_id = :product_id
       LIMIT 1`,
      { replacements: { branch_id, product_id } }
    );
    return rows?.[0] || null;
  },
};
