// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/posSales.controller.js
// ✅ ROBUSTO + DB MATCH
//
// FIX IMPORTANTE AHORA:
// ✅ filtro producto acepta SIEMPRE:
//    - product
//    - product_id
//    - productId
// ✅ mismo criterio en:
//    - GET /pos/sales
//    - GET /pos/sales/stats
//
// NOTA: sale_refunds es VIEW => SOLO LECTURA

const { Op, literal } = require("sequelize");
const {
  sequelize,
  Sale,
  Payment,
  SaleItem,
  Product,
  Warehouse,
  Branch,
  User,
  SaleRefund,
  SaleExchange,
  StockBalance,
} = require("../models");
const access = require("../utils/accessScope");

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

const PAYMENTS_ATTRS_FULL = [
  "id",
  "sale_id",
  "method",
  "amount",
  "reference",
  "installments",
  "note",
  "paid_at",
  "created_at",
  "updated_at",
];

function normalizePayMethod(v) {
  const x = String(v || "").trim().toUpperCase();
  if (!x) return "";

  if (x === "EFECTIVO") return "CASH";
  if (x === "TRANSFERENCIA") return "TRANSFER";
  if (x === "TARJETA") return "CARD";
  if (x === "OTRO" || x === "OTROS") return "OTHER";

  if (x === "MP" || x === "MERCADO PAGO" || x === "MERCADO_PAGO") return "MERCADOPAGO";

  if (
    x === "SJCREDIT" ||
    x === "SJ_CREDIT" ||
    x === "SANJUANCREDITO" ||
    x === "CRÉDITO SAN JUAN" ||
    x === "CREDITO SAN JUAN"
  ) {
    return "CREDIT_SJT";
  }

  if (x === "DEBIT" || x === "CREDIT") return "CARD";

  return x;
}

function allowedSalePayMethodsSet() {
  return new Set(["CASH", "TRANSFER", "CARD", "QR", "MERCADOPAGO", "CREDIT_SJT", "OTHER"]);
}
function allowedRefundPayMethodsSet() {
  return new Set(["CASH", "TRANSFER", "CARD", "QR", "MERCADOPAGO", "CREDIT_SJT", "OTHER"]);
}

function normalizeCardMappedMethod(v) {
  const m = normalizePayMethod(v);
  if (!m) return "CASH";
  if (m === "DEBIT" || m === "CREDIT") return "CARD";
  const allowed = allowedSalePayMethodsSet();
  return allowed.has(m) ? m : "OTHER";
}
function normalizeRefundMethod(v) {
  const m = normalizePayMethod(v);
  if (!m) return "CASH";
  if (m === "DEBIT" || m === "CREDIT") return "CARD";
  const allowed = allowedRefundPayMethodsSet();
  return allowed.has(m) ? m : "OTHER";
}

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
    req?.usuario?.id,
    req?.usuario?.userId,
    req?.usuario?.user_id,
  ];

  for (const v of candidates) {
    const n = toInt(v, 0);
    if (n > 0) return n;
  }

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

function getAuthBranchId(req) {
  return (
    toInt(req?.ctx?.branchId, 0) ||
    toInt(req?.ctx?.branch_id, 0) ||
    toInt(req?.user?.branch_id, 0) ||
    toInt(req?.user?.branchId, 0) ||
    toInt(req?.auth?.branch_id, 0) ||
    toInt(req?.auth?.branchId, 0) ||
    toInt(req?.usuario?.branch_id, 0) ||
    toInt(req?.usuario?.branchId, 0) ||
    toInt(req?.branch?.id, 0) ||
    toInt(req?.branchId, 0) ||
    toInt(req?.branchContext?.branch_id, 0) ||
    toInt(req?.branchContext?.id, 0) ||
    0
  );
}

// `isAdminReq` se redirige a `access.isSuperAdmin` para que las decisiones
// de data-scope dejen de tratar al admin de sucursal como global.
// Para gating de acciones (ej: "puede ver detalle / hacer refund / anular")
// existen ahora `canPostSale` (dueño o admin) y los handlers individuales
// hacen sus propios chequeos cross-branch / cross-user.
function isAdminReq(req) {
  return access.isSuperAdmin(req);
}

function canPostSale(req, sale) {
  // Super_admin: siempre. Branch admin: si la venta es de su sucursal.
  // Otros (cajero): solo si la venta es propia.
  if (access.isSuperAdmin(req)) return true;

  const ctxBranchId = getAuthBranchId(req);
  if (parseInt(sale?.branch_id, 10) !== parseInt(ctxBranchId, 10)) return false;

  if (access.isBranchAdmin(req)) return true;

  const uid = getAuthUserId(req);
  if (!uid) return false;
  return toInt(sale?.user_id, 0) === toInt(uid, 0);
}

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

/* ============================================================
   ✅ NUEVO: leer product/product_id/productId siempre
============================================================ */
function readProductFilter(req) {
  const raw =
    req?.query?.product_id ??
    req?.query?.productId ??
    req?.query?.product ??
    "";

  return String(raw || "").trim();
}

