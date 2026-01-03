// src/services/public.service.js
// ✅ COPY-PASTE FINAL (REAL según tu DB POS)
// - Rubros: categories.parent_id IS NULL
// - Subrubros: categories.parent_id = rubro_id
// - Catalog:
//    * subcategory_id (chip) => filtra por category_id = (hijo)
//    * "Todos" => category_id IN (padre + hijos) usando include_children
// - Search + stock ok

const { sequelize } = require("../models");

function escLike(s) {
  return String(s ?? "").replace(/[%_]/g, (m) => "\\" + m);
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
  // ✅ Taxonomía (como POS)
  // =====================

  // ✅ SOLO rubros padres (para el menú)
  async listCategories() {
    const [rows] = await sequelize.query(`
      SELECT id, name
      FROM categories
      WHERE is_active = 1 AND parent_id IS NULL
      ORDER BY name ASC
    `);
    return rows || [];
  },

  // ✅ SUBRUBROS reales: categories hijas por parent_id
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
  // ✅ Catalog (include_children REAL)
  // =====================
  async listCatalog({
    branch_id,
    search,
    category_id,      // rubro padre
    subcategory_id,   // subrubro (hijo real de categories)
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

    const cid = Number(category_id || 0);
    const sid = Number(subcategory_id || 0);
    const inc = toBoolLike(include_children, false);

    // ✅ 1) Chip subrubro (hijo): filtra directo por category_id = subrubro
    if (sid) {
      where.push("category_id = :sub_id");
      repl.sub_id = sid;

      // 🔒 opcional: si además viene rubro, acota que el hijo pertenezca a ese rubro
      if (cid) {
        where.push(`
          EXISTS (
            SELECT 1
            FROM categories cc
            WHERE cc.id = :sub_id AND cc.parent_id = :cat_id AND cc.is_active = 1
          )
        `);
        repl.cat_id = cid;
      }
    }
    // ✅ 2) Rubro (TODOS dentro del rubro)
    else if (cid) {
      repl.cat_id = cid;

      if (inc) {
        // padre + todos los hijos (subrubros)
        where.push(`
          (
            category_id = :cat_id
            OR category_id IN (
              SELECT id FROM categories
              WHERE parent_id = :cat_id AND is_active = 1
            )
          )
        `);
      } else {
        // solo category_id = rubro (por si tenés productos cargados directo al padre)
        where.push("category_id = :cat_id");
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

    return {
      items: items || [],
      page: pg,
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
