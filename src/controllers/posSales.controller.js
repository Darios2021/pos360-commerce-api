// src/controllers/posSales.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (RESPETA TU BD REAL)
// NOTA: sale_refunds es VIEW => SOLO LECTURA
//
// Incluye:
// - GET /pos/sales (listSales) con filtros robustos SIN duplicar
// - GET /pos/sales/stats (statsSales) neto vs refunds
// - GET /pos/sales/:id (getSaleById) sale + refunds(view) + exchanges
// - POST /pos/sales (createSale)
// - DELETE /pos/sales/:id (deleteSale)
// - POST /pos/sales/:id/refunds (createRefund) ✅ items[] opcional
// - POST /pos/sales/:id/exchanges (createExchange) ✅ cambio completo (return + new sale + diff + stock)

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
  SaleRefund, // VIEW (solo lectura)
  SaleExchange,
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
 * ✅ Normaliza métodos (acepta DEBIT/CREDIT/CARD sin romper)
 */
function normalizePayMethod(v) {
  const x = String(v || "").trim().toUpperCase();
  return x || "";
}
function allowedPayMethodsSet() {
  return new Set(["CASH", "TRANSFER", "DEBIT", "CREDIT", "CARD", "QR", "OTHER"]);
}

/**
 * 🔐 Obtiene user_id desde middleware o JWT (fallback)
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
 * ✅ branch_id desde el usuario/contexto (no del query salvo admin en list/stats)
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
 * ✅ Permiso para post-venta:
 * - admin, o
 * - el mismo user_id (cajero/vendedor) de la venta
 */
