// src/services/public.service.js
// ✅ COPY-PASTE FINAL (MODELO POS/INVENTARIO)
// - /public/categories: devuelve TODO (padres + hijos) con parent_id
// - Rubros: parent_id IS NULL
// - Subrubros: parent_id = :category_id
// - Catálogo: "Todos" = vc.category_id = padre (vista normalizada)
// - Chip: filtra por products.category_id = hijo (vía subcategory_id)
// ✅ MEJORA BUSCADOR:
// - Busca por name/brand/model/sku/barcode/code + category_name/subcategory_name + description
// - Tokeniza búsqueda (tipo ML): "cargador 55w" => tokens ["cargador","55w"]
// - Modo NORMAL: AND por tokens (cada token matchea en cualquier campo)
// - Fallback: si total=0 y hay 2+ tokens => OR por tokens (menos estricto)

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
  // split por espacios y símbolos comunes, quedate con tokens útiles
  const parts = s.split(/[\s\-_/.,;:+]+/g).filter(Boolean);
  // tokens de 2+ chars para evitar ruido; si querés permitir 1 char, bajalo
  return parts.filter((t) => t.length >= 2).slice(0, 6);
}

module.exports = {
  // =====================
  // ✅ Taxonomía (POS model)
  // =====================

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
  // ✅ Catalog (v_public_catalog “aplanado”)
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

    const cid = Number(category_id || 0);       // padre
    const sid = Number(subcategory_id || 0);    // hijo
    const inc = toBoolLike(include_children, false);
    void inc;

    // ✅ JOIN SOLO cuando hay chip (sid) para filtrar por products.category_id (hijo real)
    const joinProducts = sid ? `JOIN products p ON p.id = vc.product_id` : "";

    // ====== filtros de categoría ======
    const whereCat = [...whereBase];
    const replCat = { ...replBase };

    if (sid) {
      whereCat.push("p.category_id = :child_id");
      replCat.child_id = sid;

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
      // ✅ “Todos” por rubro (PADRE normalizado en la vista)
      whereCat.push("vc.category_id = :category_id");
      replCat.category_id = cid;
    }

    // ====== stock ======
    if (toBoolLike(in_stock, false)) {
      whereCat.push("(vc.track_stock = 0 OR vc.stock_qty > 0)");
    }

    // ====== búsqueda (menos estricta tipo ML) ======
    // Campos disponibles en v_public_catalog (según tu DESCRIBE):
    // name, description, brand, model, sku, barcode, code, category_name, subcategory_name
    const fieldsSql = `
      (
        vc.name            COLLATE utf8mb4_general_ci LIKE :Q ESCAPE '\\'
        OR COALESCE(vc.brand,'')           COLLATE utf8mb4_general_ci LIKE :Q ESCAPE '\\'
        OR COALESCE(vc.model,'')           COLLATE utf8mb4_general_ci LIKE :Q ESCAPE '\\'
        OR COALESCE(vc.sku,'')             COLLATE utf8mb4_general_ci LIKE :Q ESCAPE '\\'
        OR COALESCE(vc.barcode,'')         COLLATE utf8mb4_general_ci LIKE :Q ESCAPE '\\'
        OR COALESCE(vc.code,'')            COLLATE utf8mb4_general_ci LIKE :Q ESCAPE '\\'
        OR COALESCE(vc.category_name,'')   COLLATE utf8mb4_general_ci LIKE :Q ESCAPE '\\'
        OR COALESCE(vc.subcategory_name,'')COLLATE utf8mb4_general_ci LIKE :Q ESCAPE '\\'
        OR COALESCE(vc.description,'')     COLLATE utf8mb4_general_ci LIKE :Q ESCAPE '\\'
      )
    `;

    function applySearchTo(whereArr, replObj, mode /* "AND" | "OR" */) {
      const raw = String(search || "").trim();
      if (!raw) return;

      const tokens = tokenize(raw);
      if (!tokens.length) return;

      const pieces = [];
      tokens.forEach((tok, i) => {
        const key = `q${i}`;
        replObj[key] = `%${escLike(tok)}%`;
        pieces.push(fieldsSql.replaceAll(":Q", `:${key}`));
      });

      // ✅ NORMAL: AND por tokens
      // ✅ fallback: OR por tokens
      whereArr.push(`(${pieces.join(mode === "OR" ? " OR " : " AND ")})`);
    }

    async function runQuery(mode) {
      const where = [...whereCat];
      const repl = { ...replCat };

      applySearchTo(where, repl, mode);

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

    // 1) modo normal (AND tokens)
    let result = await runQuery("AND");

    // 2) fallback menos estricto (OR tokens) si hay 2+ tokens y dio 0
    const tokCount = tokenize(String(search || "")).length;
    if (result.total === 0 && tokCount >= 2) {
      result = await runQuery("OR");
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
