// src/services/public.service.js
// ✅ COPY-PASTE FINAL (MODELO POS/INVENTARIO)
// - /public/categories: devuelve TODO (padres + hijos) con parent_id
// - Rubros: parent_id IS NULL
// - Subrubros: parent_id = :category_id
// - Catálogo: "Todos" = category_id = padre OR category_id IN (hijos del padre)
// - Chip: filtra por category_id = hijo (vía subcategory_id)

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

  // ✅ IMPORTANTE: este endpoint debe devolver TODO (padres + hijos)
  // porque el frontend arma subrubros filtrando por parent_id.
// ✅ IMPORTANTE: devolver TODO (padres + hijos)
async listCategories() {
  const [rows] = await sequelize.query(`
    SELECT id, name, parent_id
    FROM categories
    WHERE is_active = 1
    ORDER BY
      CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END,
      parent_id ASC,
      name ASC
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
 // =====================
// ✅ Catalog (FIX chips con v_public_catalog “aplanado”)
// =====================
// =====================
// ✅ Catalog (FIX chips con v_public_catalog “aplanado”)
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
  const where = ["vc.branch_id = :branch_id"];
  const repl = {
    branch_id,
    limit: Number(limit || 24),
    offset: (Math.max(1, Number(page || 1)) - 1) * Number(limit || 24),
  };

  const cid = Number(category_id || 0);       // padre
  const sid = Number(subcategory_id || 0);    // hijo
  const inc = toBoolLike(include_children, false);
  void inc;

  // ✅ JOIN SOLO cuando hay chip (sid)
  const joinProducts = sid ? `JOIN products p ON p.id = vc.product_id` : "";

  // ✅ Chip: filtrar por products.category_id (hijo REAL)
  if (sid) {
    where.push("p.category_id = :child_id");
    repl.child_id = sid;

    // (opcional) validar que el hijo pertenezca al padre
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
    // ✅ “Todos” por rubro (PADRE normalizado en la vista)
    where.push("vc.category_id = :category_id");
    repl.category_id = cid;
  }

  const q = String(search || "").trim();
  if (q.length) {
    repl.q = `%${escLike(q)}%`;
    where.push(`
      (vc.name LIKE :q ESCAPE '\\'
      OR vc.brand LIKE :q ESCAPE '\\'
      OR vc.model LIKE :q ESCAPE '\\'
      OR vc.sku LIKE :q ESCAPE '\\'
      OR vc.barcode LIKE :q ESCAPE '\\')
    `);
  }

  // ✅ Solo aplicar si verdaderamente viene en_stock = 1/true
  // (Si tu vista no tiene track_stock/stock_qty, directamente dejalo comentado)
  if (toBoolLike(in_stock, false)) {
    where.push("(vc.track_stock = 0 OR vc.stock_qty > 0)");
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const [[countRow]] = await sequelize.query(
    `SELECT COUNT(*) AS total
     FROM v_public_catalog vc
     ${joinProducts}
     ${whereSql}`,
    { replacements: repl }
  );

  const [items] = await sequelize.query(
    `SELECT vc.*
     FROM v_public_catalog vc
     ${joinProducts}
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
       WHERE branch_id = :branch_id AND product_id = :product_id
       LIMIT 1`,
      { replacements: { branch_id, product_id } }
    );
    return rows?.[0] || null;
  },
};
