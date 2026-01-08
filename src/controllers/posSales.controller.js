// src/controllers/posSales.controller.js
const { Op, fn, col, literal } = require("sequelize");
const {
  sequelize,
  Sale,
  Payment,
  SaleItem,
  Product,
  Category,
  ProductImage,
  Warehouse,
  Branch,
  User,
} = require("../models");

// =====================
// Utils
// =====================
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toFloat(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}
function parseDateTime(v) {
  if (!v) return null;
  const s = String(v).trim();
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}
function nowDate() {
  return new Date();
}
function upper(v) {
  return String(v || "").trim().toUpperCase();
}
function modelHas(model, key) {
  return !!model?.rawAttributes?.[key];
}

/**
 * 🔐 Obtiene user_id desde middleware o JWT (fallback)
 * NO valida token (eso ya lo hace requireAuth)
 */
function getAuthUserId(req) {
  const candidates = [
    req?.user?.id,
    req?.user?.user_id,
    req?.user?.sub,
    req?.auth?.id,
    req?.auth?.userId,
    req?.auth?.user_id,
    req?.jwt?.id,
    req?.jwt?.userId,
    req?.jwt?.sub,
    req?.tokenPayload?.id,
    req?.tokenPayload?.userId,
    req?.tokenPayload?.sub,
    req?.session?.user?.id,
    req?.session?.userId,
    req?.userId,
  ];

  for (const v of candidates) {
    const n = toInt(v, 0);
    if (n > 0) return n;
  }

  // Fallback: decodificar payload del JWT (ya validado por requireAuth)
  try {
    const h = String(req.headers?.authorization || "");
    const m = h.match(/^Bearer\s+(.+)$/i);
    const token = m?.[1];
    if (!token) return 0;

    const parts = token.split(".");
    if (parts.length !== 3) return 0;

    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payloadJson = Buffer.from(payloadB64, "base64").toString("utf8");
    const payload = JSON.parse(payloadJson);

    return (
      toInt(payload?.id, 0) ||
      toInt(payload?.userId, 0) ||
      toInt(payload?.user_id, 0) ||
      toInt(payload?.sub, 0) ||
      0
    );
  } catch {
    return 0;
  }
}

/**
 * ✅ branch_id SIEMPRE desde el usuario/contexto
 */
function getAuthBranchId(req) {
  return (
    toInt(req?.ctx?.branchId, 0) ||
    toInt(req?.ctx?.branch_id, 0) ||
    toInt(req?.user?.branch_id, 0) ||
    toInt(req?.user?.branchId, 0) ||
    toInt(req?.auth?.branch_id, 0) ||
    toInt(req?.auth?.branchId, 0) ||
    toInt(req?.branch?.id, 0) ||
    toInt(req?.branchId, 0) ||
    toInt(req?.branchContext?.branch_id, 0) ||
    toInt(req?.branchContext?.id, 0) ||
    0
  );
}

/**
 * ✅ Admin detector (robusto)
 */
function isAdminReq(req) {
  const u = req?.user || req?.auth || {};
  const email = String(u?.email || u?.identifier || u?.username || "").toLowerCase();
  if (email === "admin@360pos.local" || email.includes("admin@360pos.local")) return true;

  if (u?.is_admin === true || u?.isAdmin === true || u?.admin === true) return true;

  const roleNames = [];
  if (typeof u?.role === "string") roleNames.push(u.role);
  if (typeof u?.rol === "string") roleNames.push(u.rol);

  if (Array.isArray(u?.roles)) {
    for (const r of u.roles) {
      if (!r) continue;
      if (typeof r === "string") roleNames.push(r);
      else if (typeof r?.name === "string") roleNames.push(r.name);
      else if (typeof r?.role === "string") roleNames.push(r.role);
      else if (typeof r?.role?.name === "string") roleNames.push(r.role.name);
    }
  }

  const norm = (s) => String(s || "").trim().toLowerCase();
  return roleNames.map(norm).some((x) =>
    ["admin", "super_admin", "superadmin", "root", "owner"].includes(x)
  );
}

/**
 * ✅ Detecta alias real de asociación entre modelos (evita 500 por "as" incorrecto)
 */
function findAssocAlias(sourceModel, targetModel) {
  try {
    const assocs = sourceModel?.associations || {};
    for (const [alias, a] of Object.entries(assocs)) {
      if (!a) continue;
      if (a.target === targetModel) return alias;
    }
    return null;
  } catch {
    return null;
  }
}

