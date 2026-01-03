// src/services/public.service.js
// ✅ COPY-PASTE FINAL
// FIX REAL según tu DB:
// - Subrubros salen de tabla `subcategories` (NO de categories.parent_id)
// - "Todos" queda SIEMPRE acotado al rubro (category_id)
// - include_children incluye productos del rubro por:
//   category_id = rubro OR subcategory_id IN (subcategories del rubro)
// - búsqueda + stock ok

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
  // ✅ Taxonomía
  // =====================
  async listCategories() {
    const [rows] = await sequelize.query(`
      SELECT id, name
      FROM categories
      WHERE is_active = 1
      ORDER BY name ASC
    `);
    return rows || [];
  },

  // ✅ SUBRUBROS REALES: tabla subcategories, filtrado por category_id
  async listSubcategories({ category_id }) {
    const [rows] = await sequelize.query(
      `
      SELECT id, name, category_id
      FROM subcategories
      WHERE is_active = 1 AND category_id = :category_id
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
  // ✅ Catalog (con include_children REAL)
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
    const where = ["branch_id = :branch_id"];
    const repl = {
      branch_id,
      limit,
      offset: (Math.max(1, Number(page || 1)) - 1) * Number(limit || 24),
    };

    const cid = Number(category_id || 0);
    const sid = Number(subcategory_id || 0);
    const inc = toBoolLike(include_children, false);

    // ✅ 1) Subrubro puntual
    if (sid) {
      where.push("subcategory_id = :subcategory_id");
      repl.subcategory_id = sid;

      // 🔒 Si además viene el rubro, acota también (por seguridad)
      if (cid) {
        where.push("category_id = :category_id");
        repl.category_id = cid;
      }
    }
    // ✅ 2) Rubro (TODOS dentro del rubro)
    else if (cid) {
      repl.category_id = cid;

      // 🔒 CLAVE: "Todos" SIEMPRE dentro del rubro
      // include_children=true agrega fallback por subcategories del rubro (por datos mixtos)
      if (inc) {
        where.push(`
          (
            category_id = :category_id
            OR subcategory_id IN (
              SELECT id FROM subcategories
              WHERE category_id = :category_id AND is_active = 1
            )
          )
        `);
      } else {
        // clásico: solo category_id
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
    const lim = Number(limit || 24);

    return {
      items: items || [],
      page: Number(page || 1),
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
