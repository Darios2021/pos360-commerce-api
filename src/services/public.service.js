// src/services/public.service.js
// ✅ COPY-PASTE FINAL (Catalog + Suggestions estilo ML)
// - /public/categories: devuelve TODO (padres + hijos) con parent_id
// - Rubros: parent_id IS NULL
// - Subrubros: parent_id = :category_id
// - Catálogo: usa v_public_catalog (vc)
// - Chip: usa products.category_id REAL cuando viene subcategory_id
// - Suggestions: endpoint dedicado, liviano y "menos estricto"

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

function tokenize(q) {
  const s = String(q || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!s) return [];
  return s
    .split(/[\s\-_/.,;:+]+/g)
    .filter(Boolean)
    .filter((t) => t.length >= 2)
    .slice(0, 6);
}

function searchFieldsOr(paramName) {
  // ✅ super compatible: LOWER + LIKE
  return `
    (
      LOWER(vc.name) LIKE :${paramName} ESCAPE '\\'
      OR LOWER(COALESCE(vc.brand,'')) LIKE :${paramName} ESCAPE '\\'
      OR LOWER(COALESCE(vc.model,'')) LIKE :${paramName} ESCAPE '\\'
      OR LOWER(COALESCE(vc.sku,'')) LIKE :${paramName} ESCAPE '\\'
      OR LOWER(COALESCE(vc.barcode,'')) LIKE :${paramName} ESCAPE '\\'
      OR LOWER(COALESCE(vc.code,'')) LIKE :${paramName} ESCAPE '\\'
      OR LOWER(COALESCE(vc.category_name,'')) LIKE :${paramName} ESCAPE '\\'
      OR LOWER(COALESCE(vc.subcategory_name,'')) LIKE :${paramName} ESCAPE '\\'
      OR LOWER(COALESCE(vc.description,'')) LIKE :${paramName} ESCAPE '\\'
    )
  `;
}

function applyTokenSearch(whereArr, replObj, rawSearch, mode /* AND | OR */) {
  const raw = String(rawSearch || "").trim();
  if (!raw) return { tokenCount: 0 };

  const tokens = tokenize(raw);
  if (!tokens.length) return { tokenCount: 0 };

  const tokenClauses = [];
  tokens.forEach((tok, i) => {
    const key = `q${i}`;
    replObj[key] = `%${escLike(tok)}%`;
    tokenClauses.push(searchFieldsOr(key));
  });

  whereArr.push(`(${tokenClauses.join(mode === "OR" ? " OR " : " AND ")})`);
  return { tokenCount: tokens.length };
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
  // ✅ Catalog
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
    const whereBase = ["vc.branch_id = :branch_id"];
    const replBase = {
      branch_id,
      limit: Number(limit || 24),
      offset: (Math.max(1, Number(page || 1)) - 1) * Number(limit || 24),
    };

    const cid = Number(category_id || 0);
    const sid = Number(subcategory_id || 0);
    const inc = toBoolLike(include_children, false);
    void inc;

    const joinProducts = sid ? `JOIN products p ON p.id = vc.product_id` : "";

    const where = [...whereBase];
    const repl = { ...replBase };

    // ✅ filtros de categoría
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

    // stock (solo si viene true/1)
    if (toBoolLike(in_stock, false)) {
      where.push("(vc.track_stock = 0 OR vc.stock_qty > 0)");
    }

    // ✅ búsqueda menos estricta por tokens
    const { tokenCount } = applyTokenSearch(where, repl, search, "AND");
    const whereSql = `WHERE ${where.join(" AND ")}`;

    // COUNT
    const [[countRow]] = await sequelize.query(
      `SELECT COUNT(*) AS total
       FROM v_public_catalog vc
       ${joinProducts}
       ${whereSql}`,
      { replacements: repl }
    );

    let total = Number(countRow?.total || 0);

    // ✅ fallback OR si no encontró nada y hay 2+ tokens
    if (total === 0 && tokenCount >= 2) {
      const where2 = [...whereBase];
      const repl2 = { ...replBase };

      // repetir filtros cat
      if (sid) {
        where2.push("p.category_id = :child_id");
        repl2.child_id = sid;

        if (cid) {
          where2.push(`
            :child_id IN (
              SELECT id FROM categories
              WHERE parent_id = :category_id AND is_active = 1
            )
          `);
          repl2.category_id = cid;
        }
      } else if (cid) {
        where2.push("vc.category_id = :category_id");
        repl2.category_id = cid;
      }

      if (toBoolLike(in_stock, false)) {
        where2.push("(vc.track_stock = 0 OR vc.stock_qty > 0)");
      }

      applyTokenSearch(where2, repl2, search, "OR");
      const whereSql2 = `WHERE ${where2.join(" AND ")}`;

      const [[countRow2]] = await sequelize.query(
        `SELECT COUNT(*) AS total
         FROM v_public_catalog vc
         ${joinProducts}
         ${whereSql2}`,
        { replacements: repl2 }
      );

      total = Number(countRow2?.total || 0);

      const [items2] = await sequelize.query(
        `SELECT vc.*
         FROM v_public_catalog vc
         ${joinProducts}
         ${whereSql2}
         ORDER BY vc.product_id DESC
         LIMIT :limit OFFSET :offset`,
        { replacements: repl2 }
      );

      const lim = Number(repl2.limit);
      return {
        items: items2 || [],
        page: Math.max(1, Number(page || 1)),
        limit: lim,
        total,
        pages: total ? Math.ceil(total / lim) : 0,
      };
    }

    // ITEMS normal
    const [items] = await sequelize.query(
      `SELECT vc.*
       FROM v_public_catalog vc
       ${joinProducts}
       ${whereSql}
       ORDER BY vc.product_id DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: repl }
    );

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
  // ✅ Suggestions (ENDPOINT NUEVO)
  // =====================
  async listSuggestions({ branch_id, q, limit }) {
    const raw = String(q || "").trim();
    const tokens = tokenize(raw);
    const lim = Math.min(15, Math.max(1, Number(limit || 8)));

    if (!branch_id || !tokens.length) return [];

    const where = ["vc.branch_id = :branch_id"];
    const repl = { branch_id };

    // ✅ OR por tokens para sugerencias (siempre debe traer algo)
    const tokenClauses = [];
    tokens.forEach((tok, i) => {
      const key = `q${i}`;
      repl[key] = `%${escLike(tok)}%`;
      tokenClauses.push(searchFieldsOr(key));
    });
    where.push(`(${tokenClauses.join(" OR ")})`);

    // ✅ score simple: cuántos tokens pegan en name/brand/model (prioriza título)
    // (MySQL compatible usando SUM de booleanos)
    const scoreExprParts = tokens.map((_, i) => `
      (
        (LOWER(vc.name) LIKE :q${i}) +
        (LOWER(COALESCE(vc.brand,'')) LIKE :q${i}) +
        (LOWER(COALESCE(vc.model,'')) LIKE :q${i})
      )
    `);

    const scoreExpr = scoreExprParts.join(" + ");

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [rows] = await sequelize.query(
      `
      SELECT
        vc.product_id,
        vc.name,
        vc.brand,
        vc.model,
        vc.category_name,
        vc.subcategory_name,
        vc.image_url,
        (${scoreExpr}) AS score
      FROM v_public_catalog vc
      ${whereSql}
      GROUP BY vc.product_id, vc.name, vc.brand, vc.model, vc.category_name, vc.subcategory_name, vc.image_url
      ORDER BY score DESC, vc.product_id DESC
      LIMIT ${lim}
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