function pickUserAttributes() {
  const attrs = [];
  const has = (k) => !!User?.rawAttributes?.[k];
  attrs.push("id");
  if (has("name")) attrs.push("name");
  if (has("full_name")) attrs.push("full_name");
  if (has("username")) attrs.push("username");
  if (has("email")) attrs.push("email");
  if (has("identifier")) attrs.push("identifier");
  if (has("first_name")) attrs.push("first_name");
  if (has("last_name")) attrs.push("last_name");
  return Array.from(new Set(attrs));
}

function pickBranchAttributes() {
  const attrs = [];
  const has = (k) => !!Branch?.rawAttributes?.[k];
  attrs.push("id");
  if (has("name")) attrs.push("name");
  if (has("title")) attrs.push("title");
  if (has("label")) attrs.push("label");
  return Array.from(new Set(attrs));
}

// ======================================================
// WHERE base (branch/status/from/to + q seguro)
// ======================================================
function buildWhereFromQuery(req) {
  const admin = isAdminReq(req);

  const q = String(req.query.q || "").trim();
  const status = String(req.query.status || "").trim().toUpperCase();

  const from = parseDateTime(req.query.from);
  const to = parseDateTime(req.query.to);

  const where = {};

  if (admin) {
    const requested = toInt(req.query.branch_id ?? req.query.branchId, 0);
    if (requested > 0) where.branch_id = requested;
  } else {
    const branch_id = getAuthBranchId(req);
    if (!branch_id) {
      return {
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      };
    }
    where.branch_id = branch_id;
  }

  if (status && modelHas(Sale, "status")) where.status = status;

  if (modelHas(Sale, "sold_at")) {
    if (from && to) where.sold_at = { [Op.between]: [from, to] };
    else if (from) where.sold_at = { [Op.gte]: from };
    else if (to) where.sold_at = { [Op.lte]: to };
  }

  // ✅ q seguro (solo columnas existentes)
  if (q) {
    const qNum = toFloat(q, NaN);
    const ors = [];

    if (modelHas(Sale, "customer_name")) ors.push({ customer_name: { [Op.like]: `%${q}%` } });
    if (modelHas(Sale, "sale_number")) ors.push({ sale_number: { [Op.like]: `%${q}%` } });
    if (modelHas(Sale, "customer_phone")) ors.push({ customer_phone: { [Op.like]: `%${q}%` } });
    if (modelHas(Sale, "customer_doc")) ors.push({ customer_doc: { [Op.like]: `%${q}%` } });

    if (Number.isFinite(qNum)) {
      ors.push({ id: toInt(qNum, 0) });
      if (modelHas(Sale, "total")) ors.push({ total: qNum });
      if (modelHas(Sale, "paid_total")) ors.push({ paid_total: qNum });
    }

    // si no hay ninguna col disponible, al menos id like
    if (!ors.length) ors.push({ id: { [Op.like]: `%${q}%` } });

    where[Op.or] = ors;
  }

  return { ok: true, where };
}