function buildWhereFromQuery(req) {
  // SCOPE EFECTIVO
  //  - super_admin: ve ventas de todas las sucursales (puede acotar con ?branch_id=)
  //  - branch admin: ve ventas de su sucursal activa (no puede salirse)
  //  - cajero: solo SUS ventas (user_id = ctxUserId), forzado a su sucursal
  const superAdmin  = access.isSuperAdmin(req);
  const branchAdmin = access.isBranchAdmin(req); // incluye super_admin
  const isCajero    = !branchAdmin;
  const ctxUserId   = access.getUserId(req);

  const q = String(req.query.q || "").trim();
  const status = String(req.query.status || "").trim().toUpperCase();

  const from = parseDateTime(req.query.from);
  const to = parseDateTime(req.query.to);

  const where = {};

  if (superAdmin) {
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

  // Filtro de vendedor:
  //  - cajero: forzado a sus ventas (ignora ?seller_id=).
  //  - admin / super_admin: opcional via query.
  if (isCajero) {
    if (!ctxUserId) {
      return {
        ok: false,
        code: "AUTH_REQUIRED",
        message: "No se pudo determinar el usuario autenticado.",
      };
    }
    where.user_id = ctxUserId;
  } else {
    const seller_id = toInt(req.query.seller_id ?? req.query.user_id ?? req.query.sellerId ?? req.query.seller, 0);
    if (seller_id > 0) where.user_id = seller_id;
  }

  const customer = req.query.customer;
  if (customer != null && String(customer).trim()) {
    const cStr = String(customer).trim();
    const cNum = toInt(cStr, 0);

    if (cNum > 0 && Sale?.rawAttributes?.customer_id) {
      where.customer_id = cNum;
    } else {
      where[Op.and] = (where[Op.and] || []).concat([
        {
          [Op.or]: [
            { customer_name: { [Op.like]: `%${cStr}%` } },
            { customer_doc: { [Op.like]: `%${cStr}%` } },
            { customer_phone: { [Op.like]: `%${cStr}%` } },
          ],
        },
      ]);
    }
  }

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

function injectExistsFiltersIntoWhere(where, req) {
  const pay_method = normalizePayMethod(req.query.pay_method || req.query.method || "");
  const product = readProductFilter(req);

  const payTable = getTableName(Payment, "payments");
  const itemsTable = getTableName(SaleItem, "sale_items");

  const ands = [];

  if (pay_method) {
    ands.push(
      literal(`EXISTS (
        SELECT 1 FROM ${payTable} p2
        WHERE p2.sale_id = Sale.id AND UPPER(p2.method) = ${sequelize.escape(pay_method)}
      )`)
    );
  }

  if (product) {
    const pNum = toInt(product, 0);
    if (pNum > 0) {
      ands.push(
        literal(`EXISTS (
          SELECT 1 FROM ${itemsTable} si2
          WHERE si2.sale_id = Sale.id AND si2.product_id = ${sequelize.escape(pNum)}
        )`)
      );
    } else {
      const like = `%${product}%`;
      ands.push(
        literal(`EXISTS (
          SELECT 1 FROM ${itemsTable} si2
          WHERE si2.sale_id = Sale.id AND (
            si2.product_name_snapshot LIKE ${sequelize.escape(like)} OR
            si2.product_sku_snapshot LIKE ${sequelize.escape(like)} OR
            si2.product_barcode_snapshot LIKE ${sequelize.escape(like)}
          )
        )`)
      );
    }
  }

  if (ands.length) where[Op.and] = (where[Op.and] || []).concat(ands);
}

// ============================
// GET /api/v1/pos/sales
// ============================
async function listSales(req, res, next) {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const base = buildWhereFromQuery(req);
    if (!base.ok) return res.status(400).json({ ok: false, code: base.code, message: base.message });

    const where = base.where;
    injectExistsFiltersIntoWhere(where, req);

    const include = [];
    const saleBranchAs = findAssocAlias(Sale, Branch);
    const saleUserAs = findAssocAlias(Sale, User);
    const salePaymentsAs = findAssocAlias(Sale, Payment);
    const saleItemsAs = findAssocAlias(Sale, SaleItem);

    if (Branch && saleBranchAs) {
      include.push({
        model: Branch,
        as: saleBranchAs,
        required: false,
        attributes: pickBranchAttributes(),
      });
    }

    if (User && saleUserAs) {
      include.push({
        model: User,
        as: saleUserAs,
        required: false,
        attributes: pickUserAttributes(),
      });
    }

    if (Payment && salePaymentsAs) {
      include.push({
        model: Payment,
        as: salePaymentsAs,
        required: false,
        separate: true,
        order: [["id", "ASC"]],
        attributes: PAYMENTS_ATTRS_FULL,
      });
    }

    if (SaleItem && saleItemsAs) {
      include.push({
        model: SaleItem,
        as: saleItemsAs,
        required: false,
        separate: true,
        order: [["id", "ASC"]],
        attributes: [
          "id",
          "product_id",
          "warehouse_id",
          "quantity",
          "unit_price",
          "line_total",
          "product_name_snapshot",
          "product_sku_snapshot",
          "product_barcode_snapshot",
        ],
      });
    }

    const total = await Sale.count({ where });

    const rows = await Sale.findAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
      include,
      subQuery: false,
    });

    const pages = Math.max(1, Math.ceil(total / limit));
    return res.json({ ok: true, data: rows, meta: { page, limit, total, pages } });
  } catch (e) {
    console.error("[POS SALES] listSales error:", e?.message || e);
    next(e);
  }
}