function canPostSale(req, sale) {
  if (isAdminReq(req)) return true;
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

/**
 * ✅ Base where: branch/status/from/to/q + seller_id + customer
 */
function buildWhereFromQuery(req) {
  const admin = isAdminReq(req);

  const q = String(req.query.q || "").trim();
  const status = String(req.query.status || "").trim().toUpperCase();

  const from = parseDateTime(req.query.from);
  const to = parseDateTime(req.query.to);

  const where = {};

  // branch
  if (admin) {
    const requested = toInt(req.query.branch_id ?? req.query.branchId, 0);
    if (requested > 0) where.branch_id = requested;
  } else {
    const branch_id = getAuthBranchId(req);
    if (!branch_id) {
      return { ok: false, code: "BRANCH_REQUIRED", message: "No se pudo determinar la sucursal del usuario (branch_id)." };
    }
    where.branch_id = branch_id;
  }

  if (status) where.status = status;

  if (from && to) where.sold_at = { [Op.between]: [from, to] };
  else if (from) where.sold_at = { [Op.gte]: from };
  else if (to) where.sold_at = { [Op.lte]: to };

  // seller
  const seller_id = toInt(req.query.seller_id ?? req.query.user_id ?? req.query.sellerId ?? req.query.seller, 0);
  if (seller_id > 0) where.user_id = seller_id;

  // customer
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

  // q (buscador general)
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
 * ✅ List filters SIN duplicar por joins:
 * - pay_method: EXISTS payments
 * - product: EXISTS sale_items
 */
function injectExistsFiltersIntoWhere(where, req) {
  const pay_method = normalizePayMethod(req.query.pay_method || req.query.method || "");
  const product = String(req.query.product || "").trim();

  const payTable = getTableName(Payment, "payments");
  const itemsTable = getTableName(SaleItem, "sale_items");

  const ands = [];

  if (pay_method) {
    ands.push(
      literal(`EXISTS (
        SELECT 1 FROM ${payTable} p
        WHERE p.sale_id = Sale.id AND UPPER(p.method) = ${sequelize.escape(pay_method)}
      )`)
    );
  }

  if (product) {
    const pNum = toInt(product, 0);
    if (pNum > 0) {
      ands.push(
        literal(`EXISTS (
          SELECT 1 FROM ${itemsTable} si
          WHERE si.sale_id = Sale.id AND si.product_id = ${sequelize.escape(pNum)}
        )`)
      );
    } else {
      const like = `%${product}%`;
      ands.push(
        literal(`EXISTS (
          SELECT 1 FROM ${itemsTable} si
          WHERE si.sale_id = Sale.id AND (
            si.product_name_snapshot LIKE ${sequelize.escape(like)} OR
            si.product_sku_snapshot LIKE ${sequelize.escape(like)} OR
            si.product_barcode_snapshot LIKE ${sequelize.escape(like)}
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
    const salePaymentsAs = findAssocAlias(Sale, Payment); // útil para UI

    if (Branch && saleBranchAs) include.push({ model: Branch, as: saleBranchAs, required: false, attributes: pickBranchAttributes() });
    if (User && saleUserAs) include.push({ model: User, as: saleUserAs, required: false, attributes: pickUserAttributes() });
    if (Payment && salePaymentsAs) include.push({ model: Payment, as: salePaymentsAs, required: false });

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

/**
 * ✅ Stats NETO:
 * - total vendido NETO (SUM(total) - SUM(refunds))
 * - total cobrado NETO (SUM(paid_total) - SUM(refunds))
 */
async function statsSales(req, res, next) {
  try {
    const base = buildWhereFromQuery(req);
    if (!base.ok) return res.status(400).json({ ok: false, code: base.code, message: base.message });

    const where = base.where;
    const salesTable = getTableName(Sale, "sales");
    const payTable = getTableName(Payment, "payments");
    const refundsTable = getTableName(SaleRefund, "sale_refunds"); // VIEW
    const itemsTable = getTableName(SaleItem, "sale_items");

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

    const q = String(req.query.q || "").trim();
    if (q) {
      repl.qLike = `%${q}%`;
      conds.push("(s.customer_name LIKE :qLike OR s.sale_number LIKE :qLike OR s.customer_phone LIKE :qLike OR s.customer_doc LIKE :qLike)");
    }

    const seller_id = toInt(req.query.seller_id ?? req.query.user_id ?? req.query.sellerId ?? req.query.seller, 0);
    if (seller_id > 0) { conds.push("s.user_id = :seller_id"); repl.seller_id = seller_id; }

    const customer = req.query.customer;
    if (customer != null && String(customer).trim()) {
      const cStr = String(customer).trim();
      repl.cLike = `%${cStr}%`;
      conds.push("(s.customer_name LIKE :cLike OR s.customer_doc LIKE :cLike OR s.customer_phone LIKE :cLike)");
    }

    const pay_method = normalizePayMethod(req.query.pay_method || req.query.method || "");
    if (pay_method) {
      conds.push(`EXISTS (SELECT 1 FROM ${payTable} p WHERE p.sale_id = s.id AND UPPER(p.method) = :pay_method)`);
      repl.pay_method = pay_method;
    }

    const product = String(req.query.product || "").trim();
    if (product) {
      const pNum = toInt(product, 0);
      if (pNum > 0) {
        conds.push(`EXISTS (SELECT 1 FROM ${itemsTable} si WHERE si.sale_id = s.id AND si.product_id = :product_id)`);
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

    const [rowsTotals] = await sequelize.query(sqlTotals, { replacements: repl });
    const [rowsPay] = await sequelize.query(sqlPayments, { replacements: repl });

    const t = rowsTotals?.[0] || {};
    const byMethod = {};
    for (const r of rowsPay || []) {
      const k = String(r.method || "").trim().toUpperCase() || "OTHER";
      byMethod[k] = Number(r.amount_sum || 0);
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
        payments: {
          cash: byMethod.CASH || 0,
          transfer: byMethod.TRANSFER || 0,
          debit: byMethod.DEBIT || 0,
          credit: byMethod.CREDIT || 0,
          card: byMethod.CARD || 0,
          qr: byMethod.QR || 0,
          other: byMethod.OTHER || 0,
          raw_by_method: byMethod,
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
    const admin = isAdminReq(req);

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const salePaymentsAs = findAssocAlias(Sale, Payment);
    const saleItemsAs = findAssocAlias(Sale, SaleItem);
    const saleBranchAs = findAssocAlias(Sale, Branch);
    const saleUserAs = findAssocAlias(Sale, User);

    const include = [];
    if (Payment && salePaymentsAs) include.push({ model: Payment, as: salePaymentsAs, required: false });
    if (Branch && saleBranchAs) include.push({ model: Branch, as: saleBranchAs, required: false, attributes: pickBranchAttributes() });
    if (User && saleUserAs) include.push({ model: User, as: saleUserAs, required: false, attributes: pickUserAttributes() });
    if (SaleItem && saleItemsAs) include.push({ model: SaleItem, as: saleItemsAs, required: false });

    const order = [];
    if (salePaymentsAs) order.push([{ model: Payment, as: salePaymentsAs }, "id", "ASC"]);
    if (saleItemsAs) order.push([{ model: SaleItem, as: saleItemsAs }, "id", "ASC"]);

    const sale = await Sale.findByPk(id, { include, order: order.length ? order : undefined });
    if (!sale) return res.status(404).json({ ok: false, message: "Venta no encontrada" });

    if (!admin) {
      const branch_id = getAuthBranchId(req);
      if (!branch_id) {
        return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED", message: "No se pudo determinar la sucursal del usuario (branch_id)." });
      }
      if (toInt(sale.branch_id, 0) !== toInt(branch_id, 0)) {
        return res.status(403).json({ ok: false, code: "CROSS_BRANCH_SALE", message: "No podés ver una venta de otra sucursal." });
      }
    }

    // Refunds desde VIEW
    let refunds = [];
    if (SaleRefund) {
      refunds = await SaleRefund.findAll({ where: { sale_id: id }, order: [["created_at", "DESC"]] });
    }

    // Exchanges (si existe modelo)
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

// ============================
// POST /api/v1/pos/sales
// (createSale base)
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

    const customer_name = String(req.body?.customer_name || "").trim() || null;
    const status = upper(req.body?.status) || "PAID";
    const sold_at = parseDateTime(req.body?.sold_at) || nowDate();

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

      const warehouse_id = toInt(it?.warehouse_id || it?.warehouseId, 0);
      if (!warehouse_id) {
        await t.rollback();
        return res.status(400).json({ ok: false, code: "WAREHOUSE_REQUIRED", message: "warehouse_id requerido en cada item." });
      }

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
    }

    // Branch cross-check de warehouse
    for (const it of normItems) {
      const wh = await Warehouse.findByPk(it.warehouse_id, { transaction: t });
      if (!wh) { await t.rollback(); return res.status(404).json({ ok: false, code: "WAREHOUSE_NOT_FOUND", message: "Depósito inexistente." }); }
      if (toInt(wh.branch_id, 0) !== toInt(branch_id, 0)) {
        await t.rollback();
        return res.status(403).json({ ok: false, code: "CROSS_BRANCH_WAREHOUSE", message: "El depósito no pertenece a la sucursal del usuario." });
      }
    }

    // Branch cross-check de products (si el modelo tiene branch_id)
    if (Product?.rawAttributes?.branch_id) {
      const ids = [...new Set(normItems.map((x) => x.product_id))];
      const prods = await Product.findAll({
        where: { id: ids },
        attributes: ["id", "branch_id", ...(Product.rawAttributes.is_active ? ["is_active"] : [])],
        transaction: t,
      });
      const map = new Map(prods.map((p) => [toInt(p.id, 0), p]));

      for (const it of normItems) {
        const p = map.get(toInt(it.product_id, 0));
        if (!p) { await t.rollback(); return res.status(400).json({ ok: false, code: "PRODUCT_NOT_FOUND", message: `Producto no existe: product_id=${it.product_id}` }); }
        if (toInt(p.branch_id, 0) !== toInt(branch_id, 0)) {
          await t.rollback();
          return res.status(403).json({ ok: false, code: "CROSS_BRANCH_PRODUCT", message: `Producto ${it.product_id} no pertenece a la sucursal del usuario.` });
        }
        if (Product.rawAttributes.is_active && String(p.is_active) === "0") {
          await t.rollback();
          return res.status(409).json({ ok: false, code: "PRODUCT_INACTIVE", message: `Producto ${it.product_id} está desactivado.` });
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

    // snapshots desde Product
    const ids = [...new Set(normItems.map((x) => x.product_id))];
    const prods = await Product.findAll({
      where: { id: ids },
      attributes: ["id", "name", "sku", "barcode"],
      transaction: t,
    });
    const pMap = new Map(prods.map((p) => [toInt(p.id, 0), p]));

    await SaleItem.bulkCreate(
      normItems.map((it) => {
        const p = pMap.get(toInt(it.product_id, 0));
        return {
          sale_id: sale.id,
          product_id: it.product_id,
          warehouse_id: it.warehouse_id,
          quantity: it.quantity,
          unit_price: it.unit_price,
          line_total: it.line_total,
          product_name_snapshot: p?.name || null,
          product_sku_snapshot: p?.sku || null,
          product_barcode_snapshot: p?.barcode || null,
        };
      }),
      { transaction: t }
    );

    if (payments.length) {
      const allowed = allowedPayMethodsSet();
      await Payment.bulkCreate(
        payments.map((p) => {
          const m = normalizePayMethod(p?.method) || "OTHER";
          const method = allowed.has(m) ? m : "OTHER";
          return {
            sale_id: sale.id,
            method,
            amount: toFloat(p?.amount, 0),
            paid_at: parseDateTime(p?.paid_at) || sold_at,
            reference: String(p?.reference || "").trim() || null,
            note: String(p?.note || "").trim() || null,
          };
        }),
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
// POST /api/v1/pos/sales/:id/refunds
// ✅ Devuelve dinero (items[] opcional para stock/auditoría)
//
// Body:
// {
//   amount,
//   refund_method|method,
//   restock,
//   reason,
//   note,
//   reference,
//   items?: [{ sale_item_id?, product_id, warehouse_id, qty, unit_price }]
// }
// ============================
async function createRefund(req, res, next) {
  const t = await sequelize.transaction();
  try {
    const sale_id = toInt(req.params.id, 0);
    if (!sale_id) { await t.rollback(); return res.status(400).json({ ok: false, message: "ID inválido" }); }

    const sale = await Sale.findByPk(sale_id, { transaction: t });
    if (!sale) { await t.rollback(); return res.status(404).json({ ok: false, message: "Venta no encontrada" }); }

    // ✅ permiso: admin o dueño de la venta
    if (!canPostSale(req, sale)) {
      await t.rollback();
      return res.status(403).json({ ok: false, code: "FORBIDDEN", message: "No tenés permisos para registrar devoluciones de esta venta." });
    }

    const amount = toFloat(req.body?.amount, NaN);
    if (!Number.isFinite(amount) || amount <= 0) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "BAD_AMOUNT", message: "Monto inválido" });
    }

    const methodRaw = req.body?.method || req.body?.refund_method || "CASH";
    const method = normalizePayMethod(methodRaw) || "CASH";
    const allowed = allowedPayMethodsSet();
    if (!allowed.has(method)) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "BAD_METHOD", message: `method inválido. Usá: ${Array.from(allowed).join(", ")}` });
    }

    const restock = req.body?.restock === false ? 0 : 1;
    const reason = String(req.body?.reason || "").trim() || null;
    const note = String(req.body?.note || "").trim() || null;
    const reference = String(req.body?.reference || "").trim() || null;

    // total ya devuelto (VIEW)
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

    // 1) sale_returns
    const [insReturn] = await sequelize.query(
      `INSERT INTO sale_returns (sale_id, amount, restock, reason, note, created_by, created_at)
       VALUES (:sale_id, :amount, :restock, :reason, :note, :created_by, NOW())`,
      { replacements: { sale_id, amount, restock, reason, note, created_by }, transaction: t }
    );

    const return_id = toInt(insReturn?.insertId, 0);
    if (!return_id) {
      await t.rollback();
      return res.status(500).json({ ok: false, code: "RETURN_INSERT_FAILED", message: "No se pudo crear sale_returns" });
    }

    // 2) sale_return_payments
    await sequelize.query(
      `INSERT INTO sale_return_payments (return_id, method, amount, reference, note, created_at)
       VALUES (:return_id, :method, :amount, :reference, :pnote, NOW())`,
      { replacements: { return_id, method, amount, reference, pnote: note }, transaction: t }
    );

    // 3) opcional: items devueltos (NO obligatorio)
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
          return res.status(400).json({ ok: false, code: "BAD_RETURN_ITEM", message: "Item devolución inválido (product_id, warehouse_id, qty>0)" });
        }

        const wh = await Warehouse.findByPk(warehouse_id, { transaction: t });
        if (!wh) { await t.rollback(); return res.status(404).json({ ok: false, code: "WAREHOUSE_NOT_FOUND", message: "Depósito inexistente." }); }
        if (toInt(wh.branch_id, 0) !== toInt(sale.branch_id, 0)) {
          await t.rollback();
          return res.status(403).json({ ok: false, code: "CROSS_BRANCH_WAREHOUSE", message: "Depósito no pertenece a la sucursal de la venta." });
        }

        const line_total = Math.max(0, qty * unit_price);

        await sequelize.query(
          `INSERT INTO sale_return_items (return_id, sale_item_id, product_id, warehouse_id, qty, unit_price, line_total, created_at)
           VALUES (:return_id, :sale_item_id, :product_id, :warehouse_id, :qty, :unit_price, :line_total, NOW())`,
          { replacements: { return_id, sale_item_id, product_id, warehouse_id, qty, unit_price, line_total }, transaction: t }
        );
      }
    }

    // 4) status REFUNDED si quedó total
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
        method,
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

/**
 * ✅ Util: stock check vía v_stock_by_branch_product (columna qty)
 * Solo cuando product.track_stock=1 (si existe la columna)
 */
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
    if (!p) throw Object.assign(new Error(`Producto no existe: ${product_id}`), { status: 400, code: "PRODUCT_NOT_FOUND" });

    if (Product.rawAttributes.branch_id && toInt(p.branch_id, 0) !== toInt(branch_id, 0)) {
      throw Object.assign(new Error(`Producto ${product_id} no pertenece a la sucursal.`), { status: 403, code: "CROSS_BRANCH_PRODUCT" });
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

// ============================
// POST /api/v1/pos/sales/:id/exchanges
// ✅ CAMBIO COMPLETO (diff + stock)
// ============================
async function createExchange(req, res) {
  const t = await sequelize.transaction();
  try {
    const original_sale_id = toInt(req.params.id, 0);
    if (!original_sale_id) { await t.rollback(); return res.status(400).json({ ok: false, message: "ID inválido" }); }

    const originalSale = await Sale.findByPk(original_sale_id, { transaction: t });
    if (!originalSale) { await t.rollback(); return res.status(404).json({ ok: false, message: "Venta original no encontrada" }); }

    // ✅ permiso: admin o dueño de la venta
    if (!canPostSale(req, originalSale)) {
      await t.rollback();
      return res.status(403).json({ ok: false, code: "FORBIDDEN", message: "No tenés permisos para registrar cambios de esta venta." });
    }

    const restock = req.body?.restock === false ? 0 : 1;
    const returns = Array.isArray(req.body?.returns) ? req.body.returns : [];
    const takes = Array.isArray(req.body?.takes) ? req.body.takes : [];
    const note = String(req.body?.note || "").trim() || null;
    const reference = String(req.body?.reference || "").trim() || null;

    if (!returns.length) { await t.rollback(); return res.status(400).json({ ok: false, code: "RETURNS_REQUIRED", message: "returns requerido (array no vacío)" }); }
    if (!takes.length) { await t.rollback(); return res.status(400).json({ ok: false, code: "TAKES_REQUIRED", message: "takes requerido (array no vacío)" }); }

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
        return res.status(400).json({ ok: false, code: "BAD_ITEM", message: "Item inválido (product_id, warehouse_id, qty>0, unit_price>=0)" });
      }
      const wh = await Warehouse.findByPk(it.warehouse_id, { transaction: t });
      if (!wh) { await t.rollback(); return res.status(404).json({ ok: false, code: "WAREHOUSE_NOT_FOUND", message: "Depósito inexistente." }); }
      if (toInt(wh.branch_id, 0) !== toInt(originalSale.branch_id, 0)) {
        await t.rollback();
        return res.status(403).json({ ok: false, code: "CROSS_BRANCH_WAREHOUSE", message: "Depósito no pertenece a la sucursal de la venta." });
      }
    }

    // ✅ Chequeo stock para takes
    await assertStockAvailableOrThrow({
      branch_id: toInt(originalSale.branch_id, 0),
      items: normTakeItems,
      transaction: t,
    });

    const returned_amount = normReturnItems.reduce((a, it) => a + Math.max(0, it.qty * it.unit_price), 0);
    const new_total = normTakeItems.reduce((a, it) => a + Math.max(0, it.qty * it.unit_price), 0);

    // diff > 0 => cliente paga
    // diff < 0 => reintegro
    const diff = Number((new_total - returned_amount).toFixed(2));

    const methodRaw = req.body?.method || "CASH";
    const method = normalizePayMethod(methodRaw) || "CASH";
    const allowed = allowedPayMethodsSet();
    if (!allowed.has(method)) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "BAD_METHOD", message: `method inválido. Usá: ${Array.from(allowed).join(", ")}` });
    }

    const created_by = getAuthUserId(req) || null;

    // Reintegro del cambio (solo si diff < 0)
    const refund_amount = diff < 0 ? Math.abs(diff) : 0;

    // 1) sale_returns (auditoría del cambio)
    const [insReturn] = await sequelize.query(
      `INSERT INTO sale_returns (sale_id, amount, restock, reason, note, created_by, created_at)
       VALUES (:sale_id, :amount, :restock, :reason, :note, :created_by, NOW())`,
      {
        replacements: {
          sale_id: original_sale_id,
          amount: refund_amount,
          restock,
          reason: "Cambio",
          note,
          created_by,
        },
        transaction: t,
      }
    );

    const return_id = toInt(insReturn?.insertId, 0);
    if (!return_id) {
      await t.rollback();
      return res.status(500).json({ ok: false, code: "RETURN_INSERT_FAILED", message: "No se pudo crear sale_returns (cambio)" });
    }

    // 2) sale_return_items (lo que vuelve)
    for (const it of normReturnItems) {
      const line_total = Math.max(0, it.qty * it.unit_price);
      await sequelize.query(
        `INSERT INTO sale_return_items (return_id, sale_item_id, product_id, warehouse_id, qty, unit_price, line_total, created_at)
         VALUES (:return_id, :sale_item_id, :product_id, :warehouse_id, :qty, :unit_price, :line_total, NOW())`,
        {
          replacements: {
            return_id,
            sale_item_id: it.sale_item_id,
            product_id: it.product_id,
            warehouse_id: it.warehouse_id,
            qty: it.qty,
            unit_price: it.unit_price,
            line_total,
          },
          transaction: t,
        }
      );
    }

    // 3) sale_return_payments (solo si hay reintegro)
    if (refund_amount > 0) {
      await sequelize.query(
        `INSERT INTO sale_return_payments (return_id, method, amount, reference, note, created_at)
         VALUES (:return_id, :method, :amount, :reference, :note, NOW())`,
        { replacements: { return_id, method, amount: refund_amount, reference, note }, transaction: t }
      );
    }

    // 4) Nueva venta por lo que se lleva
    const sold_at = nowDate();
    const status = "PAID";

    // pagado en la nueva sale = diferencia si diff>0, sino 0
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

    // snapshots desde Product
    const takeIds = [...new Set(normTakeItems.map((x) => x.product_id))];
    const prodAttrs = ["id", "name", "sku", "barcode", ...(Product?.rawAttributes?.is_active ? ["is_active"] : [])];
    const prods = await Product.findAll({ where: { id: takeIds }, attributes: prodAttrs, transaction: t });
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

    // 5) Si diff>0 => payment en nueva sale
    if (diff > 0) {
      await Payment.create(
        { sale_id: newSale.id, method, amount: diff, paid_at: sold_at, reference, note },
        { transaction: t }
      );
    }

    // 6) sale_exchanges (tabla)
    await sequelize.query(
      `INSERT INTO sale_exchanges
        (original_sale_id, return_id, new_sale_id, original_total, returned_amount, new_total, diff, note, created_by, created_at)
       VALUES
        (:original_sale_id, :return_id, :new_sale_id, :original_total, :returned_amount, :new_total, :diff, :note, :created_by, NOW())`,
      {
        replacements: {
          original_sale_id,
          return_id,
          new_sale_id: newSale.id,
          original_total: Number(originalSale.total || 0),
          returned_amount: Number(returned_amount || 0),
          new_total: Number(new_total || 0),
          diff: Number(diff || 0),
          note,
          created_by,
        },
        transaction: t,
      }
    );

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
        method,
      },
    });
  } catch (e) {
    try { await t.rollback(); } catch {}
    const status = e?.status || 500;
    return res.status(status).json({
      ok: false,
      code: e?.code || "EXCHANGE_ERROR",
      message: e?.message || "Error cambio",
      data: e?.data || null,
    });
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
    if (!id) { await t.rollback(); return res.status(400).json({ ok: false, message: "ID inválido" }); }

    const sale = await Sale.findByPk(id, { transaction: t });
    if (!sale) { await t.rollback(); return res.status(404).json({ ok: false, message: "Venta no encontrada" }); }

    if (!admin && toInt(sale.branch_id, 0) !== toInt(branch_id, 0)) {
      await t.rollback();
      return res.status(403).json({ ok: false, code: "CROSS_BRANCH_SALE", message: "No podés eliminar una venta de otra sucursal." });
    }

    const force = String(req.query.force || "0") === "1";

    const [rr] = await sequelize.query(
      `SELECT COUNT(*) AS c FROM sale_returns WHERE sale_id = :sale_id`,
      { replacements: { sale_id: id }, transaction: t }
    );
    const returnsCount = toInt(rr?.[0]?.c, 0);

    if (returnsCount > 0 && !force) {
      await t.rollback();
      return res.status(409).json({
        ok: false,
        code: "SALE_HAS_RETURNS",
        message: "La venta tiene devoluciones/cambios. No se elimina por seguridad. Usá ?force=1 si realmente querés borrar todo.",
        data: { returnsCount },
      });
    }

    if (force && returnsCount > 0) {
      await sequelize.query(
        `DELETE FROM sale_exchanges
         WHERE original_sale_id = :sale_id OR new_sale_id = :sale_id OR return_id IN (SELECT id FROM sale_returns WHERE sale_id = :sale_id)`,
        { replacements: { sale_id: id }, transaction: t }
      );
      await sequelize.query(`DELETE FROM sale_returns WHERE sale_id = :sale_id`, { replacements: { sale_id: id }, transaction: t });
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
  getSaleById,
  createSale,
  deleteSale,
  createRefund,
  createExchange,
};