// ======================================================
// Filtros + includes (solo lo necesario)
// ======================================================
function buildQueryFilters(req) {
  const base = buildWhereFromQuery(req);
  if (!base.ok) return base;

  const where = base.where;

  const customer = String(req.query.customer || "").trim();
  const seller_id = toInt(req.query.seller_id ?? req.query.user_id ?? req.query.sellerId ?? req.query.seller, 0);
  const pay_method = String(req.query.pay_method || req.query.method || "").trim().toUpperCase();
  const product = String(req.query.product || "").trim();

  if (seller_id > 0 && modelHas(Sale, "user_id")) where.user_id = seller_id;

  if (customer) {
    const ors = [];
    if (modelHas(Sale, "customer_name")) ors.push({ customer_name: { [Op.like]: `%${customer}%` } });
    if (modelHas(Sale, "customer_doc")) ors.push({ customer_doc: { [Op.like]: `%${customer}%` } });
    if (modelHas(Sale, "customer_phone")) ors.push({ customer_phone: { [Op.like]: `%${customer}%` } });
    if (ors.length) {
      where[Op.and] = (where[Op.and] || []).concat([{ [Op.or]: ors }]);
    }
  }

  const include = [];

  const salePaymentsAs = findAssocAlias(Sale, Payment); // "payments"
  const saleItemsAs = findAssocAlias(Sale, SaleItem);   // "items"
  const saleBranchAs = findAssocAlias(Sale, Branch);    // "branch"
  const saleUserAs = findAssocAlias(Sale, User);        // "user"

  // ✅ Si filtrás por método, join required
  if (Payment && salePaymentsAs) {
    if (pay_method) {
      include.push({
        model: Payment,
        as: salePaymentsAs,
        required: true,
        where: { method: pay_method },
        attributes: [],
      });
    } else {
      // Si NO filtrás, no hace falta meter payments (ahorra join)
      // Si querés siempre para la UI, cambiá esto por required:false
    }
  }

  // ✅ Si filtrás por producto, join required
  if (product && SaleItem && saleItemsAs) {
    const pNum = toInt(product, 0);
    const itemWhere = {};

    if (pNum > 0) itemWhere.product_id = pNum;
    else {
      const ors = [];
      if (modelHas(SaleItem, "product_name_snapshot")) ors.push({ product_name_snapshot: { [Op.like]: `%${product}%` } });
      if (modelHas(SaleItem, "product_sku_snapshot")) ors.push({ product_sku_snapshot: { [Op.like]: `%${product}%` } });
      if (modelHas(SaleItem, "product_barcode_snapshot")) ors.push({ product_barcode_snapshot: { [Op.like]: `%${product}%` } });
      if (ors.length) itemWhere[Op.or] = ors;
    }

    include.push({
      model: SaleItem,
      as: saleItemsAs,
      required: true,
      where: itemWhere,
      attributes: [],
    });
  }

  // ✅ Para la UI (sin romper nada)
  if (Branch && saleBranchAs) include.push({ model: Branch, as: saleBranchAs, required: false, attributes: pickBranchAttributes() });
  if (User && saleUserAs) include.push({ model: User, as: saleUserAs, required: false, attributes: pickUserAttributes() });

  return { ok: true, where, include, salePaymentsAs, saleItemsAs };
}

// ======================================================
// Stats SQL (sin duplicar sumas por joins)
// ======================================================
function buildStatsSql(req) {
  const base = buildWhereFromQuery(req);
  if (!base.ok) return base;

  const where = base.where;

  const seller_id = toInt(req.query.seller_id ?? req.query.user_id ?? req.query.sellerId ?? req.query.seller, 0);
  const pay_method = String(req.query.pay_method || req.query.method || "").trim().toUpperCase();
  const product = String(req.query.product || "").trim();

  const joins = [];
  const conds = [];
  const repl = {};

  if (where.branch_id) { conds.push("s.branch_id = :branch_id"); repl.branch_id = where.branch_id; }
  if (where.status) { conds.push("s.status = :status"); repl.status = where.status; }

  if (where.sold_at?.[Op.between]) {
    conds.push("s.sold_at BETWEEN :from AND :to");
    repl.from = where.sold_at[Op.between][0];
    repl.to = where.sold_at[Op.between][1];
  } else if (where.sold_at?.[Op.gte]) {
    conds.push("s.sold_at >= :from");
    repl.from = where.sold_at[Op.gte];
  } else if (where.sold_at?.[Op.lte]) {
    conds.push("s.sold_at <= :to");
    repl.to = where.sold_at[Op.lte];
  }

  // q (lo reconstruimos igual que arriba pero SQL básico)
  const q = String(req.query.q || "").trim();
  if (q) {
    const qNum = toFloat(q, NaN);
    const parts = [];

    // Solo agregamos condiciones si existen columnas en Sale
    if (modelHas(Sale, "customer_name")) parts.push("s.customer_name LIKE :qLike");
    if (modelHas(Sale, "sale_number")) parts.push("s.sale_number LIKE :qLike");
    if (modelHas(Sale, "customer_phone")) parts.push("s.customer_phone LIKE :qLike");
    if (modelHas(Sale, "customer_doc")) parts.push("s.customer_doc LIKE :qLike");

    repl.qLike = `%${q}%`;

    if (Number.isFinite(qNum)) {
      parts.push("s.id = :qId");
      repl.qId = toInt(qNum, 0);
    }

    if (parts.length) conds.push(`(${parts.join(" OR ")})`);
  }

  if (seller_id > 0) { conds.push("s.user_id = :seller_id"); repl.seller_id = seller_id; }

  if (pay_method) {
    joins.push("INNER JOIN payments p ON p.sale_id = s.id");
    conds.push("p.method = :pay_method");
    repl.pay_method = pay_method;
  }

  if (product) {
    joins.push("INNER JOIN sale_items si ON si.sale_id = s.id");
    const pNum = toInt(product, 0);
    if (pNum > 0) {
      conds.push("si.product_id = :product_id");
      repl.product_id = pNum;
    } else {
      conds.push("(si.product_name_snapshot LIKE :pLike OR si.product_sku_snapshot LIKE :pLike OR si.product_barcode_snapshot LIKE :pLike)");
      repl.pLike = `%${product}%`;
    }
  }

  const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const sql = `
    SELECT
      COUNT(*) AS sales_count,
      COALESCE(SUM(t.paid_total),0) AS paid_sum,
      COALESCE(SUM(t.total),0) AS total_sum
    FROM (
      SELECT DISTINCT s.id, s.paid_total, s.total
      FROM sales s
      ${joins.join("\n")}
      ${whereSql}
    ) t
  `;

  return { ok: true, sql, replacements: repl };
}