async function statsSales(req, res, next) {
  try {
    const base = buildWhereFromQuery(req);
    if (!base.ok) return res.status(400).json({ ok: false, code: base.code, message: base.message });

    const where = base.where;

    const salesTable = getTableName(Sale, "sales");
    const payTable = getTableName(Payment, "payments");
    const refundsTable = getTableName(SaleRefund, "sale_refunds");
    const itemsTable = getTableName(SaleItem, "sale_items");

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
      repl.qLike = `%${q}%`;
      conds.push(
        "(s.customer_name LIKE :qLike OR s.sale_number LIKE :qLike OR s.customer_phone LIKE :qLike OR s.customer_doc LIKE :qLike)"
      );
    }

    const seller_id = toInt(req.query.seller_id ?? req.query.user_id ?? req.query.sellerId ?? req.query.seller, 0);
    if (seller_id > 0) {
      conds.push("s.user_id = :seller_id");
      repl.seller_id = seller_id;
    }

    const customer = req.query.customer;
    if (customer != null && String(customer).trim()) {
      const cStr = String(customer).trim();
      repl.cLike = `%${cStr}%`;
      conds.push("(s.customer_name LIKE :cLike OR s.customer_doc LIKE :cLike OR s.customer_phone LIKE :cLike)");
    }

    const pay_method = normalizePayMethod(req.query.pay_method || req.query.method || "");
    if (pay_method) {
      repl.pay_method = pay_method;
      conds.push(`EXISTS (SELECT 1 FROM ${payTable} p2 WHERE p2.sale_id = s.id AND UPPER(p2.method) = :pay_method)`);
    }

    const product = readProductFilter(req);
    if (product) {
      const pNum = toInt(product, 0);
      if (pNum > 0) {
        conds.push(`EXISTS (SELECT 1 FROM ${itemsTable} si2 WHERE si2.sale_id = s.id AND si2.product_id = :product_id)`);
        repl.product_id = pNum;
      } else {
        conds.push(`EXISTS (
          SELECT 1 FROM ${itemsTable} si2
          WHERE si2.sale_id = s.id AND (
            si2.product_name_snapshot LIKE :pLike OR
            si2.product_sku_snapshot LIKE :pLike OR
            si2.product_barcode_snapshot LIKE :pLike
          )
        )`);
        repl.pLike = `%${product}%`;
      }
    }

    const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const refundsJoin = `
      LEFT JOIN (
        SELECT r.sale_id, COALESCE(SUM(r.amount),0) AS refunds_sum
        FROM ${refundsTable} r
        GROUP BY r.sale_id
      ) rr ON rr.sale_id = s.id
    `;

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

    const sqlRefundsByMethod = `
      SELECT
        COALESCE(UPPER(r.refund_method), 'OTHER') AS method,
        COALESCE(SUM(r.amount),0) AS amount_sum
      FROM ${refundsTable} r
      INNER JOIN ${salesTable} s ON s.id = r.sale_id
      ${whereSql}
      GROUP BY COALESCE(UPPER(r.refund_method), 'OTHER')
      ORDER BY COALESCE(UPPER(r.refund_method), 'OTHER') ASC
    `;

    const [rowsTotals] = await sequelize.query(sqlTotals, { replacements: repl });
    const [rowsPay] = await sequelize.query(sqlPayments, { replacements: repl });
    const [rowsRefundsMeth] = await sequelize.query(sqlRefundsByMethod, { replacements: repl });

    const t = rowsTotals?.[0] || {};

    const paymentsByMethod = {};
    for (const r of rowsPay || []) {
      const k = String(r.method || "").trim().toUpperCase() || "OTHER";
      paymentsByMethod[k] = Number(r.amount_sum || 0);
    }

    const refundsByMethod = {};
    for (const r of rowsRefundsMeth || []) {
      const k = String(r.method || "").trim().toUpperCase() || "OTHER";
      refundsByMethod[k] = Number(r.amount_sum || 0);
    }

    const allKeys = new Set([
      ...Object.keys(paymentsByMethod),
      ...Object.keys(refundsByMethod),
      "CASH",
      "TRANSFER",
      "CARD",
      "QR",
      "MERCADOPAGO",
      "CREDIT_SJT",
      "OTHER",
    ]);

    const netByMethod = {};
    for (const k of allKeys) {
      const p = Number(paymentsByMethod[k] || 0);
      const r = Number(refundsByMethod[k] || 0);
      netByMethod[k] = Number((p - r).toFixed(2));
    }

    return res.json({
      ok: true,
      data: {
        sales_count: toInt(t.sales_count, 0),
        total_sum: Number(t.total_sum || 0),
        paid_sum: Number(t.paid_sum || 0),
        refunds_sum: Number(t.refunds_sum || 0),
        gross_total_sum: Number(t.gross_total_sum || 0),
        gross_paid_sum: Number(t.gross_paid_sum || 0),

        payments_by_method: {
          cash: paymentsByMethod.CASH || 0,
          transfer: paymentsByMethod.TRANSFER || 0,
          card: paymentsByMethod.CARD || 0,
          qr: paymentsByMethod.QR || 0,
          mercadopago: paymentsByMethod.MERCADOPAGO || 0,
          credit_sjt: paymentsByMethod.CREDIT_SJT || 0,
          other: paymentsByMethod.OTHER || 0,
          raw_by_method: paymentsByMethod,
        },

        refunds_by_method: {
          cash: refundsByMethod.CASH || 0,
          transfer: refundsByMethod.TRANSFER || 0,
          card: refundsByMethod.CARD || 0,
          qr: refundsByMethod.QR || 0,
          mercadopago: refundsByMethod.MERCADOPAGO || 0,
          credit_sjt: refundsByMethod.CREDIT_SJT || 0,
          other: refundsByMethod.OTHER || 0,
          raw_by_method: refundsByMethod,
        },

        net_by_method: {
          cash: netByMethod.CASH || 0,
          transfer: netByMethod.TRANSFER || 0,
          card: netByMethod.CARD || 0,
          qr: netByMethod.QR || 0,
          mercadopago: netByMethod.MERCADOPAGO || 0,
          credit_sjt: netByMethod.CREDIT_SJT || 0,
          other: netByMethod.OTHER || 0,
          raw_by_method: netByMethod,
        },
      },
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
    // Para acceso al detalle:
    //  - super_admin: cualquier venta.
    //  - branch admin: solo ventas de su sucursal.
    //  - cajero: solo SUS ventas.
    const superAdmin  = access.isSuperAdmin(req);
    const branchAdmin = access.isBranchAdmin(req);
    const isCajero    = !branchAdmin;
    // `admin` legado se usa más abajo solo para gating de la verificación cross-branch.
    const admin = superAdmin;

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const salePaymentsAs = findAssocAlias(Sale, Payment);
    const saleItemsAs = findAssocAlias(Sale, SaleItem);
    const saleBranchAs = findAssocAlias(Sale, Branch);
    const saleUserAs = findAssocAlias(Sale, User);

    const include = [];
    if (Branch && saleBranchAs)
      include.push({ model: Branch, as: saleBranchAs, required: false, attributes: pickBranchAttributes() });
    if (User && saleUserAs)
      include.push({ model: User, as: saleUserAs, required: false, attributes: pickUserAttributes() });
    if (SaleItem && saleItemsAs) include.push({ model: SaleItem, as: saleItemsAs, required: false });

    if (Payment && salePaymentsAs)
      include.push({
        model: Payment,
        as: salePaymentsAs,
        required: false,
        attributes: PAYMENTS_ATTRS_FULL,
      });

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

      // Cajero: además, debe ser DUEÑO de la venta.
      if (isCajero) {
        const ctxUserId = access.getUserId(req);
        if (toInt(sale.user_id, 0) !== toInt(ctxUserId, 0)) {
          return res.status(403).json({
            ok: false,
            code: "FORBIDDEN_USER",
            message: "Solo podés ver tus propias ventas.",
          });
        }
      }
    }

    let refunds = [];
    if (SaleRefund) {
      refunds = await SaleRefund.findAll({ where: { sale_id: id }, order: [["created_at", "DESC"]] });
    }

    let exchanges = [];
    if (SaleExchange) {
      exchanges = await SaleExchange.findAll({
        where: { [Op.or]: [{ original_sale_id: id }, { new_sale_id: id }] },
        order: [["created_at", "DESC"]],
      });
    }

    return res.json({ ok: true, data: { sale, refunds, exchanges } });
  } catch (e) {
    next(e);
  }
}

