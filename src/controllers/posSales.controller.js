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
  UserBranch,
  // ✅ NUEVO (si no existe aún, crealo en models)
  SaleRefund,
} = require("../models");

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
  return roleNames.map(norm).some((x) => ["admin", "super_admin", "superadmin", "root", "owner"].includes(x));
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

function getTableName(model, fallback) {
  try {
    const t = model?.getTableName?.();
    if (!t) return fallback;
    if (typeof t === "string") return t;
    if (typeof t?.tableName === "string") return t.tableName;
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * ✅ Base where: branch/status/from/to/q
 * branch:
 *  - admin: permite branch_id query
 *  - no admin: branch_id desde token/contexto
 */
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

  if (status) where.status = status;

  if (from && to) where.sold_at = { [Op.between]: [from, to] };
  else if (from) where.sold_at = { [Op.gte]: from };
  else if (to) where.sold_at = { [Op.lte]: to };

  if (q) {
    const qNum = toFloat(q, NaN);
    where[Op.or] = [
      { customer_name: { [Op.like]: `%${q}%` } },
      { sale_number: { [Op.like]: `%${q}%` } },
      { customer_phone: { [Op.like]: `%${q}%` } },
      { customer_doc: { [Op.like]: `%${q}%` } },
    ];

    if (Number.isFinite(qNum)) {
      where[Op.or].push({ id: toInt(qNum, 0) });
      where[Op.or].push({ total: qNum });
      where[Op.or].push({ paid_total: qNum });
    }
  }

  return { ok: true, where };
}

/**
 * ✅ Filtros reales + include robusto según asociaciones existentes
 * - seller_id / seller (id)
 * - customer (texto)
 * - pay_method (Payment.method)
 * - product (SaleItem snapshots / product_id)
 */
function buildQueryFilters(req) {
  const base = buildWhereFromQuery(req);
  if (!base.ok) return base;

  const where = base.where;

  const customer = String(req.query.customer || "").trim();
  const seller_id = toInt(req.query.seller_id ?? req.query.user_id ?? req.query.sellerId ?? req.query.seller, 0);
  const pay_method = String(req.query.pay_method || req.query.method || "").trim().toUpperCase();
  const product = String(req.query.product || "").trim();

  if (seller_id > 0) where.user_id = seller_id;

  if (customer) {
    where[Op.and] = (where[Op.and] || []).concat([
      {
        [Op.or]: [
          { customer_name: { [Op.like]: `%${customer}%` } },
          { customer_doc: { [Op.like]: `%${customer}%` } },
          { customer_phone: { [Op.like]: `%${customer}%` } },
        ],
      },
    ]);
  }

  const include = [];

  // Alias reales
  const salePaymentsAs = findAssocAlias(Sale, Payment); // "payments"
  const saleItemsAs = findAssocAlias(Sale, SaleItem);   // "items"
  const saleBranchAs = findAssocAlias(Sale, Branch);    // "branch"
  const saleUserAs = findAssocAlias(Sale, User);        // "user"

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
      include.push({ model: Payment, as: salePaymentsAs, required: false });
    }
  }

  if (product && SaleItem && saleItemsAs) {
    const pNum = toInt(product, 0);
    const itemWhere = {};

    if (pNum > 0) itemWhere.product_id = pNum;
    else {
      itemWhere[Op.or] = [
        { product_name_snapshot: { [Op.like]: `%${product}%` } },
        { product_sku_snapshot: { [Op.like]: `%${product}%` } },
        { product_barcode_snapshot: { [Op.like]: `%${product}%` } },
      ];
    }

    include.push({
      model: SaleItem,
      as: saleItemsAs,
      required: true,
      where: itemWhere,
      attributes: [],
    });
  }

  if (Branch && saleBranchAs) {
    include.push({ model: Branch, as: saleBranchAs, required: false, attributes: pickBranchAttributes() });
  }
  if (User && saleUserAs) {
    include.push({ model: User, as: saleUserAs, required: false, attributes: pickUserAttributes() });
  }

  return { ok: true, where, include, salePaymentsAs, saleItemsAs, saleBranchAs, saleUserAs };
}