// ============================
// GET /api/v1/pos/sales
// ✅ limpio + robusto (sin findAndCountAll)
// ============================
async function listSales(req, res, next) {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const built = buildQueryFilters(req);
    if (!built.ok) return res.status(400).json({ ok: false, code: built.code, message: built.message });

    const { where, include } = built;
    const hasRequiredJoin = (include || []).some((x) => x?.required === true);

    let total = 0;

    if (!hasRequiredJoin) {
      total = await Sale.count({ where });
    } else {
      // COUNT DISTINCT seguro (sin alias raros)
      const base = buildWhereFromQuery(req);
      if (!base.ok) return res.status(400).json({ ok: false, code: base.code, message: base.message });

      const w = base.where;
      const joins = [];
      const conds = [];
      const repl = {};

      if (w.branch_id) { conds.push("s.branch_id = :branch_id"); repl.branch_id = w.branch_id; }
      if (w.status) { conds.push("s.status = :status"); repl.status = w.status; }

      if (w.sold_at?.[Op.between]) { conds.push("s.sold_at BETWEEN :from AND :to"); repl.from = w.sold_at[Op.between][0]; repl.to = w.sold_at[Op.between][1]; }
      else if (w.sold_at?.[Op.gte]) { conds.push("s.sold_at >= :from"); repl.from = w.sold_at[Op.gte]; }
      else if (w.sold_at?.[Op.lte]) { conds.push("s.sold_at <= :to"); repl.to = w.sold_at[Op.lte]; }

      const seller_id = toInt(req.query.seller_id ?? req.query.user_id ?? req.query.sellerId ?? req.query.seller, 0);
      if (seller_id > 0) { conds.push("s.user_id = :seller_id"); repl.seller_id = seller_id; }

      const pay_method = String(req.query.pay_method || req.query.method || "").trim().toUpperCase();
      const product = String(req.query.product || "").trim();

      if (pay_method) {
        joins.push("INNER JOIN payments p ON p.sale_id = s.id");
        conds.push("p.method = :pay_method");
        repl.pay_method = pay_method;
      }

      if (product) {
        joins.push("INNER JOIN sale_items si ON si.sale_id = s.id");
        const pNum = toInt(product, 0);
        if (pNum > 0) { conds.push("si.product_id = :product_id"); repl.product_id = pNum; }
        else { conds.push("(si.product_name_snapshot LIKE :pLike OR si.product_sku_snapshot LIKE :pLike OR si.product_barcode_snapshot LIKE :pLike)"); repl.pLike = `%${product}%`; }
      }

      const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

      const sql = `
        SELECT COUNT(*) AS c
        FROM (
          SELECT DISTINCT s.id
          FROM sales s
          ${joins.join("\n")}
          ${whereSql}
        ) t
      `;

      const [r] = await sequelize.query(sql, { replacements: repl });
      total = toInt(r?.[0]?.c, 0);
    }

    const rows = await Sale.findAll({
      where,
      include,
      order: [["id", "DESC"]],
      limit,
      offset,
      subQuery: false,
    });

    const pages = Math.max(1, Math.ceil(total / limit));

    return res.json({
      ok: true,
      data: rows,
      meta: { page, limit, total, pages },
    });
  } catch (e) {
    console.error("[POS SALES] listSales error:", e?.message || e);
    if (e?.original) console.error("[POS SALES] original:", e.original);
    if (e?.sql) console.error("[POS SALES] sql:", e.sql);
    next(e);
  }
}