async function listRefundsBySale(req, res, next) {
  try {
    const sale_id = toInt(req.params.id, 0);
    if (!sale_id) return res.status(400).json({ ok: false, code: "BAD_SALE_ID", message: "sale_id inválido" });

    const sale = await Sale.findByPk(sale_id);
    if (!sale) return res.status(404).json({ ok: false, code: "SALE_NOT_FOUND", message: "Venta no encontrada" });

    if (!isAdminReq(req)) {
      const branch_id = getAuthBranchId(req);
      if (!branch_id)
        return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED", message: "No se pudo determinar la sucursal." });
      if (toInt(sale.branch_id, 0) !== toInt(branch_id, 0)) {
        return res
          .status(403)
          .json({ ok: false, code: "CROSS_BRANCH_SALE", message: "No podés ver devoluciones de otra sucursal." });
      }
      // Cajero: solo sobre sus propias ventas.
      if (!access.isBranchAdmin(req)) {
        const ctxUserId = access.getUserId(req);
        if (toInt(sale.user_id, 0) !== toInt(ctxUserId, 0)) {
          return res.status(403).json({
            ok: false,
            code: "FORBIDDEN_USER",
            message: "Solo podés ver devoluciones de tus propias ventas.",
          });
        }
      }
    }

    const data = SaleRefund ? await SaleRefund.findAll({ where: { sale_id }, order: [["created_at", "DESC"]] }) : [];
    return res.json({ ok: true, data });
  } catch (e) {
    next(e);
  }
}

async function listExchangesBySale(req, res, next) {
  try {
    const sale_id = toInt(req.params.id, 0);
    if (!sale_id) return res.status(400).json({ ok: false, code: "BAD_SALE_ID", message: "sale_id inválido" });

    const sale = await Sale.findByPk(sale_id);
    if (!sale) return res.status(404).json({ ok: false, code: "SALE_NOT_FOUND", message: "Venta no encontrada" });

    if (!isAdminReq(req)) {
      const branch_id = getAuthBranchId(req);
      if (!branch_id)
        return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED", message: "No se pudo determinar la sucursal." });
      if (toInt(sale.branch_id, 0) !== toInt(branch_id, 0)) {
        return res
          .status(403)
          .json({ ok: false, code: "CROSS_BRANCH_SALE", message: "No podés ver cambios de otra sucursal." });
      }
      // Cajero: solo sobre sus propias ventas.
      if (!access.isBranchAdmin(req)) {
        const ctxUserId = access.getUserId(req);
        if (toInt(sale.user_id, 0) !== toInt(ctxUserId, 0)) {
          return res.status(403).json({
            ok: false,
            code: "FORBIDDEN_USER",
            message: "Solo podés ver cambios de tus propias ventas.",
          });
        }
      }
    }

    const data = SaleExchange
      ? await SaleExchange.findAll({
          where: { [Op.or]: [{ original_sale_id: sale_id }, { new_sale_id: sale_id }] },
          order: [["created_at", "DESC"]],
        })
      : [];

    return res.json({ ok: true, data });
  } catch (e) {
    next(e);
  }
}

function safeJsonParse(s) {
  try {
    const x = JSON.parse(String(s || ""));
    return x && typeof x === "object" ? x : null;
  } catch {
    return null;
  }
}
function mergeNote(existingNote, metaObj) {
  const prev = safeJsonParse(existingNote) || {};
  const merged = { ...prev, ...metaObj };
  let out = "";
  try {
    out = JSON.stringify(merged);
  } catch {
    out = JSON.stringify(metaObj);
  }
  if (out.length > 800) out = out.slice(0, 800);
  return out;
}

async function tryQuery(sql, options) {
  try {
    return await sequelize.query(sql, options);
  } catch (e) {
    e.__sql = sql;
    throw e;
  }
}

