// src/services/public.service.js
// ✅ COPY-PASTE FINAL (Catalog + Suggestions) - MODELO POS/INVENTARIO
// - /public/categories: devuelve TODO (padres + hijos) con parent_id
// - /public/subcategories: hijos por parent_id
// - /public/catalog: catálogo con filtros
// - /public/suggestions: typeahead (busca en name/brand/model/sku/barcode/code/description/category/subcategory)

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
  // ✅ Taxonomía
  // =====================
  async listCategories() {
    const [rows] = await sequelize.query(`
      SELECT id, name, parent_id, is_active
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
      SELECT id, name, parent_id, is_active
      FROM categories
      WHERE is_active = 1 AND parent_id = :category_id
      ORDER BY name ASC
      `,
      { replacements: { category_id } }
    );
    return rows || [];
  },

  // =====================
  // ✅ Branches
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
  // ✅ Catalog (tu contrato actual)
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

    const cid = Number(category_id || 0); // padre
    const sid = Number(subcategory_id || 0); // hijo
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

    const q = String(search || "").trim();
    if (q.length) {
      repl.q = `%${escLike(q)}%`;
      where.push(`
        (
          LOWER(COALESCE(vc.name,'')) LIKE LOWER(:q) ESCAPE '\\'
          OR LOWER(COALESCE(vc.brand,'')) LIKE LOWER(:q) ESCAPE '\\'
          OR LOWER(COALESCE(vc.model,'')) LIKE LOWER(:q) ESCAPE '\\'
          OR LOWER(COALESCE(vc.sku,'')) LIKE LOWER(:q) ESCAPE '\\'
          OR LOWER(COALESCE(vc.barcode,'')) LIKE LOWER(:q) ESCAPE '\\'
          OR LOWER(COALESCE(vc.code,'')) LIKE LOWER(:q) ESCAPE '\\'
          OR LOWER(COALESCE(vc.description,'')) LIKE LOWER(:q) ESCAPE '\\'
          OR LOWER(COALESCE(vc.category_name,'')) LIKE LOWER(:q) ESCAPE '\\'
          OR LOWER(COALESCE(vc.subcategory_name,'')) LIKE LOWER(:q) ESCAPE '\\'
        )
      `);
    }

    // stock opcional
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

  // =====================
  // ✅ Suggestions (typeahead) - “menos estricto”
  // Busca en: name/brand/model/sku/barcode/code/description/category/subcategory
  // Ordena por:
  // 1) comienza con q
  // 2) contiene q en name
  // 3) contiene q en otros campos
  // =====================
  async listSuggestions({ branch_id, q, limit }) {
    const query = String(q || "").trim().toLowerCase();
    if (!query) return [];

    const repl = {
      branch_id: Number(branch_id),
      limit: Math.min(15, Math.max(1, Number(limit || 8))),
      qLike: `%${escLike(query)}%`,
      qRaw: query,
    };

    const [rows] = await sequelize.query(
      `
      SELECT
        vc.product_id,
        vc.name,
        vc.brand,
        vc.model,
        vc.category_id,
        vc.category_name,
        vc.subcategory_id,
        vc.subcategory_name,
        vc.image_url
      FROM v_public_catalog vc
      WHERE vc.branch_id = :branch_id
        AND (
          LOWER(COALESCE(vc.name,'')) LIKE :qLike ESCAPE '\\'
          OR LOWER(COALESCE(vc.brand,'')) LIKE :qLike ESCAPE '\\'
          OR LOWER(COALESCE(vc.model,'')) LIKE :qLike ESCAPE '\\'
          OR LOWER(COALESCE(vc.sku,'')) LIKE :qLike ESCAPE '\\'
          OR LOWER(COALESCE(vc.barcode,'')) LIKE :qLike ESCAPE '\\'
          OR LOWER(COALESCE(vc.code,'')) LIKE :qLike ESCAPE '\\'
          OR LOWER(COALESCE(vc.description,'')) LIKE :qLike ESCAPE '\\'
          OR LOWER(COALESCE(vc.category_name,'')) LIKE :qLike ESCAPE '\\'
          OR LOWER(COALESCE(vc.subcategory_name,'')) LIKE :qLike ESCAPE '\\'
        )
      ORDER BY
        -- 0 = mejor: empieza con q
        CASE
          WHEN LOWER(COALESCE(vc.name,'')) LIKE CONCAT(:qRaw, '%') THEN 0
          WHEN LOWER(COALESCE(vc.brand,'')) LIKE CONCAT(:qRaw, '%') THEN 1
          WHEN LOWER(COALESCE(vc.model,'')) LIKE CONCAT(:qRaw, '%') THEN 2
          ELSE 3
        END,
        -- luego: más cerca en el nombre
        CASE
          WHEN LOCATE(:qRaw, LOWER(COALESCE(vc.name,''))) = 0 THEN 9999
          ELSE LOCATE(:qRaw, LOWER(COALESCE(vc.name,'')))
        END,
        vc.product_id DESC
      LIMIT :limit
      `,
      { replacements: repl }
    );

    return rows || [];
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