// ============================
// GET /api/v1/pos/sales/stats
// ============================
async function statsSales(req, res, next) {
  try {
    const built = buildStatsSql(req);
    if (!built.ok) return res.status(400).json({ ok: false, code: built.code, message: built.message });

    const [rows] = await sequelize.query(built.sql, { replacements: built.replacements });
    const r = rows?.[0] || {};

    return res.json({
      ok: true,
      data: {
        sales_count: toInt(r.sales_count, 0),
        paid_sum: Number(r.paid_sum || 0),
        total_sum: Number(r.total_sum || 0),
      },
    });
  } catch (e) {
    next(e);
  }
}

// ============================
// OPTIONS (mínimo cambio; si querés también los limpio)
// ============================
async function optionsSellers(req, res, next) {
  try {
    const base = buildWhereFromQuery(req);
    if (!base.ok) return res.status(400).json({ ok: false, code: base.code, message: base.message });

    const where = base.where;
    const q = String(req.query.q || "").trim();
    const limit = Math.min(50, Math.max(5, toInt(req.query.limit, 20)));

    const rows = await Sale.findAll({
      where,
      attributes: [[fn("DISTINCT", col("Sale.user_id")), "user_id"]],
      raw: true,
      limit: 2000,
    });

    const ids = rows.map((r) => toInt(r.user_id, 0)).filter((n) => n > 0);
    if (!ids.length) return res.json({ ok: true, data: [] });

    const attrs = pickUserAttributes();
    const userWhere = { id: ids };

    if (q) {
      const ors = [];
      for (const k of ["name", "full_name", "username", "email", "identifier", "first_name", "last_name"]) {
        if (attrs.includes(k)) ors.push({ [k]: { [Op.like]: `%${q}%` } });
      }
      if (ors.length) userWhere[Op.and] = [{ [Op.or]: ors }];
    }

    const users = await User.findAll({
      where: userWhere,
      attributes: attrs,
      limit,
      order: [["id", "ASC"]],
      raw: true,
    });

    const label = (u) =>
      u.name ||
      u.full_name ||
      (u.first_name || u.last_name ? `${u.first_name || ""} ${u.last_name || ""}`.trim() : "") ||
      u.username ||
      u.email ||
      u.identifier ||
      `#${u.id}`;

    return res.json({ ok: true, data: users.map((u) => ({ value: u.id, title: label(u) })) });
  } catch (e) {
    next(e);
  }
}

async function optionsCustomers(req, res, next) {
  try {
    const base = buildWhereFromQuery(req);
    if (!base.ok) return res.status(400).json({ ok: false, code: base.code, message: base.message });

    const where = { ...base.where };
    const q = String(req.query.q || "").trim();
    const limit = Math.min(50, Math.max(5, toInt(req.query.limit, 20)));

    if (modelHas(Sale, "customer_name")) where.customer_name = { [Op.ne]: null };

    if (q) {
      const ors = [];
      if (modelHas(Sale, "customer_name")) ors.push({ customer_name: { [Op.like]: `%${q}%` } });
      if (modelHas(Sale, "customer_doc")) ors.push({ customer_doc: { [Op.like]: `%${q}%` } });
      if (modelHas(Sale, "customer_phone")) ors.push({ customer_phone: { [Op.like]: `%${q}%` } });
      if (ors.length) where[Op.and] = (where[Op.and] || []).concat([{ [Op.or]: ors }]);
    }

    const group = [];
    if (modelHas(Sale, "customer_name")) group.push("customer_name");
    if (modelHas(Sale, "customer_doc")) group.push("customer_doc");
    if (modelHas(Sale, "customer_phone")) group.push("customer_phone");

    if (!group.length) return res.json({ ok: true, data: [] });

    const rows = await Sale.findAll({
      where,
      attributes: group,
      group,
      order: [[literal("customer_name"), "ASC"]],
      limit,
      raw: true,
    });

    const title = (c) => {
      const name = c.customer_name || "Consumidor Final";
      const doc = c.customer_doc ? ` · ${c.customer_doc}` : "";
      const phone = c.customer_phone ? ` · ${c.customer_phone}` : "";
      return `${name}${doc}${phone}`;
    };

    return res.json({
      ok: true,
      data: rows.map((c) => ({
        value: String(c.customer_doc || c.customer_phone || c.customer_name || "").trim() || (c.customer_name || ""),
        title: title(c),
        raw: c,
      })),
    });
  } catch (e) {
    next(e);
  }
}