async function tryInsertMany(sqlList, optionsBase) {
  let lastErr = null;
  for (const sql of sqlList) {
    try {
      const res = await tryQuery(sql, optionsBase);
      return { ok: true, res, sql };
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, err: lastErr };
}

async function insertSaleReturn({ sale_id, amount, restock, reason, note, created_by, transaction }) {
  const sqls = [
    `INSERT INTO sale_returns (sale_id, amount, restock, reason, note, created_by, created_at)
     VALUES (:sale_id, :amount, :restock, :reason, :note, :created_by, NOW())`,
    `INSERT INTO sale_returns (sale_id, amount, restock, reason, created_by, created_at)
     VALUES (:sale_id, :amount, :restock, :reason, :created_by, NOW())`,
    `INSERT INTO sale_returns (sale_id, amount, restock, created_at)
     VALUES (:sale_id, :amount, :restock, NOW())`,
  ];

  const out = await tryInsertMany(sqls, {
    replacements: { sale_id, amount, restock, reason, note, created_by },
    transaction,
  });

  if (!out.ok) throw out.err;

  const ins = out.res?.[0];
  return toInt(ins?.insertId, 0);
}

async function insertSaleReturnPayment({ return_id, method, amount, reference, note, transaction }) {
  const sqls = [
    `INSERT INTO sale_return_payments (return_id, method, amount, reference, note, created_at)
     VALUES (:return_id, :method, :amount, :reference, :note, NOW())`,
    `INSERT INTO sale_return_payments (return_id, method, amount, reference, note, createdAt)
     VALUES (:return_id, :method, :amount, :reference, :note, NOW())`,
  ];

  const out = await tryInsertMany(sqls, {
    replacements: { return_id, method, amount, reference, note },
    transaction,
  });

  if (!out.ok) throw out.err;
  return true;
}

async function insertSaleReturnItem({
  return_id,
  sale_item_id,
  product_id,
  warehouse_id,
  qty,
  unit_price,
  line_total,
  transaction,
}) {
  const sqls = [
    `INSERT INTO sale_return_items (return_id, sale_item_id, product_id, warehouse_id, qty, unit_price, line_total, created_at)
     VALUES (:return_id, :sale_item_id, :product_id, :warehouse_id, :qty, :unit_price, :line_total, NOW())`,
    `INSERT INTO sale_return_items (return_id, product_id, warehouse_id, qty, unit_price, line_total, created_at)
     VALUES (:return_id, :product_id, :warehouse_id, :qty, :unit_price, :line_total, NOW())`,
  ];

  const out = await tryInsertMany(sqls, {
    replacements: { return_id, sale_item_id, product_id, warehouse_id, qty, unit_price, line_total },
    transaction,
  });

  if (!out.ok) throw out.err;
  return true;
}

async function insertSaleExchange({
  original_sale_id,
  return_id,
  new_sale_id,
  original_total,
  returned_amount,
  new_total,
  diff,
  note,
  created_by,
  transaction,
}) {
  const sqls = [
    `INSERT INTO sale_exchanges
      (original_sale_id, return_id, new_sale_id, original_total, returned_amount, new_total, diff, note, created_by, created_at)
     VALUES
      (:original_sale_id, :return_id, :new_sale_id, :original_total, :returned_amount, :new_total, :diff, :note, :created_by, NOW())`,
    `INSERT INTO sale_exchanges
      (original_sale_id, return_id, new_sale_id, original_total, returned_amount, new_total, diff, created_at)
     VALUES
      (:original_sale_id, :return_id, :new_sale_id, :original_total, :returned_amount, :new_total, :diff, NOW())`,
  ];

  const out = await tryInsertMany(sqls, {
    replacements: {
      original_sale_id,
      return_id,
      new_sale_id,
      original_total,
      returned_amount,
      new_total,
      diff,
      note,
      created_by,
    },
    transaction,
  });

  if (!out.ok) throw out.err;
  return true;
}

async function createRefund(req, res) {
  const t = await sequelize.transaction();
  try {
    const sale_id = toInt(req.params.id, 0);
    if (!sale_id) {
      await t.rollback();
      return res.status(400).json({ ok: false, message: "ID inválido" });
    }

    const sale = await Sale.findByPk(sale_id, { transaction: t });
    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, message: "Venta no encontrada" });
    }

    if (!canPostSale(req, sale)) {
      await t.rollback();
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "No tenés permisos para registrar devoluciones de esta venta.",
      });
    }

    const amount = toFloat(req.body?.amount, NaN);
    if (!Number.isFinite(amount) || amount <= 0) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "BAD_AMOUNT", message: "Monto inválido" });
    }

    const requestedMethod = normalizeRefundMethod(req.body?.method || req.body?.refund_method || "CASH");
    const allowedRefund = allowedRefundPayMethodsSet();
    const methodWanted = allowedRefund.has(requestedMethod) ? requestedMethod : "OTHER";

    const restock = req.body?.restock === false ? 0 : 1;
    const reason = String(req.body?.reason || "").trim() || null;
    const note = String(req.body?.note || "").trim() || null;
    const reference = String(req.body?.reference || "").trim() || null;

    const refundsTable = getTableName(SaleRefund, "sale_refunds");
    const [rf] = await sequelize.query(
      `SELECT COALESCE(SUM(r.amount),0) AS refunded_sum FROM ${refundsTable} r WHERE r.sale_id = :sale_id`,
      { replacements: { sale_id }, transaction: t }
    );
    const refundedSum = Number(rf?.[0]?.refunded_sum || 0);

    const paidTotal = Number(sale.paid_total || 0);
    const remaining = Math.max(0, paidTotal - refundedSum);

    if (amount > remaining + 0.00001) {
      await t.rollback();
      return res.status(400).json({
        ok: false,
        code: "AMOUNT_EXCEEDS_REMAINING",
        message: `El monto supera lo disponible para devolver. Disponible: ${remaining}`,
        data: { remaining, paid_total: paidTotal, refunded_sum: refundedSum },
      });
    }

    const created_by = getAuthUserId(req) || null;

    const return_id = await insertSaleReturn({
      sale_id,
      amount,
      restock,
      reason,
      note,
      created_by,
      transaction: t,
    });

    if (!return_id) {
      await t.rollback();
      return res.status(500).json({
        ok: false,
        code: "RETURN_INSERT_FAILED",
        message: "No se pudo crear sale_returns (return_id vacío)",
      });
    }

    const baseNote = note || null;
    let payMethodToInsert = methodWanted;
    let payNoteToInsert = baseNote;

    try {
      await insertSaleReturnPayment({
        return_id,
        method: payMethodToInsert,
        amount,
        reference,
        note: payNoteToInsert,
        transaction: t,
      });
    } catch (e) {
      payMethodToInsert = "OTHER";
      payNoteToInsert = mergeNote(baseNote, { wanted_method: methodWanted });
      await insertSaleReturnPayment({
        return_id,
        method: payMethodToInsert,
        amount,
        reference,
        note: payNoteToInsert,
        transaction: t,
      });
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length) {
      for (const it of items) {
        const product_id = toInt(it?.product_id, 0);
        const warehouse_id = toInt(it?.warehouse_id, 0);
        const qty = toFloat(it?.qty ?? it?.quantity, 0);
        const unit_price = toFloat(it?.unit_price ?? it?.unitPrice, 0);
        const sale_item_id = toInt(it?.sale_item_id, 0) || null;

        if (!product_id || !warehouse_id || qty <= 0) {
          await t.rollback();
          return res.status(400).json({
            ok: false,
            code: "BAD_RETURN_ITEM",
            message: "Item devolución inválido (product_id, warehouse_id, qty>0)",
          });
        }

        const wh = await Warehouse.findByPk(warehouse_id, { transaction: t });
        if (!wh) {
          await t.rollback();
          return res.status(404).json({ ok: false, code: "WAREHOUSE_NOT_FOUND", message: "Depósito inexistente." });
        }
        if (toInt(wh.branch_id, 0) !== toInt(sale.branch_id, 0)) {
          await t.rollback();
          return res.status(403).json({
            ok: false,
            code: "CROSS_BRANCH_WAREHOUSE",
            message: "Depósito no pertenece a la sucursal de la venta.",
          });
        }

        const line_total = Math.max(0, qty * unit_price);

        await insertSaleReturnItem({
          return_id,
          sale_item_id,
          product_id,
          warehouse_id,
          qty,
          unit_price,
          line_total,
          transaction: t,
        });
      }
    }

    const newRefunded = refundedSum + amount;
    const fullyRefunded = newRefunded >= paidTotal - 0.00001;
    if (fullyRefunded && Sale?.rawAttributes?.status) {
      await sale.update({ status: "REFUNDED" }, { transaction: t });
    }

    await t.commit();

    return res.status(201).json({
      ok: true,
      message: "Devolución registrada",
      data: {
        sale_id,
        return_id,
        amount,
        method: payMethodToInsert,
        wanted_method: methodWanted,
        refunded_sum: newRefunded,
        remaining: Math.max(0, paidTotal - newRefunded),
        status: fullyRefunded ? "REFUNDED" : sale.status,
      },
    });
  } catch (e) {
    try {
      await t.rollback();
    } catch {}
    const msg = String(e?.original?.sqlMessage || e?.parent?.sqlMessage || e?.message || "Error devolución");
    const code = String(e?.original?.code || e?.parent?.code || "REFUND_ERROR");

    console.error("[POS SALES] createRefund error:", msg);

    return res.status(500).json({
      ok: false,
      code,
      message: msg,
    });
  }
}

