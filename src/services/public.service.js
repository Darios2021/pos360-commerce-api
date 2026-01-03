// src/services/public.service.js
// ✅ COPY-PASTE FINAL (igual que POS / Inventario)
// REALIDAD de tu DB:
// - Rubro/Subrubro salen de `categories` usando parent_id
// - products.category_id guarda el "subrubro" (categoría hija)
// - products.subcategory_id NO se está usando (tu join a subcategories da vacío)

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
  // ✅ Taxonomía (como POS)
  // =====================

  // Rubros = categories parent_id IS NULL
  async listCategories() {
    const [rows] = await sequelize.query(`
      SELECT id, name
      FROM categories
      WHERE is_active = 1 AND parent_id IS NULL
      ORDER BY name ASC
    `);
    return rows || [];
  },

  // Subrubros = categories donde parent_id = rubro
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
    category_id,      // rubro (padre)
    subcategory_id,   // subrubro (chip) => OJO: es ID de categories hijo
    include_children,
    in_stock,
    page,
    limit,
  }) {
    const where = ["branch_id = :branch_id"];
    const repl = {
      branch_id,
      limit: Math.min(100, Math.max(1, Number(limit || 24))),
      offset: (Math.max(1, Number(page || 1)) - 1) * Math.min(100, Math.max(1, Number(limit || 24))),
    };

    const parentId = Number(category_id || 0);
    const childId = Number(subcategory_id || 0);
    const inc = toBoolLike(include_children, false);

    // ✅ 1) Si viene subrubro (chip) => en tu DB ES products.category_id
    if (childId) {
      where.push("category_id = :child_category_id");
      repl.child_category_id = childId;

      // Si además viene rubro, acota por consistencia (child debe pertenecer al parent)
      if (parentId) {
        where.push(`
          category_id IN (
            SELECT id FROM categories
            WHERE (id = :child_category_id AND parent_id = :parent_id) OR id = :child_category_id
          )
        `);
        repl.parent_id = parentId;
      }
    }
    // ✅ 2) Si viene rubro (Todos dentro del rubro)
    else if (parentId) {
      repl.parent_id = parentId;

      // include_children=true => padre + hijos
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
        // clásico: solo padre (si existieran productos cargados directo al padre)
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

    return {
      items: items || [],
      page: Number(page || 1),
      limit: repl.limit,
      total,
      pages: total ? Math.ceil(total / repl.limit) : 0,
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