/**
 * ✅ Construye condiciones SQL (SIN duplicar por joins)
 * Usamos EXISTS para pay_method y product, así NO se multiplican filas.
 */
function buildStatsFiltersSql(req) {
  const base = buildWhereFromQuery(req);
  if (!base.ok) return base;

  const where = base.where;

  const customer = String(req.query.customer || "").trim();
  const seller_id = toInt(req.query.seller_id ?? req.query.user_id ?? req.query.sellerId ?? req.query.seller, 0);
  const pay_method = String(req.query.pay_method || req.query.method || "").trim().toUpperCase();
  const product = String(req.query.product || "").trim();

  const conds = [];
  const repl = {};

  if (where.branch_id) {
    conds.push("s.branch_id = :branch_id");
    repl.branch_id = where.branch_id;
  }
  if (where.status) {
    conds.push("s.status = :status");
    repl.status = where.status;
  }

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

  const q = String(req.query.q || "").trim();
  if (q) {
    const qNum = toFloat(q, NaN);
    const parts = [
      "s.customer_name LIKE :qLike",
      "s.sale_number LIKE :qLike",
      "s.customer_phone LIKE :qLike",
      "s.customer_doc LIKE :qLike",
    ];
    repl.qLike = `%${q}%`;
    if (Number.isFinite(qNum)) {
      parts.push("s.id = :qId");
      repl.qId = toInt(qNum, 0);
    }
    conds.push(`(${parts.join(" OR ")})`);
  }

  if (customer) {
    conds.push("(s.customer_name LIKE :cLike OR s.customer_doc LIKE :cLike OR s.customer_phone LIKE :cLike)");
    repl.cLike = `%${customer}%`;
  }

  if (seller_id > 0) {
    conds.push("s.user_id = :seller_id");
    repl.seller_id = seller_id;
  }

  const salesTable = getTableName(Sale, "sales");
  const payTable = getTableName(Payment, "payments");
  const itemsTable = getTableName(SaleItem, "sale_items");

  if (pay_method) {
    conds.push(`EXISTS (
      SELECT 1 FROM ${payTable} p
      WHERE p.sale_id = s.id AND p.method = :pay_method
    )`);
    repl.pay_method = pay_method;
  }

  if (product) {
    const pNum = toInt(product, 0);
    if (pNum > 0) {
      conds.push(`EXISTS (
        SELECT 1 FROM ${itemsTable} si
        WHERE si.sale_id = s.id AND si.product_id = :product_id
      )`);
      repl.product_id = pNum;
    } else {
      conds.push(`EXISTS (
        SELECT 1 FROM ${itemsTable} si
        WHERE si.sale_id = s.id AND (
          si.product_name_snapshot LIKE :pLike OR
          si.product_sku_snapshot LIKE :pLike OR
          si.product_barcode_snapshot LIKE :pLike
        )
      )`);
      repl.pLike = `%${product}%`;
    }
  }

  const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  return {
    ok: true,
    whereSql,
    replacements: repl,
    tables: { salesTable, payTable, itemsTable },
  };
}

/**
 * ✅ Stats NETO:
 * - total ventas (count)
 * - total vendido NETO (SUM(s.total) - SUM(refunds))
 * - total cobrado NETO (SUM(s.paid_total) - SUM(refunds))
 * - breakdown por método (SUM(payments.amount) - refunds prorrateo NO incluido; se deja bruto por método)
 */