async function assertStockAvailableOrThrow({ branch_id, items, transaction }) {
  if (!items.length) return;

  const ids = [...new Set(items.map((x) => toInt(x.product_id, 0)).filter(Boolean))];
  const attrs = ["id"];
  if (Product?.rawAttributes?.track_stock) attrs.push("track_stock");
  if (Product?.rawAttributes?.is_active) attrs.push("is_active");
  if (Product?.rawAttributes?.branch_id) attrs.push("branch_id");

  const prods = await Product.findAll({ where: { id: ids }, attributes: attrs, transaction });
  const pMap = new Map(prods.map((p) => [toInt(p.id, 0), p]));

  for (const it of items) {
    const product_id = toInt(it.product_id, 0);
    const qty = toFloat(it.qty ?? it.quantity, 0);
    if (!product_id || qty <= 0) continue;

    const p = pMap.get(product_id);
    if (!p)
      throw Object.assign(new Error(`Producto no existe: ${product_id}`), { status: 400, code: "PRODUCT_NOT_FOUND" });

    if (Product.rawAttributes.branch_id && toInt(p.branch_id, 0) !== toInt(branch_id, 0)) {
      throw Object.assign(new Error(`Producto ${product_id} no pertenece a la sucursal.`), {
        status: 403,
        code: "CROSS_BRANCH_PRODUCT",
      });
    }
    if (Product.rawAttributes.is_active && String(p.is_active) === "0") {
      throw Object.assign(new Error(`Producto ${product_id} está desactivado.`), { status: 409, code: "PRODUCT_INACTIVE" });
    }

    const track = Product.rawAttributes.track_stock ? String(p.track_stock) !== "0" : true;
    if (!track) continue;

    const [rows] = await sequelize.query(
      `SELECT COALESCE(qty,0) AS qty
       FROM v_stock_by_branch_product
       WHERE branch_id = :branch_id AND product_id = :product_id
       LIMIT 1`,
      { replacements: { branch_id, product_id }, transaction }
    );

    const available = Number(rows?.[0]?.qty || 0);
    if (available + 0.00001 < qty) {
      throw Object.assign(
        new Error(`Stock insuficiente para producto ${product_id}. Disponible: ${available}, requerido: ${qty}`),
        { status: 409, code: "NO_STOCK", data: { product_id, available, required: qty } }
      );
    }
  }
}