async function optionsProducts(req, res, next) {
  try {
    const base = buildWhereFromQuery(req);
    if (!base.ok) return res.status(400).json({ ok: false, code: base.code, message: base.message });

    const where = base.where;
    const q = String(req.query.q || "").trim();
    const limit = Math.min(50, Math.max(5, toInt(req.query.limit, 20)));

    const itemSaleAs = findAssocAlias(SaleItem, Sale);

    let rows = [];

    if (SaleItem && Sale && itemSaleAs) {
      rows = await SaleItem.findAll({
        attributes: [
          "product_id",
          [fn("MAX", col("SaleItem.product_name_snapshot")), "name"],
          [fn("MAX", col("SaleItem.product_sku_snapshot")), "sku"],
          [fn("MAX", col("SaleItem.product_barcode_snapshot")), "barcode"],
        ],
        include: [{ model: Sale, as: itemSaleAs, required: true, attributes: [], where }],
        group: ["SaleItem.product_id"],
        order: [[literal("name"), "ASC"]],
        limit: 500,
        raw: true,
      });
    } else {
      const conds = [];
      const repl = {};
      if (where.branch_id) { conds.push("s.branch_id = :branch_id"); repl.branch_id = where.branch_id; }
      if (where.status) { conds.push("s.status = :status"); repl.status = where.status; }

      const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

      const sql = `
        SELECT
          si.product_id,
          MAX(si.product_name_snapshot) AS name,
          MAX(si.product_sku_snapshot) AS sku,
          MAX(si.product_barcode_snapshot) AS barcode
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
        ${whereSql}
        GROUP BY si.product_id
        ORDER BY name ASC
        LIMIT 500
      `;
      const [r] = await sequelize.query(sql, { replacements: repl });
      rows = r || [];
    }

    let out = (rows || []).map((r) => ({
      id: toInt(r.product_id, 0),
      name: r.name || `Producto #${r.product_id}`,
      sku: r.sku || "",
      barcode: r.barcode || "",
    }));

    if (q) {
      const qq = q.toLowerCase();
      out = out.filter((p) =>
        String(p.id).includes(qq) ||
        String(p.name).toLowerCase().includes(qq) ||
        String(p.sku).toLowerCase().includes(qq) ||
        String(p.barcode).toLowerCase().includes(qq)
      );
    }

    out = out.slice(0, limit);

    return res.json({
      ok: true,
      data: out.map((p) => ({
        value: String(p.id),
        title: `${p.name}${p.sku ? ` · SKU: ${p.sku}` : ""}${p.barcode ? ` · ${p.barcode}` : ""}`,
      })),
    });
  } catch (e) {
    next(e);
  }
}