async function statsSales(req, res, next) {
  try {
    const built = buildStatsFiltersSql(req);
    if (!built.ok) {
      return res.status(400).json({ ok: false, code: built.code, message: built.message });
    }

    const { whereSql, replacements, tables } = built;
    const { salesTable, payTable } = tables;

    const refundsTable = getTableName(SaleRefund, "sale_refunds");

    // 0) Refunds agregadas por sale_id (para neto)
    const refundsJoin = SaleRefund
      ? `LEFT JOIN (
          SELECT r.sale_id, COALESCE(SUM(r.amount),0) AS refunds_sum
          FROM ${refundsTable} r
          GROUP BY r.sale_id
        ) rr ON rr.sale_id = s.id`
      : `LEFT JOIN (SELECT NULL AS sale_id, 0 AS refunds_sum) rr ON 1=0`;

    // 1) Totales NETOS
    const sqlTotals = `
      SELECT
        COUNT(*) AS sales_count,
        COALESCE(SUM(s.total),0) AS gross_total_sum,
        COALESCE(SUM(s.paid_total),0) AS gross_paid_sum,
        COALESCE(SUM(rr.refunds_sum),0) AS refunds_sum,
        (COALESCE(SUM(s.total),0) - COALESCE(SUM(rr.refunds_sum),0)) AS total_sum,
        (COALESCE(SUM(s.paid_total),0) - COALESCE(SUM(rr.refunds_sum),0)) AS paid_sum
      FROM ${salesTable} s
      ${refundsJoin}
      ${whereSql}
    `;

    // 2) Breakdown de pagos (bruto por método)
    const sqlPayments = `
      SELECT
        UPPER(p.method) AS method,
        COALESCE(SUM(p.amount),0) AS amount_sum
      FROM ${payTable} p
      INNER JOIN ${salesTable} s ON s.id = p.sale_id
      ${whereSql}
      GROUP BY UPPER(p.method)
      ORDER BY UPPER(p.method) ASC
    `;

    const [rowsTotals] = await sequelize.query(sqlTotals, { replacements });
    const [rowsPay] = await sequelize.query(sqlPayments, { replacements });

    const t = rowsTotals?.[0] || {};

    const byMethod = {};
    for (const r of rowsPay || []) {
      const k = String(r.method || "").trim().toUpperCase() || "OTHER";
      byMethod[k] = Number(r.amount_sum || 0);
    }

    const methods = {
      CASH: byMethod.CASH || byMethod.EFECTIVO || 0,
      TRANSFER: byMethod.TRANSFER || byMethod.TRANSFERENCIA || 0,
      DEBIT: byMethod.DEBIT || byMethod["TARJETA_DEBITO"] || byMethod["DEBITO"] || 0,
      CREDIT: byMethod.CREDIT || byMethod["TARJETA_CREDITO"] || byMethod["CREDITO"] || 0,
      QR: byMethod.QR || 0,
      OTHER: 0,
    };

    const known = new Set(["CASH","EFECTIVO","TRANSFER","TRANSFERENCIA","DEBIT","TARJETA_DEBITO","DEBITO","CREDIT","TARJETA_CREDITO","CREDITO","QR"]);
    let otherSum = 0;
    for (const [k, v] of Object.entries(byMethod)) {
      if (!known.has(k)) otherSum += Number(v || 0);
    }
    methods.OTHER = otherSum;

    return res.json({
      ok: true,
      data: {
        sales_count: toInt(t.sales_count, 0),

        // ✅ NETO (impacta devoluciones)
        total_sum: Number(t.total_sum || 0),
        paid_sum: Number(t.paid_sum || 0),

        // ✅ extra útil para auditoría
        refunds_sum: Number(t.refunds_sum || 0),
        gross_total_sum: Number(t.gross_total_sum || 0),
        gross_paid_sum: Number(t.gross_paid_sum || 0),

        payments: {
          cash: methods.CASH,
          transfer: methods.TRANSFER,
          debit: methods.DEBIT,
          credit: methods.CREDIT,
          qr: methods.QR,
          other: methods.OTHER,
          raw_by_method: byMethod,
        },
      },
    });
  } catch (e) {
    next(e);
  }
}

