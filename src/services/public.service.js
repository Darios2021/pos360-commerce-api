// src/services/public.service.js
// ✅ COPY-PASTE FINAL (robusto + compatible)
// - /public/categories: devuelve TODO (padres + hijos) con parent_id
// - Rubros: parent_id IS NULL
// - Subrubros: parent_id = :category_id
// - Catálogo: vc.category_id = padre (vista normalizada)
// - Chip: filtra por products.category_id = hijo (vía subcategory_id)
//
// ✅ BUSCADOR "tipo ML" (menos estricto):
// - Busca en: name, brand, model, sku, barcode, code, category_name, subcategory_name, description
// - Tokeniza la búsqueda: "cargador 55w" => ["cargador","55w"]
// - Modo normal: AND por tokens (cada token puede matchear cualquier campo)
// - Fallback: si da 0 y hay 2+ tokens => OR por tokens (para que "traiga algo")

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
  const parts = s.split(/[\s\-_/.,;:+]+/g).filter(Boolean);
  // tokens cortos hacen ruido; 2+ va bien para ecommerce
  return parts.filter((t) => t.length >= 2).slice(0, 6);
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

    const cid = Number(category_id || 0);       // padre (vc.category_id)
    const sid = Number(subcategory_id || 0);    // hijo (products.category_id REAL)
    const inc = toBoolLike(include_children, false);
    void inc;

    // ✅ JOIN SOLO si hay chip (sid)
    const joinProducts = sid ? `JOIN products p ON p.id = vc.product_id` : "";

    // ====== filtros base ======
    const whereCat = [...whereBase];
    const replCat = { ...replBase };

    if (sid) {
      whereCat.push("p.category_id = :child_id");
      replCat.child_id = sid;

      // opcional: validar pertenencia al padre
      if (cid) {
        whereCat.push(`
          :child_id IN (
            SELECT id FROM categories
            WHERE parent_id = :category_id AND is_active = 1
          )
        `);
        replCat.category_id = cid;
      }
    } else if (cid) {
      whereCat.push("vc.category_id = :category_id");
      replCat.category_id = cid;
    }

    // stock
    if (toBoolLike(in_stock, false)) {
      whereCat.push("(vc.track_stock = 0 OR vc.stock_qty > 0)");
    }

    // ====== búsqueda ======
    const searchFieldsOr = (paramName) => `
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

    function applySearch(whereArr, replObj, mode /* "AND" | "OR" */) {
      const raw = String(search || "").trim();
      if (!raw) return;

      const tokens = tokenize(raw);
      if (!tokens.length) return;

      const tokenClauses = [];

      tokens.forEach((tok, i) => {
        const key = `q${i}`;
        replObj[key] = `%${escLike(tok.toLowerCase())}%`;
        tokenClauses.push(searchFieldsOr(key));
      });

      whereArr.push(`(${tokenClauses.join(mode === "OR" ? " OR " : " AND ")})`);
    }

    async function run(mode) {
      const where = [...whereCat];
      const repl = { ...replCat };

      applySearch(where, repl, mode);

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

      return {
        items: items || [],
        total: Number(countRow?.total || 0),
      };
    }

    // 1) AND por tokens
    let result = await run("AND");

    // 2) fallback OR por tokens (si hay 2+ tokens y total=0)
    const tokCount = tokenize(String(search || "")).length;
    if (result.total === 0 && tokCount >= 2) {
      result = await run("OR");
    }

    const lim = Number(replBase.limit);
    const total = Number(result.total || 0);

    return {
      items: result.items || [],
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