// ============================
// GET /api/v1/pos/sales/:id
// (lo tuyo estaba bien; lo dejo igual)
// ============================
async function getSaleById(req, res, next) {
  try {
    const admin = isAdminReq(req);
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const salePaymentsAs = findAssocAlias(Sale, Payment);
    const saleItemsAs = findAssocAlias(Sale, SaleItem);
    const saleBranchAs = findAssocAlias(Sale, Branch);
    const saleUserAs = findAssocAlias(Sale, User);

    const itemWarehouseAs = findAssocAlias(SaleItem, Warehouse);
    const itemProductAs = findAssocAlias(SaleItem, Product);

    const productCategoryAs = findAssocAlias(Product, Category);
    const productImagesAs = findAssocAlias(Product, ProductImage);

    const catParentAs = findAssocAlias(Category, Category);

    const include = [];

    if (Payment && salePaymentsAs) include.push({ model: Payment, as: salePaymentsAs, required: false });
    if (Branch && saleBranchAs) include.push({ model: Branch, as: saleBranchAs, required: false, attributes: pickBranchAttributes() });
    if (User && saleUserAs) include.push({ model: User, as: saleUserAs, required: false, attributes: pickUserAttributes() });

    if (SaleItem && saleItemsAs) {
      const itemInclude = [];
      if (Warehouse && itemWarehouseAs) itemInclude.push({ model: Warehouse, as: itemWarehouseAs, required: false });

      if (Product && itemProductAs) {
        const prodInclude = [];

        if (Category && productCategoryAs) {
          const catInclude = [];
          if (catParentAs) catInclude.push({ model: Category, as: catParentAs, required: false });
          prodInclude.push({ model: Category, as: productCategoryAs, required: false, include: catInclude });
        }

        if (ProductImage && productImagesAs) prodInclude.push({ model: ProductImage, as: productImagesAs, required: false });

        itemInclude.push({ model: Product, as: itemProductAs, required: false, include: prodInclude });
      }

      include.push({ model: SaleItem, as: saleItemsAs, required: false, include: itemInclude });
    }

    const order = [];
    if (salePaymentsAs) order.push([{ model: Payment, as: salePaymentsAs }, "id", "ASC"]);
    if (saleItemsAs) order.push([{ model: SaleItem, as: saleItemsAs }, "id", "ASC"]);

    const sale = await Sale.findByPk(id, { include, order: order.length ? order : undefined });
    if (!sale) return res.status(404).json({ ok: false, message: "Venta no encontrada" });

    if (!admin) {
      const branch_id = getAuthBranchId(req);
      if (!branch_id) {
        return res.status(400).json({
          ok: false,
          code: "BRANCH_REQUIRED",
          message: "No se pudo determinar la sucursal del usuario (branch_id).",
        });
      }
      if (toInt(sale.branch_id, 0) !== toInt(branch_id, 0)) {
        return res.status(403).json({
          ok: false,
          code: "CROSS_BRANCH_SALE",
          message: "No podés ver una venta de otra sucursal.",
        });
      }
    }

    return res.json({ ok: true, data: sale });
  } catch (e) {
    next(e);
  }
}