async function createExchange(req, res) {
  const t = await sequelize.transaction();
  try {
    const original_sale_id = toInt(req.params.id, 0);
    if (!original_sale_id) {
      await t.rollback();
      return res.status(400).json({ ok: false, message: "ID inválido" });
    }

    const originalSale = await Sale.findByPk(original_sale_id, { transaction: t });
    if (!originalSale) {
      await t.rollback();
      return res.status(404).json({ ok: false, message: "Venta original no encontrada" });
    }

    if (!canPostSale(req, originalSale)) {
      await t.rollback();
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "No tenés permisos para registrar cambios de esta venta.",
      });
    }

    const restock = req.body?.restock === false ? 0 : 1;
    const returns = Array.isArray(req.body?.returns) ? req.body.returns : [];
    const takes = Array.isArray(req.body?.takes) ? req.body.takes : [];
    const note = String(req.body?.note || "").trim() || null;
    const reference = String(req.body?.reference || "").trim() || null;

    if (!returns.length) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "RETURNS_REQUIRED", message: "returns requerido (array no vacío)" });
    }
    if (!takes.length) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "TAKES_REQUIRED", message: "takes requerido (array no vacío)" });
    }

    const normReturnItems = returns.map((it) => ({
      sale_item_id: toInt(it?.sale_item_id, 0) || null,
      product_id: toInt(it?.product_id, 0),
      warehouse_id: toInt(it?.warehouse_id, 0),
      qty: toFloat(it?.qty ?? it?.quantity, 0),
      unit_price: toFloat(it?.unit_price ?? it?.unitPrice ?? it?.price, 0),
    }));

    const normTakeItems = takes.map((it) => ({
      product_id: toInt(it?.product_id, 0),
      warehouse_id: toInt(it?.warehouse_id, 0),
      qty: toFloat(it?.qty ?? it?.quantity, 0),
      unit_price: toFloat(it?.unit_price ?? it?.unitPrice ?? it?.price, 0),
    }));

    for (const it of [...normReturnItems, ...normTakeItems]) {
      if (!it.product_id || !it.warehouse_id || it.qty <= 0 || it.unit_price < 0) {
        await t.rollback();
        return res.status(400).json({
          ok: false,
          code: "BAD_ITEM",
          message: "Item inválido (product_id, warehouse_id, qty>0, unit_price>=0)",
        });
      }
      const wh = await Warehouse.findByPk(it.warehouse_id, { transaction: t });
      if (!wh) {
        await t.rollback();
        return res.status(404).json({ ok: false, code: "WAREHOUSE_NOT_FOUND", message: "Depósito inexistente." });
      }
      if (toInt(wh.branch_id, 0) !== toInt(originalSale.branch_id, 0)) {
        await t.rollback();
        return res.status(403).json({
          ok: false,
          code: "CROSS_BRANCH_WAREHOUSE",
          message: "Depósito no pertenece a la sucursal de la venta.",
        });
      }
    }

    await assertStockAvailableOrThrow({
      branch_id: toInt(originalSale.branch_id, 0),
      items: normTakeItems,
      transaction: t,
    });

    const returned_amount = normReturnItems.reduce((a, it) => a + Math.max(0, it.qty * it.unit_price), 0);
    const new_total = normTakeItems.reduce((a, it) => a + Math.max(0, it.qty * it.unit_price), 0);
    const diff = Number((new_total - returned_amount).toFixed(2));

    const requestedMethod = normalizeRefundMethod(req.body?.method || "CASH");
    const allowedRefund = allowedRefundPayMethodsSet();
    const methodWanted = allowedRefund.has(requestedMethod) ? requestedMethod : "OTHER";

    const created_by = getAuthUserId(req) || null;

    const refund_amount = diff < 0 ? Math.abs(diff) : 0;

    const return_id = await insertSaleReturn({
      sale_id: original_sale_id,
      amount: refund_amount,
      restock,
      reason: "Cambio",
      note,
      created_by,
      transaction: t,
    });

    if (!return_id) {
      await t.rollback();
      return res.status(500).json({ ok: false, code: "RETURN_INSERT_FAILED", message: "No se pudo crear sale_returns (cambio)" });
    }

    for (const it of normReturnItems) {
      const line_total = Math.max(0, it.qty * it.unit_price);
      await insertSaleReturnItem({
        return_id,
        sale_item_id: it.sale_item_id,
        product_id: it.product_id,
        warehouse_id: it.warehouse_id,
        qty: it.qty,
        unit_price: it.unit_price,
        line_total,
        transaction: t,
      });
    }

    if (refund_amount > 0) {
      let payMethodToInsert = methodWanted;
      let payNoteToInsert = note || null;

      try {
        await insertSaleReturnPayment({
          return_id,
          method: payMethodToInsert,
          amount: refund_amount,
          reference,
          note: payNoteToInsert,
          transaction: t,
        });
      } catch (e) {
        payMethodToInsert = "OTHER";
        payNoteToInsert = mergeNote(note || null, { wanted_method: methodWanted });
        await insertSaleReturnPayment({
          return_id,
          method: payMethodToInsert,
          amount: refund_amount,
          reference,
          note: payNoteToInsert,
          transaction: t,
        });
      }
    }

    const sold_at = nowDate();
    const status = "PAID";

    const paid_total = diff > 0 ? diff : 0;
    const change_total = 0;

    const newSale = await Sale.create(
      {
        branch_id: originalSale.branch_id,
        user_id: created_by || originalSale.user_id,
        customer_name: originalSale.customer_name || null,
        customer_doc: originalSale.customer_doc || null,
        customer_phone: originalSale.customer_phone || null,
        status,
        sold_at,
        subtotal: new_total,
        discount_total: 0,
        tax_total: 0,
        total: new_total,
        paid_total,
        change_total,
        note: note || "Cambio",
      },
      { transaction: t }
    );

    const takeIds = [...new Set(normTakeItems.map((x) => x.product_id))];
    const prods = await Product.findAll({
      where: { id: takeIds },
      attributes: ["id", "name", "sku", "barcode"],
      transaction: t,
    });
    const pMap = new Map(prods.map((p) => [toInt(p.id, 0), p]));

    await SaleItem.bulkCreate(
      normTakeItems.map((it) => {
        const p = pMap.get(toInt(it.product_id, 0));
        return {
          sale_id: newSale.id,
          product_id: it.product_id,
          warehouse_id: it.warehouse_id,
          quantity: it.qty,
          unit_price: it.unit_price,
          line_total: Math.max(0, it.qty * it.unit_price),
          product_name_snapshot: p?.name || null,
          product_sku_snapshot: p?.sku || null,
          product_barcode_snapshot: p?.barcode || null,
        };
      }),
      { transaction: t }
    );

    if (diff > 0) {
      await Payment.create(
        { sale_id: newSale.id, method: normalizeCardMappedMethod(methodWanted), amount: diff, paid_at: sold_at, reference, note },
        { transaction: t }
      );
    }

    await insertSaleExchange({
      original_sale_id,
      return_id,
      new_sale_id: newSale.id,
      original_total: Number(originalSale.total || 0),
      returned_amount: Number(returned_amount || 0),
      new_total: Number(new_total || 0),
      diff: Number(diff || 0),
      note,
      created_by,
      transaction: t,
    });

    await t.commit();

    return res.status(201).json({
      ok: true,
      message: "Cambio registrado",
      data: {
        original_sale_id,
        return_id,
        new_sale_id: newSale.id,
        returned_amount,
        new_total,
        diff,
        refund_amount,
        method: methodWanted,
      },
    });
  } catch (e) {
    try {
      await t.rollback();
    } catch {}
    const status = e?.status || 500;
    const msg = String(e?.original?.sqlMessage || e?.parent?.sqlMessage || e?.message || "Error cambio");
    const code = String(e?.original?.code || e?.parent?.code || e?.code || "EXCHANGE_ERROR");

    console.error("[POS SALES] createExchange error:", msg);

    return res.status(status).json({
      ok: false,
      code,
      message: msg,
      data: e?.data || null,
    });
  }
}

/**
 * Restaura el stock de los items de la venta sumando qty al warehouse
 * registrado en cada SaleItem (que es donde el createSale lo descontó).
 * Solo restaura productos con `track_stock = true`. Best-effort.
 */
