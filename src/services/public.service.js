// src/services/public.service.js
// ✅ COPY-PASTE FINAL
// FIX: para que el Shop arme chips de subrubros (children) desde categories.parent_id
// - /public/categories => devuelve TODAS (padres + hijos) e incluye parent_id
// - /public/subcategories => (si lo usás) sigue devolviendo hijos por parent_id (compat)
// - /public/catalog => include_children trae productos del rubro + de sus hijos

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

  // ✅ CLAVE: devolver TODAS (padres + hijos) + parent_id
  async listCategories() {
    const [rows] = await sequelize.query(`
      SELECT id, name, parent_id
      FROM categories
      WHERE is_active = 1
      ORDER BY parent_id IS NOT NULL, parent_id, name
    `);
    return rows || [];
  },

  /**
   * ✅ Compat para tu endpoint /public/subcategories?category_id=ID
   * En tu modelo real, "subcategories" == hijos en categories.parent_id
   */
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
  // ✅ Catalog (include_children con categories.parent_id)
  // =====================
  // ✅ REEMPLAZAZAR SOLO listCatalog() EN src/services/public.service.js
async listCatalog({
  branch_id,
  search,
  category_id,       // rubro padre (AUDIO = 2)
  subcategory_id,    // ⚠️ en tu frontend hoy viene acá el "subrubro", pero en tu DB es categories.id (hijo)
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

  const parentCid = Number(category_id || 0);
  const childCid = Number(subcategory_id || 0); // ✅ TRATAR COMO category_id HIJO
  const inc = toBoolLike(include_children, false);

  // ✅ 1) Si viene "chip" (hijo) => filtrar por category_id del hijo
  if (childCid) {
    where.push("category_id = :child_category_id");
    repl.child_category_id = childCid;

    // 🔒 si además viene el padre, validamos pertenencia (evita mezclar rubros)
    if (parentCid) {
      where.push(`
        EXISTS (
          SELECT 1
          FROM categories c
          WHERE c.id = :child_category_id
            AND c.parent_id = :parent_category_id
            AND c.is_active = 1
        )
      `);
      repl.parent_category_id = parentCid;
    }
  }
  // ✅ 2) "Todos" dentro del rubro (padre)
  else if (parentCid) {
    repl.parent_category_id = parentCid;

    if (inc) {
      where.push(`
        (
          category_id = :parent_category_id
          OR category_id IN (
            SELECT id
            FROM categories
            WHERE parent_id = :parent_category_id AND is_active = 1
          )
        )
      `);
    } else {
      where.push("category_id = :parent_category_id");
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
