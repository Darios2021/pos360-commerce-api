// src/services/public.service.js
// ✅ COPY-PASTE FINAL
// FIX:
// - "Todos" SIEMPRE debe quedar acotado al rubro (category_id del padre)
// - subrubro filtra por subcategory_id (y fallback a category_id por compat)
// - include_children normalizado (por si viene "true"/"1")

const { sequelize } = require("../models");

function escLike(s) {
  return String(s).replace(/[%_]/g, (m) => "\\" + m);
}

function toBoolLike(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const s = String(v ?? "").toLowerCase().trim();
  return ["1", "true", "yes", "si"].includes(s);
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
    const inc = toBoolLike(include_children);

    // ✅ 1) Si viene subrubro: filtra por subcategory_id
    // (y fallback a category_id por si en la vista el hijo viene en category_id)
    if (sid) {
      where.push(`(
        subcategory_id = :subcategory_id
        OR category_id = :subcategory_id
      )`);
      repl.subcategory_id = sid;

      // 🔒 Si además viene category_id, también lo acotamos al rubro
      if (cid) {
        where.push(`category_id = :category_id`);
        repl.category_id = cid;
      }
    }
    // ✅ 2) Si NO viene subrubro y viene rubro:
    // "Todos" => SIEMPRE category_id = rubro (acotado)
    else if (cid) {
      repl.category_id = cid;

      // 🔒 Esta línea es LA CLAVE:
      // aun con include_children=true, nunca puede traer productos de otros rubros
      where.push(`category_id = :category_id`);

      // Opcional: si tu vista a veces guarda el rubro en parent_category_id,
      // descomentá esto (solo si existe esa columna en v_public_catalog):
      // where.push(`(category_id = :category_id OR parent_category_id = :category_id)`);

      // Si querés "include_children" de verdad (subrubros del rubro),
      // NO hace falta agregar nada acá porque ya estás acotado al rubro.
      // Pero si tu v_public_catalog tiene casos raros donde category_id = subrubro,
      // entonces sí usamos el IN de hijos como fallback:
      if (inc) {
        where.push(`(
          category_id = :category_id
          OR category_id IN (
            SELECT id FROM categories
            WHERE parent_id = :category_id AND is_active = 1
          )
        )`);
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
