// src/services/public.service.js
// ✅ COPY-PASTE FINAL COMPLETO
// - /public/categories => SOLO categorías PADRE (categories.parent_id IS NULL)
// - /public/subcategories => tabla subcategories
// - Filtro correcto por subcategory_id
// - strict_search + exclude_terms
// - Branding público + Config pagos
// - ✅ Producto individual devuelve MÚLTIPLES IMÁGENES (product_images)

const { sequelize } = require("../models");

const ESC = "!";
function escLike(s) {
  return String(s ?? "").replace(/[!%_]/g, (m) => ESC + m);
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

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}

module.exports = {
  // =========================
  // Categories (SOLO PADRES)
  // =========================
  async listCategories() {
    const [rows] = await sequelize.query(`
      SELECT id, name, parent_id
      FROM categories
      WHERE is_active = 1
        AND parent_id IS NULL
      ORDER BY name ASC
    `);
    return rows || [];
  },

  // =========================
  // Subcategories REALES
  // =========================
  async listSubcategories({ category_id }) {
    const cid = toInt(category_id, 0);
    if (!cid) return [];

    const [rows] = await sequelize.query(
      `
      SELECT id, name, category_id
      FROM subcategories
      WHERE is_active = 1
        AND category_id = :category_id
      ORDER BY name ASC
      `,
      { replacements: { category_id: cid } }
    );
    return rows || [];
  },

  // =========================
  // Branches públicas
  // =========================
  async listBranches() {
    const [rows] = await sequelize.query(`
      SELECT id, name, code, address, city
      FROM branches
      WHERE is_active = 1
      ORDER BY name ASC
    `);
    return rows || [];
  },

  // =========================
  // Catálogo público
  // =========================
  async listCatalog({
    branch_id,
    search,
    category_id,
    subcategory_id,
    include_children,
    in_stock,
    page,
    limit,
    strict_search,
    exclude_terms,
  }) {
    const where = ["vc.branch_id = :branch_id", "vc.is_active = 1"];

    const lim = Math.min(100, Math.max(1, toInt(limit, 24)));
    const pg = Math.max(1, toInt(page, 1));

    const repl = {
      branch_id: toInt(branch_id),
      limit: lim,
      offset: (pg - 1) * lim,
    };

    const cid = toInt(category_id, 0);
    const sid = toInt(subcategory_id, 0);
    const inc = toBoolLike(include_children, false);
    void inc;

    if (sid) {
      where.push("vc.subcategory_id = :subcategory_id");
      repl.subcategory_id = sid;

      if (cid) {
        where.push(`
          EXISTS (
            SELECT 1
            FROM subcategories s
            WHERE s.id = :subcategory_id
              AND s.category_id = :category_id
              AND s.is_active = 1
          )
        `);
        repl.category_id = cid;
      }
    } else if (cid) {
      where.push("vc.category_id = :category_id");
      repl.category_id = cid;
    }

    if (toBoolLike(in_stock, false)) {
      where.push("(vc.track_stock = 0 OR vc.stock_qty > 0)");
    }

    const ex = toStr(exclude_terms)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    for (let i = 0; i < ex.length; i++) {
      const term = ex[i].toLowerCase();
      const key = `ex${i}`;
      repl[key] = `%${escLike(term)}%`;

      where.push(`
        NOT (
          LOWER(COALESCE(vc.name,'')) LIKE :${key} ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.brand,'')) LIKE :${key} ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.model,'')) LIKE :${key} ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.category_name,'')) LIKE :${key} ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.subcategory_name,'')) LIKE :${key} ESCAPE '${ESC}'
        )
      `);
    }

    const q = toStr(search).toLowerCase();
    const strict = toBoolLike(strict_search, false);

    if (q.length) {
      repl.q = `%${escLike(q)}%`;

      where.push(`
        (
          LOWER(COALESCE(vc.name,'')) LIKE :q ESCAPE '${ESC}'
          ${strict ? "" : `OR LOWER(COALESCE(vc.description,'')) LIKE :q ESCAPE '${ESC}'`}
          OR LOWER(COALESCE(vc.brand,'')) LIKE :q ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.model,'')) LIKE :q ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.sku,'')) LIKE :q ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.barcode,'')) LIKE :q ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.code,'')) LIKE :q ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.category_name,'')) LIKE :q ESCAPE '${ESC}'
          OR LOWER(COALESCE(vc.subcategory_name,'')) LIKE :q ESCAPE '${ESC}'
        )
      `);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [[countRow]] = await sequelize.query(
      `
      SELECT COUNT(*) AS total
      FROM v_public_catalog vc
      ${whereSql}
      `,
      { replacements: repl }
    );

    const [items] = await sequelize.query(
      `
      SELECT vc.*
      FROM v_public_catalog vc
      ${whereSql}
      ORDER BY vc.product_id DESC
      LIMIT :limit OFFSET :offset
      `,
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

  // =========================
  // Autocompletado
  // =========================
  async listSuggestions({ branch_id, q, limit }) {
    const where = ["vc.branch_id = :branch_id", "vc.is_active = 1"];

    const repl = {
      branch_id: toInt(branch_id),
      limit: Math.min(15, Math.max(1, toInt(limit, 8))),
    };

    const qq = String(q || "").trim().toLowerCase();
    if (!qq.length) return [];

    repl.q = `%${escLike(qq)}%`;

    where.push(`
      (
        LOWER(COALESCE(vc.name,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.description,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.brand,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.model,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.sku,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.barcode,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.code,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.category_name,'')) LIKE :q ESCAPE '${ESC}'
        OR LOWER(COALESCE(vc.subcategory_name,'')) LIKE :q ESCAPE '${ESC}'
      )
    `);

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [rows] = await sequelize.query(
      `
      SELECT
        vc.product_id,
        MAX(vc.name) AS name,
        MAX(vc.brand) AS brand,
        MAX(vc.model) AS model,
        MAX(vc.category_id) AS category_id,
        MAX(vc.category_name) AS category_name,
        MAX(vc.subcategory_id) AS subcategory_id,
        MAX(vc.subcategory_name) AS subcategory_name,
        MIN(vc.image_url) AS image_url
      FROM v_public_catalog vc
      ${whereSql}
      GROUP BY vc.product_id
      ORDER BY vc.product_id DESC
      LIMIT :limit
      `,
      { replacements: repl }
    );

    return rows || [];
  },

  // =========================
  // Producto individual (✅ con imágenes múltiples)
  // =========================
  async getProductById({ branch_id, product_id }) {
    const bid = toInt(branch_id, 0);
    const pid = toInt(product_id, 0);
    if (!bid || !pid) return null;

    const [rows] = await sequelize.query(
      `
      SELECT *
      FROM v_public_catalog
      WHERE branch_id = :branch_id
        AND product_id = :product_id
      LIMIT 1
      `,
      { replacements: { branch_id: bid, product_id: pid } }
    );

    const item = rows?.[0] || null;
    if (!item) return null;

    const [imgs] = await sequelize.query(
      `
      SELECT id, url, sort_order
      FROM product_images
      WHERE product_id = :product_id
      ORDER BY sort_order ASC, id ASC
      `,
      { replacements: { product_id: pid } }
    );

    const images = (imgs || [])
      .map((r) => ({
        id: Number(r.id),
        url: String(r.url || "").trim(),
        sort_order: Number(r.sort_order || 0),
      }))
      .filter((x) => x.url);

    item.images = images;
    item.image_urls = images.map((x) => x.url);

    if (!String(item.image_url || "").trim() && item.image_urls.length) {
      item.image_url = item.image_urls[0];
    }

    return item;
  },

  // =========================
  // Branding público
  // =========================
  async getShopBranding() {
    const [rows] = await sequelize.query(`
      SELECT id, name, logo_url, favicon_url, updated_at
      FROM shop_branding
      WHERE id = 1
      LIMIT 1
    `);

    const r = rows?.[0] || null;

    if (!r) {
      return {
        name: "San Juan Tecnología",
        logo_url: "",
        favicon_url: "",
        updated_at: new Date().toISOString(),
      };
    }

    return {
      name: r.name || "San Juan Tecnología",
      logo_url: r.logo_url || "",
      favicon_url: r.favicon_url || "",
      updated_at: r.updated_at
        ? new Date(r.updated_at).toISOString()
        : new Date().toISOString(),
    };
  },

  // =========================
  // Config pagos
  // =========================
  async getPaymentConfig() {
    try {
      const [rows] = await sequelize.query(`
        SELECT transfer_alias, transfer_cbu, transfer_holder
        FROM shop_branding
        WHERE id = 1
        LIMIT 1
      `);

      const r = rows?.[0] || null;

      const transfer = {
        alias: String(r?.transfer_alias || "").trim(),
        cbu: String(r?.transfer_cbu || "").trim(),
        holder: String(r?.transfer_holder || "").trim(),
      };

      const envTransfer = {
        alias: String(process.env.TRANSFER_ALIAS || "").trim(),
        cbu: String(process.env.TRANSFER_CBU || "").trim(),
        holder: String(process.env.TRANSFER_HOLDER || "").trim(),
      };

      const finalTransfer =
        transfer.alias || transfer.cbu || transfer.holder ? transfer : envTransfer;

      return {
        transfer: finalTransfer,
        mercadopago: {
          enabled: !!String(process.env.MP_ACCESS_TOKEN || "").trim(),
        },
      };
    } catch (e) {
      return {
        transfer: {
          alias: String(process.env.TRANSFER_ALIAS || "").trim(),
          cbu: String(process.env.TRANSFER_CBU || "").trim(),
          holder: String(process.env.TRANSFER_HOLDER || "").trim(),
        },
        mercadopago: {
          enabled: !!String(process.env.MP_ACCESS_TOKEN || "").trim(),
        },
      };
    }
  },
};