// ============================
// GET /api/v1/pos/sales
// ============================
async function listSales(req, res, next) {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const built = buildQueryFilters(req);
    if (!built.ok) {
      return res.status(400).json({ ok: false, code: built.code, message: built.message });
    }

    const { where, include, salePaymentsAs, saleItemsAs } = built;
    const hasRequiredJoin = (include || []).some((x) => x?.required === true);

    const salesTable = getTableName(Sale, "sales");
    const payTable = getTableName(Payment, "payments");
    const itemsTable = getTableName(SaleItem, "sale_items");

    let total = 0;

    if (!hasRequiredJoin) {
      total = await Sale.count({ where });
    } else {
      const needPay = (include || []).some((x) => x?.as === salePaymentsAs && x?.required === true);
      const needItems = (include || []).some((x) => x?.as === saleItemsAs && x?.required === true);

      const joins = [];
      const conds = [];
      const repl = {};

      const base = buildWhereFromQuery(req);
      if (!base.ok) {
        return res.status(400).json({ ok: false, code: base.code, message: base.message });
      }
      const w = base.where;

      if (w.branch_id) { conds.push("s.branch_id = :branch_id"); repl.branch_id = w.branch_id; }
      if (w.status) { conds.push("s.status = :status"); repl.status = w.status; }

      if (w.sold_at?.[Op.between]) {
        conds.push("s.sold_at BETWEEN :from AND :to");
        repl.from = w.sold_at[Op.between][0];
        repl.to = w.sold_at[Op.between][1];
      } else if (w.sold_at?.[Op.gte]) {
        conds.push("s.sold_at >= :from");
        repl.from = w.sold_at[Op.gte];
      } else if (w.sold_at?.[Op.lte]) {
        conds.push("s.sold_at <= :to");
        repl.to = w.sold_at[Op.lte];
      }

      const q = String(req.query.q || "").trim();
      if (q) {
        const qNum = toFloat(q, NaN);
        const parts = [
          "s.customer_name LIKE :qLike",
          "s.sale_number LIKE :qLike",
          "s.customer_phone LIKE :qLike",
          "s.customer_doc LIKE :qLike",
        ];
        repl.qLike = `%${q}%`;
        if (Number.isFinite(qNum)) {
          parts.push("s.id = :qId");
          repl.qId = toInt(qNum, 0);
        }
        conds.push(`(${parts.join(" OR ")})`);
      }

      const seller_id = toInt(req.query.seller_id ?? req.query.user_id ?? req.query.sellerId ?? req.query.seller, 0);
      if (seller_id > 0) { conds.push("s.user_id = :seller_id"); repl.seller_id = seller_id; }

      const pay_method = String(req.query.pay_method || req.query.method || "").trim().toUpperCase();
      if (needPay) {
        joins.push(`INNER JOIN ${payTable} p ON p.sale_id = s.id`);
        if (pay_method) { conds.push("p.method = :pay_method"); repl.pay_method = pay_method; }
      }

      const product = String(req.query.product || "").trim();
      if (needItems) {
        joins.push(`INNER JOIN ${itemsTable} si ON si.sale_id = s.id`);
        if (product) {
          const pNum = toInt(product, 0);
          if (pNum > 0) { conds.push("si.product_id = :product_id"); repl.product_id = pNum; }
          else {
            conds.push("(si.product_name_snapshot LIKE :pLike OR si.product_sku_snapshot LIKE :pLike OR si.product_barcode_snapshot LIKE :pLike)");
            repl.pLike = `%${product}%`;
          }
        }
      }

      const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

      const sql = `
        SELECT COUNT(*) AS c
        FROM (
          SELECT DISTINCT s.id
          FROM ${salesTable} s
          ${joins.join("\n")}
          ${whereSql}
        ) t
      `;

      const [r] = await sequelize.query(sql, { replacements: repl });
      total = toInt(r?.[0]?.c, 0);
    }

    const rows = await Sale.findAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
      include,
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
// OPTIONS para desplegables reales
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

    where.customer_name = { [Op.ne]: null };

    if (q) {
      where[Op.and] = (where[Op.and] || []).concat([
        {
          [Op.or]: [
            { customer_name: { [Op.like]: `%${q}%` } },
            { customer_doc: { [Op.like]: `%${q}%` } },
            { customer_phone: { [Op.like]: `%${q}%` } },
          ],
        },
      ]);
    }

    const rows = await Sale.findAll({
      where,
      attributes: ["customer_name", "customer_doc", "customer_phone"],
      group: ["customer_name", "customer_doc", "customer_phone"],
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
        include: [
          {
            model: Sale,
            as: itemSaleAs,
            required: true,
            attributes: [],
            where,
          },
        ],
        group: ["SaleItem.product_id"],
        order: [[literal("name"), "ASC"]],
        limit: 500,
        raw: true,
      });
    } else {
      const salesTable = getTableName(Sale, "sales");
      const itemsTable = getTableName(SaleItem, "sale_items");

      const conds = [];
      const repl = {};

      if (where.branch_id) { conds.push("s.branch_id = :branch_id"); repl.branch_id = where.branch_id; }
      if (where.status) { conds.push("s.status = :status"); repl.status = where.status; }
      if (where.sold_at?.[Op.between]) { conds.push("s.sold_at BETWEEN :from AND :to"); repl.from = where.sold_at[Op.between][0]; repl.to = where.sold_at[Op.between][1]; }
      else if (where.sold_at?.[Op.gte]) { conds.push("s.sold_at >= :from"); repl.from = where.sold_at[Op.gte]; }
      else if (where.sold_at?.[Op.lte]) { conds.push("s.sold_at <= :to"); repl.to = where.sold_at[Op.lte]; }

      const qBase = String(req.query.q || "").trim();
      if (qBase) {
        conds.push("(s.customer_name LIKE :qLike OR s.sale_number LIKE :qLike OR s.customer_phone LIKE :qLike OR s.customer_doc LIKE :qLike)");
        repl.qLike = `%${qBase}%`;
      }

      const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

      const sql = `
        SELECT
          si.product_id,
          MAX(si.product_name_snapshot) AS name,
          MAX(si.product_sku_snapshot) AS sku,
          MAX(si.product_barcode_snapshot) AS barcode
        FROM ${itemsTable} si
        INNER JOIN ${salesTable} s ON s.id = si.sale_id
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
    const saleRefundsAs = SaleRefund ? findAssocAlias(Sale, SaleRefund) : null;

    const itemWarehouseAs = findAssocAlias(SaleItem, Warehouse);
    const itemProductAs = findAssocAlias(SaleItem, Product);

    const productCategoryAs = findAssocAlias(Product, Category);
    const productImagesAs = findAssocAlias(Product, ProductImage);

    const catParentAs = findAssocAlias(Category, Category);

    const include = [];

    if (Payment && salePaymentsAs) include.push({ model: Payment, as: salePaymentsAs, required: false });
    if (Branch && saleBranchAs) include.push({ model: Branch, as: saleBranchAs, required: false, attributes: pickBranchAttributes() });
    if (User && saleUserAs) include.push({ model: User, as: saleUserAs, required: false, attributes: pickUserAttributes() });

    // ✅ NUEVO: refunds en detalle
    if (SaleRefund && saleRefundsAs) include.push({ model: SaleRefund, as: saleRefundsAs, required: false });

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

        if (ProductImage && productImagesAs) {
          prodInclude.push({ model: ProductImage, as: productImagesAs, required: false });
        }

        itemInclude.push({ model: Product, as: itemProductAs, required: false, include: prodInclude });
      }

      include.push({ model: SaleItem, as: saleItemsAs, required: false, include: itemInclude });
    }

    const order = [];
    if (salePaymentsAs) order.push([{ model: Payment, as: salePaymentsAs }, "id", "ASC"]);
    if (saleItemsAs) order.push([{ model: SaleItem, as: saleItemsAs }, "id", "ASC"]);
    if (SaleRefund && saleRefundsAs) order.push([{ model: SaleRefund, as: saleRefundsAs }, "id", "ASC"]);

    const sale = await Sale.findByPk(id, {
      include,
      order: order.length ? order : undefined,
    });

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
// ============================
async function createSale(req, res, next) {
  const t = await sequelize.transaction();
  try {
    const user_id = getAuthUserId(req);
    if (!user_id) {
      await t.rollback();
      return res.status(401).json({
        ok: false,
        code: "NO_USER",
        message: "No se pudo determinar el usuario autenticado (user_id).",
      });
    }

    const branch_id = getAuthBranchId(req);
    if (!branch_id) {
      await t.rollback();
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const customer_name = String(req.body?.customer_name || "").trim() || null;
    const status = upper(req.body?.status) || "PAID";
    const sold_at = parseDateTime(req.body?.sold_at) || nowDate();

    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    const payments = Array.isArray(req.body?.payments) ? req.body.payments : [];

    if (!items || items.length === 0) {
      await t.rollback();
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "items requerido (array no vacío)",
      });
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
        return res.status(400).json({
          ok: false,
          code: "BAD_REQUEST",
          message: "Item inválido: product_id requerido, quantity>0, unit_price>=0",
        });
      }
      if (!it.warehouse_id) {
        await t.rollback();
        return res.status(400).json({
          ok: false,
          code: "WAREHOUSE_REQUIRED",
          message: "warehouse_id requerido (no vino en item y no se encontró depósito default para esta sucursal).",
        });
      }

      const wh = await Warehouse.findByPk(it.warehouse_id, { transaction: t });
      if (!wh) {
        await t.rollback();
        return res.status(404).json({ ok: false, code: "WAREHOUSE_NOT_FOUND", message: "Depósito inexistente." });
      }
      if (toInt(wh.branch_id, 0) !== toInt(branch_id, 0)) {
        await t.rollback();
        return res.status(403).json({
          ok: false,
          code: "CROSS_BRANCH_WAREHOUSE",
          message: "El depósito no pertenece a la sucursal del usuario.",
        });
      }
    }

    if (Product?.rawAttributes?.branch_id) {
      const ids = [...new Set(normItems.map((x) => x.product_id))];
      const prods = await Product.findAll({
        where: { id: ids },
        attributes: ["id", "branch_id"],
        transaction: t,
      });

      const map = new Map(prods.map((p) => [toInt(p.id, 0), toInt(p.branch_id, 0)]));
      for (const it of normItems) {
        const pb = map.get(toInt(it.product_id, 0));
        if (!pb) {
          await t.rollback();
          return res.status(400).json({
            ok: false,
            code: "PRODUCT_NOT_FOUND",
            message: `Producto no existe: product_id=${it.product_id}`,
          });
        }
        if (toInt(pb, 0) !== toInt(branch_id, 0)) {
          await t.rollback();
          return res.status(403).json({
            ok: false,
            code: "CROSS_BRANCH_PRODUCT",
            message: `Producto ${it.product_id} no pertenece a la sucursal del usuario.`,
          });
        }
      }
    }

    const subtotal = normItems.reduce((a, it) => a + it.line_total, 0);
    const discount_total = toFloat(req.body?.discount_total, 0);
    const tax_total = toFloat(req.body?.tax_total, 0);
    const total = Math.max(0, subtotal - discount_total + tax_total);

    const paid_total = payments.reduce((a, p) => a + toFloat(p?.amount, 0), 0);
    const change_total = Math.max(0, paid_total - total);

    const salePayload = {
      branch_id,
      user_id,
      customer_name,
      status,
      sold_at,
      subtotal,
      discount_total,
      tax_total,
      total,
      paid_total,
      change_total,
    };

    if (typeof req.body?.sale_number === "string" && req.body.sale_number.trim()) {
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
          paid_at: parseDateTime(p?.paid_at) || sold_at,
        })),
        { transaction: t }
      );
    }

    await t.commit();

    const payAs = findAssocAlias(Sale, Payment);
    const created = await Sale.findByPk(sale.id, {
      include: payAs ? [{ model: Payment, as: payAs, required: false }] : [],
    });

    return res.status(201).json({ ok: true, message: "Venta creada", data: created });
  } catch (e) {
    try { await t.rollback(); } catch {}
    next(e);
  }
}

// ============================
// POST /api/v1/pos/sales/:id/refunds
// ✅ Registra devolución (solo ADMIN)
// ============================
async function createRefund(req, res, next) {
  const t = await sequelize.transaction();
  try {
    if (!SaleRefund) {
      await t.rollback();
      return res.status(500).json({
        ok: false,
        code: "REFUNDS_MODEL_MISSING",
        message: "SaleRefund no está definido. Creá el modelo/tabla sale_refunds.",
      });
    }

    const admin = isAdminReq(req);
    if (!admin) {
      await t.rollback();
      return res.status(403).json({
        ok: false,
        code: "ADMIN_ONLY",
        message: "Solo administrador puede registrar devoluciones.",
      });
    }

    const id = toInt(req.params.id, 0);
    if (!id) {
      await t.rollback();
      return res.status(400).json({ ok: false, message: "ID inválido" });
    }

    const amount = toFloat(req.body?.amount, NaN);
    const reason = String(req.body?.reason || "").trim() || null;
    const restock = !!req.body?.restock;

    if (!Number.isFinite(amount) || amount <= 0) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "BAD_AMOUNT", message: "Monto inválido" });
    }

    const sale = await Sale.findByPk(id, { transaction: t });
    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, message: "Venta no encontrada" });
    }

    // si querés también evitar cross-branch incluso siendo admin, descomentá:
    // const requestedBranch = toInt(req.query.branch_id ?? req.query.branchId, 0);
    // if (requestedBranch > 0 && toInt(sale.branch_id, 0) !== requestedBranch) ...

    // total ya devuelto
    const refundsTable = getTableName(SaleRefund, "sale_refunds");
    const salesTable = getTableName(Sale, "sales");

    const sql = `
      SELECT COALESCE(SUM(r.amount),0) AS refunded_sum
      FROM ${refundsTable} r
      WHERE r.sale_id = :sale_id
    `;
    const [r] = await sequelize.query(sql, { replacements: { sale_id: id }, transaction: t });
    const refundedSum = Number(r?.[0]?.refunded_sum || 0);

    const paidTotal = Number(sale.paid_total || 0);
    const remaining = Math.max(0, paidTotal - refundedSum);

    if (amount > remaining) {
      await t.rollback();
      return res.status(400).json({
        ok: false,
        code: "AMOUNT_EXCEEDS_REMAINING",
        message: `El monto supera lo disponible para devolver. Disponible: ${remaining}`,
        data: { remaining, paid_total: paidTotal, refunded_sum: refundedSum },
      });
    }

    const user_id = getAuthUserId(req) || null;

    const refund = await SaleRefund.create(
      {
        sale_id: id,
        amount,
        reason,
        restock: restock ? 1 : 0,
        created_by: user_id,
      },
      { transaction: t }
    );

    // ✅ actualizar estado si quedó totalmente devuelta
    const newRefunded = refundedSum + amount;
    const fullyRefunded = newRefunded >= paidTotal - 0.00001;

    if (Sale?.rawAttributes?.status) {
      await sale.update(
        { status: fullyRefunded ? "REFUNDED" : sale.status },
        { transaction: t }
      );
    }

    // 🧠 STOCK: por ahora dejamos registro restock=true para procesarlo.
    // Si ya tenés lógica de stock/movimientos, acá es donde se ejecuta.
    // (no la implemento a ciegas para no romper tu inventario)

    await t.commit();

    // devolver resumen útil
    return res.status(201).json({
      ok: true,
      message: "Devolución registrada",
      data: {
        refund,
        sale_id: id,
        refunded_sum: newRefunded,
        remaining: Math.max(0, paidTotal - newRefunded),
        status: fullyRefunded ? "REFUNDED" : sale.status,
      },
    });
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
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
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
      return res.status(403).json({
        ok: false,
        code: "CROSS_BRANCH_SALE",
        message: "No podés eliminar una venta de otra sucursal.",
      });
    }

    // ✅ si hay devoluciones, también se limpian (si existe modelo)
    if (SaleRefund) await SaleRefund.destroy({ where: { sale_id: id }, transaction: t });

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

  // ✅ NUEVO
  createRefund,
};
