// src/services/public.service.js
// ✅ COPY-PASTE FINAL (FIX definitivo)
// - /public/categories: devuelve TODO (padres + hijos) con parent_id
// - Chips (subrubros): usa JOIN a products SOLO cuando hay subcategory_id
// - Search: SIN ESCAPE (evita parse errors 500)

const { sequelize } = require("../models");

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
  // ✅ Taxonomía
  // =====================
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
  // ✅ Catalog (chips + search robusto)
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

    if (sid) {
      where.push("p.category_id = :child_id");
      repl.child_id = sid;

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
      where.push("vc.category_id = :category_id");
      repl.category_id = cid;
    }

    // ✅ SEARCH SIN ESCAPE (evita 500 por parse)
    const q = String(search || "").trim();
    if (q.length) {
      repl.q = `%${q}%`;
      where.push(`
        (
          vc.name LIKE :q
          OR vc.brand LIKE :q
          OR vc.model LIKE :q
          OR vc.sku LIKE :q
          OR vc.barcode LIKE :q
          OR vc.code LIKE :q
        )
      `);
    }

    // ✅ stock (tu vista tiene track_stock y stock_qty, perfecto)
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