async function restoreStockForSaleItems(items, t) {
  if (!Array.isArray(items) || !items.length) return { restored: 0, skipped: 0 };

  const productIds = [...new Set(items.map((it) => toInt(it.product_id, 0)).filter(Boolean))];
  if (!productIds.length) return { restored: 0, skipped: 0 };

  const products = await Product.findAll({
    where: { id: { [Op.in]: productIds }, track_stock: true },
    attributes: ["id"],
    transaction: t,
  });
  const trackedIds = new Set(products.map((p) => toInt(p.id, 0)));

  let restored = 0;
  let skipped  = 0;

  for (const it of items) {
    const productId   = toInt(it.product_id, 0);
    const warehouseId = toInt(it.warehouse_id, 0);
    const qty         = Number(it.quantity || 0);
    if (!productId || !warehouseId || !qty) { skipped++; continue; }
    if (!trackedIds.has(productId))           { skipped++; continue; }

    try {
      const sb = await StockBalance.findOne({
        where: { warehouse_id: warehouseId, product_id: productId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (sb) {
        await sb.update({ qty: literal(`qty + ${qty}`) }, { transaction: t });
      } else {
        await StockBalance.create(
          { warehouse_id: warehouseId, product_id: productId, qty },
          { transaction: t }
        );
      }
      restored++;
    } catch (e) {
      console.warn("[posSales.restoreStock] item skipped:", { productId, warehouseId, qty, err: e?.message });
      skipped++;
    }
  }

  return { restored, skipped };
}

/**
 * DELETE /pos/sales/:id
 *
 * Comportamiento por defecto: SOFT-CANCEL.
 *   - Marca la venta como status='CANCELLED' (preserva auditoría y arqueo).
 *   - Restaura el stock al warehouse de cada item (revierte el OUT del createSale).
 *   - No toca payments ni items.
 *
 * Con ?force=1: HARD-DELETE (admin override).
 *   - Restaura el stock IGUAL.
 *   - Borra payments, items y la venta. Si hay returns/exchanges, los limpia.
 *
 * Bloqueos:
 *   - Si la venta ya está CANCELLED → 409.
 *   - Si tiene returns y no se manda force → 409.
 *   - Solo admin o usuarios de la misma sucursal de la venta.
 */
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

    const sale = await Sale.findByPk(id, {
      include: [{ model: SaleItem, as: "items", required: false }],
      transaction: t,
    });
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

    // Cajero (no admin de sucursal): solo puede anular SU propia venta.
    if (!admin && !access.isBranchAdmin(req)) {
      const ctxUserId = access.getUserId(req);
      if (toInt(sale.user_id, 0) !== toInt(ctxUserId, 0)) {
        await t.rollback();
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_USER",
          message: "Solo podés anular tus propias ventas.",
        });
      }
    }

    if (String(sale.status) === "CANCELLED") {
      await t.rollback();
      return res.status(409).json({
        ok: false,
        code: "ALREADY_CANCELLED",
        message: "La venta ya está anulada.",
      });
    }

    const forceQuery = String(req.query.force || "0") === "1";
    // Solo admin (super o de sucursal) puede pedir hard-delete con ?force=1.
    const force = forceQuery && access.isBranchAdmin(req);
    if (forceQuery && !force) {
      await t.rollback();
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "Solo administradores pueden forzar el borrado completo de una venta.",
      });
    }
    const restock = String(req.query.restock || "1") !== "0"; // permitir desactivar reposición con ?restock=0

    const [rr] = await sequelize.query(`SELECT COUNT(*) AS c FROM sale_returns WHERE sale_id = :sale_id`, {
      replacements: { sale_id: id },
      transaction: t,
    });
    const returnsCount = toInt(rr?.[0]?.c, 0);

    if (returnsCount > 0 && !force) {
      await t.rollback();
      return res.status(409).json({
        ok: false,
        code: "SALE_HAS_RETURNS",
        message:
          "La venta tiene devoluciones/cambios. No se anula por seguridad. Usá ?force=1 si realmente querés borrar todo.",
        data: { returnsCount },
      });
    }

    // ── Restaurar stock (revierte el OUT del createSale) ────────────────────
    let stockReport = { restored: 0, skipped: 0 };
    if (restock) {
      stockReport = await restoreStockForSaleItems(sale.items || [], t);
    }

    if (!force) {
      // SOFT-CANCEL por defecto: preserva la venta para auditoría y arqueo.
      const cancelledBy = req.user?.id ?? null;
      const note = [
        sale.note,
        `ANULADA por usuario #${cancelledBy} el ${new Date().toISOString()}`,
      ].filter(Boolean).join(" | ");

      await sale.update(
        { status: "CANCELLED", note },
        { transaction: t, fields: ["status", "note"] }
      );

      await t.commit();
      return res.json({
        ok: true,
        message: "Venta anulada. El stock fue restaurado.",
        cancelled_by: cancelledBy,
        stock: stockReport,
      });
    }

    // HARD-DELETE (force=1): se mantiene comportamiento previo, ahora con restock.
    if (returnsCount > 0) {
      await sequelize.query(
        `DELETE FROM sale_exchanges
         WHERE original_sale_id = :sale_id OR new_sale_id = :sale_id OR return_id IN (SELECT id FROM sale_returns WHERE sale_id = :sale_id)`,
        { replacements: { sale_id: id }, transaction: t }
      );
      await sequelize.query(
        `DELETE FROM sale_return_items WHERE return_id IN (SELECT id FROM sale_returns WHERE sale_id = :sale_id)`,
        { replacements: { sale_id: id }, transaction: t }
      );
      await sequelize.query(
        `DELETE FROM sale_return_payments WHERE return_id IN (SELECT id FROM sale_returns WHERE sale_id = :sale_id)`,
        { replacements: { sale_id: id }, transaction: t }
      );
      await sequelize.query(`DELETE FROM sale_returns WHERE sale_id = :sale_id`, {
        replacements: { sale_id: id },
        transaction: t,
      });
    }

    await Payment.destroy({ where: { sale_id: id }, transaction: t });
    await SaleItem.destroy({ where: { sale_id: id }, transaction: t });
    await sale.destroy({ transaction: t });

    await t.commit();
    return res.json({
      ok: true,
      message: "Venta eliminada. El stock fue restaurado.",
      stock: stockReport,
    });
  } catch (e) {
    try {
      await t.rollback();
    } catch {}
    next(e);
  }
}

module.exports = {
  listSales,
  statsSales,
  getSaleById,
  listRefundsBySale,
  listExchangesBySale,
  deleteSale,
  createRefund,
  createExchange,
};