// ============================
// POST /api/v1/pos/sales
// (te lo dejo igual que el tuyo, solo mínimo blindaje)
// ============================
async function createSale(req, res, next) {
  const t = await sequelize.transaction();
  try {
    const user_id = getAuthUserId(req);
    if (!user_id) {
      await t.rollback();
      return res.status(401).json({ ok: false, code: "NO_USER", message: "No se pudo determinar el usuario autenticado (user_id)." });
    }

    const branch_id = getAuthBranchId(req);
    if (!branch_id) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED", message: "No se pudo determinar la sucursal del usuario (branch_id)." });
    }

    const customer_name = modelHas(Sale, "customer_name") ? (String(req.body?.customer_name || "").trim() || null) : null;
    const status = modelHas(Sale, "status") ? (upper(req.body?.status) || "PAID") : undefined;
    const sold_at = modelHas(Sale, "sold_at") ? (parseDateTime(req.body?.sold_at) || nowDate()) : undefined;

    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    const payments = Array.isArray(req.body?.payments) ? req.body.payments : [];

    if (!items || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "items requerido (array no vacío)" });
    }

    const normItems = [];
    for (const it of items) {
      const product_id = toInt(it?.product_id || it?.productId, 0);
      const quantity = toFloat(it?.quantity, 0);
      const unit_price = toFloat(it?.unit_price ?? it?.unitPrice ?? it?.price, 0);

      const warehouse_id = await (async () => {
        const direct = toInt(it?.warehouse_id || it?.warehouseId, 0);
        if (direct > 0) return direct;

        const fromReq =
          toInt(req?.ctx?.warehouseId, 0) ||
          toInt(req?.ctx?.warehouse_id, 0) ||
          toInt(req?.warehouse?.id, 0) ||
          toInt(req?.warehouseId, 0) ||
          toInt(req?.branchContext?.warehouse_id, 0) ||
          toInt(req?.branchContext?.default_warehouse_id, 0) ||
          toInt(req?.branch?.warehouse_id, 0) ||
          toInt(req?.branch?.default_warehouse_id, 0) ||
          0;

        if (fromReq > 0) return fromReq;

        const wh = await Warehouse.findOne({
          where: { branch_id: toInt(branch_id, 0) },
          order: [["id", "ASC"]],
          transaction: t,
        });

        return toInt(wh?.id, 0);
      })();

      normItems.push({
        product_id,
        warehouse_id,
        quantity,
        unit_price,
        line_total: quantity * unit_price,
      });
    }

    for (const it of normItems) {
      if (!it.product_id || it.quantity <= 0 || it.unit_price < 0) {
        await t.rollback();
        return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "Item inválido: product_id requerido, quantity>0, unit_price>=0" });
      }
      if (!it.warehouse_id) {
        await t.rollback();
        return res.status(400).json({ ok: false, code: "WAREHOUSE_REQUIRED", message: "warehouse_id requerido (no vino en item y no se encontró depósito default para esta sucursal)." });
      }

      const wh = await Warehouse.findByPk(it.warehouse_id, { transaction: t });
      if (!wh) {
        await t.rollback();
        return res.status(404).json({ ok: false, code: "WAREHOUSE_NOT_FOUND", message: "Depósito inexistente." });
      }
      if (toInt(wh.branch_id, 0) !== toInt(branch_id, 0)) {
        await t.rollback();
        return res.status(403).json({ ok: false, code: "CROSS_BRANCH_WAREHOUSE", message: "El depósito no pertenece a la sucursal del usuario." });
      }
    }

    const subtotal = normItems.reduce((a, it) => a + it.line_total, 0);
    const discount_total = modelHas(Sale, "discount_total") ? toFloat(req.body?.discount_total, 0) : 0;
    const tax_total = modelHas(Sale, "tax_total") ? toFloat(req.body?.tax_total, 0) : 0;
    const total = modelHas(Sale, "total") ? Math.max(0, subtotal - discount_total + tax_total) : subtotal;

    const paid_total = modelHas(Sale, "paid_total") ? payments.reduce((a, p) => a + toFloat(p?.amount, 0), 0) : 0;
    const change_total = modelHas(Sale, "change_total") ? Math.max(0, paid_total - total) : 0;

    const salePayload = {
      branch_id,
      user_id,
      customer_name,
      subtotal,
      discount_total,
      tax_total,
      total,
      paid_total,
      change_total,
    };
    if (status !== undefined) salePayload.status = status;
    if (sold_at !== undefined) salePayload.sold_at = sold_at;

    if (modelHas(Sale, "sale_number") && typeof req.body?.sale_number === "string" && req.body.sale_number.trim()) {
      salePayload.sale_number = req.body.sale_number.trim();
    }

    const sale = await Sale.create(salePayload, { transaction: t });

    await SaleItem.bulkCreate(
      normItems.map((it) => ({
        sale_id: sale.id,
        product_id: it.product_id,
        warehouse_id: it.warehouse_id,
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.line_total,
      })),
      { transaction: t }
    );

    if (payments.length) {
      await Payment.bulkCreate(
        payments.map((p) => ({
          sale_id: sale.id,
          method: upper(p?.method) || "OTHER",
          amount: toFloat(p?.amount, 0),
          paid_at: parseDateTime(p?.paid_at) || sold_at || nowDate(),
        })),
        { transaction: t }
      );
    }

    await t.commit();

    const payAs = findAssocAlias(Sale, Payment);
    const created = await Sale.findByPk(sale.id, { include: payAs ? [{ model: Payment, as: payAs, required: false }] : [] });

    return res.status(201).json({ ok: true, message: "Venta creada", data: created });
  } catch (e) {
    try { await t.rollback(); } catch {}
    next(e);
  }
}

// ============================
// DELETE /api/v1/pos/sales/:id
// ============================
async function deleteSale(req, res, next) {
  const t = await sequelize.transaction();
  try {
    const admin = isAdminReq(req);
    const branch_id = getAuthBranchId(req);

    if (!admin && !branch_id) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED", message: "No se pudo determinar la sucursal del usuario (branch_id)." });
    }

    const id = toInt(req.params.id, 0);
    if (!id) {
      await t.rollback();
      return res.status(400).json({ ok: false, message: "ID inválido" });
    }

    const sale = await Sale.findByPk(id, { transaction: t });
    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, message: "Venta no encontrada" });
    }

    if (!admin && toInt(sale.branch_id, 0) !== toInt(branch_id, 0)) {
      await t.rollback();
      return res.status(403).json({ ok: false, code: "CROSS_BRANCH_SALE", message: "No podés eliminar una venta de otra sucursal." });
    }

    await Payment.destroy({ where: { sale_id: id }, transaction: t });
    await SaleItem.destroy({ where: { sale_id: id }, transaction: t });
    await sale.destroy({ transaction: t });

    await t.commit();
    return res.json({ ok: true, message: "Venta eliminada" });
  } catch (e) {
    try { await t.rollback(); } catch {}
    next(e);
  }
}

module.exports = {
  listSales,
  statsSales,
  optionsSellers,
  optionsCustomers,
  optionsProducts,
  getSaleById,
  createSale,
  deleteSale,
};
