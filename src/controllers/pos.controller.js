// src/controllers/pos.controller.js
const { literal } = require("sequelize");
const {
  sequelize,
  Sale,
  SaleItem,
  Payment,
  Product,
  StockBalance,
  StockMovement,
  StockMovementItem,
  Warehouse,
} = require("../models");

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toInt(v, def = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : def;
}

function normalizeRoles(raw) {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map((r) => String(r || "").toLowerCase()).filter(Boolean);
}

function isAdminReq(req) {
  const roles = normalizeRoles(req?.user?.roles);
  return roles.includes("admin") || roles.includes("super_admin");
}

/**
 * Log helper (no expone data sensible)
 */
function logCtx(req, label, extra = {}) {
  try {
    const rid = req.id || req.headers["x-request-id"] || "-";
    const u = req.user ? { id: req.user.id, email: req.user.email, branch_id: req.user.branch_id, roles: req.user.roles } : null;

    console.log(
      `ℹ️ [POS] ${label} rid=${rid} method=${req.method} path=${req.originalUrl}`,
      {
        user: u,
        body_branch_id: req?.body?.branch_id,
        body_warehouse_id: req?.body?.warehouse_id,
        query_branch_id: req?.query?.branch_id,
        query_warehouse_id: req?.query?.warehouse_id,
        ctx_branchId: req?.ctx?.branchId,
        ctx_warehouseId: req?.ctx?.warehouseId,
        ...extra,
      }
    );
  } catch {}
}

/**
 * ✅ Resuelve branchId/warehouseId de forma robusta:
 * PRIORIDAD:
 * 1) req.body
 * 2) req.query
 * 3) req.ctx
 */
function resolvePosContext(req) {
  const branchId =
    toInt(req?.body?.branch_id, 0) ||
    toInt(req?.query?.branch_id, 0) ||
    toInt(req?.ctx?.branchId, 0);

  const warehouseId =
    toInt(req?.body?.warehouse_id, 0) ||
    toInt(req?.query?.warehouse_id, 0) ||
    toInt(req?.ctx?.warehouseId, 0);

  return { branchId, warehouseId };
}

/**
 * ✅ Si no viene warehouse_id, toma el primer depósito de la sucursal.
 */
async function resolveWarehouseForBranch(branchId) {
  const bid = toInt(branchId, 0);
  if (!bid) return 0;

  const w = await Warehouse.findOne({
    where: { branch_id: bid },
    order: [["id", "ASC"]],
    attributes: ["id"],
  });

  return toInt(w?.id, 0);
}

/**
 * ✅ Arma contexto final consistente para TODOS:
 * - branch: user normal => SIEMPRE su branch_id
 * - branch: admin/super_admin => puede venir por body/query/ctx; si no, su branch_id
 * - warehouse: si no viene => resuelve por branch
 */
async function resolveEffectiveContext(req, { allowBodyBranch = true, allowBodyWarehouse = true } = {}) {
  const admin = isAdminReq(req);

  // branch base: user normal siempre su branch_id
  const userBranchId = toInt(req?.user?.branch_id, 0);

  const { branchId, warehouseId } = resolvePosContext(req);

  const candidateBranch = allowBodyBranch ? toInt(branchId, 0) : toInt(req?.ctx?.branchId, 0) || toInt(req?.query?.branch_id, 0);
  const resolvedBranchId = admin ? (candidateBranch || userBranchId) : userBranchId;

  let candidateWarehouse = allowBodyWarehouse ? toInt(warehouseId, 0) : toInt(req?.ctx?.warehouseId, 0) || toInt(req?.query?.warehouse_id, 0);
  let resolvedWarehouseId = candidateWarehouse;

  if (!resolvedWarehouseId && resolvedBranchId) {
    resolvedWarehouseId = await resolveWarehouseForBranch(resolvedBranchId);
  }

  return {
    admin,
    userBranchId,
    branchId: resolvedBranchId || 0,
    warehouseId: resolvedWarehouseId || 0,
  };
}

async function getContext(req, res) {
  try {
    const ctx = await resolveEffectiveContext(req);

    logCtx(req, "getContext", { resolved: ctx });

    return res.json({
      ok: true,
      data: {
        user: req.user
          ? {
              id: req.user.id,
              email: req.user.email,
              username: req.user.username,
              branch_id: req.user.branch_id,
              roles: req.user.roles,
            }
          : null,
        branch: ctx.branchId ? { id: ctx.branchId } : null,
        warehouse: ctx.warehouseId ? { id: ctx.warehouseId } : null,
        branchId: ctx.branchId || null,
        warehouseId: ctx.warehouseId || null,
      },
    });
  } catch (e) {
    console.error("❌ [POS] getContext error:", e);
    return res.status(500).json({ ok: false, code: "POS_CONTEXT_ERROR", message: e.message });
  }
}

/**
 * ✅ POS PRODUCTS:
 * - requiere warehouse_id (si no viene => 400)
 * - soporta branch_id (no es obligatorio) sólo para logging/consistencia
 */
async function listProductsForPos(req, res) {
  try {
    const ctx = await resolveEffectiveContext(req);

    logCtx(req, "listProductsForPos:start", { resolved: ctx });

    if (!ctx.warehouseId) {
      console.warn("⚠️ [POS] listProductsForPos WAREHOUSE_REQUIRED", { resolved: ctx });
      return res.status(400).json({
        ok: false,
        code: "WAREHOUSE_REQUIRED",
        message: "Falta warehouse_id (depósito). El POS debe tener depósito seleccionado o resolverse por sucursal.",
      });
    }

    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || "24", 10), 1), 200);
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const offset = (page - 1) * limit;

    const inStock = String(req.query.in_stock ?? "1") === "1";
    const sellable = String(req.query.sellable ?? "1") === "1";
    const priceMode = String(req.query.price_mode || "LIST").trim().toUpperCase();

    const like = `%${q}%`;

    const whereQ = q
      ? `AND (
          p.name LIKE :like OR p.sku LIKE :like OR p.barcode LIKE :like OR p.code LIKE :like
          OR p.brand LIKE :like OR p.model LIKE :like
        )`
      : "";

    const whereStock = inStock ? `AND COALESCE(sb.qty, 0) > 0` : "";

    const priceExpr =
      priceMode === "BASE"
        ? `COALESCE(p.price, 0)`
        : priceMode === "DISCOUNT"
        ? `COALESCE(NULLIF(p.price_discount,0), NULLIF(p.price_list,0), p.price, 0)`
        : priceMode === "RESELLER"
        ? `COALESCE(NULLIF(p.price_reseller,0), NULLIF(p.price_list,0), p.price, 0)`
        : `COALESCE(NULLIF(p.price_list,0), p.price, 0)`; // LIST

    const whereSellable = sellable ? `AND (${priceExpr}) > 0` : "";

    const [rows] = await sequelize.query(
      `
      SELECT
        p.id,
        p.code,
        p.sku,
        p.barcode,
        p.name,
        p.brand,
        p.model,
        p.is_active,
        p.price,
        p.price_list,
        p.price_discount,
        p.price_reseller,
        (${priceExpr}) AS effective_price,
        COALESCE(sb.qty, 0) AS qty
      FROM products p
      LEFT JOIN stock_balances sb
        ON sb.product_id = p.id AND sb.warehouse_id = :warehouseId
      WHERE p.is_active = 1
      ${whereQ}
      ${whereStock}
      ${whereSellable}
      ORDER BY p.name ASC
      LIMIT :limit OFFSET :offset
      `,
      { replacements: { warehouseId: ctx.warehouseId, like, limit, offset } }
    );

    const [[countRow]] = await sequelize.query(
      `
      SELECT COUNT(*) AS total
      FROM products p
      LEFT JOIN stock_balances sb
        ON sb.product_id = p.id AND sb.warehouse_id = :warehouseId
      WHERE p.is_active = 1
      ${whereQ}
      ${whereStock}
      ${whereSellable}
      `,
      { replacements: { warehouseId: ctx.warehouseId, like } }
    );

    logCtx(req, "listProductsForPos:ok", {
      resolved: ctx,
      meta: { page, limit, total: Number(countRow?.total || 0), returned: rows.length },
    });

    return res.json({
      ok: true,
      data: rows,
      meta: { page, limit, total: Number(countRow?.total || 0) },
    });
  } catch (e) {
    console.error("❌ [POS] listProductsForPos error:", e);
    return res.status(500).json({ ok: false, code: "POS_PRODUCTS_ERROR", message: e.message });
  }
}

async function createSale(req, res) {
  let t;
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const payments = Array.isArray(body.payments) ? body.payments : [];

    const customer_name = body.customer_name || "Consumidor Final";
    const note = body.note || null;

    if (!req.user?.id) {
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "No autenticado" });
    }

    const userId = toInt(req.user.id, 0);

    // En createSale: permitimos branch/warehouse desde body (admin puede elegir)
    const ctx = await resolveEffectiveContext(req, { allowBodyBranch: true, allowBodyWarehouse: true });

    logCtx(req, "createSale:start", { resolved: ctx, itemsCount: items.length, paymentsCount: payments.length });

    if (!ctx.branchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "Falta branch_id (sucursal). El usuario no tiene sucursal asignada.",
      });
    }

    if (!ctx.warehouseId) {
      return res.status(400).json({
        ok: false,
        code: "WAREHOUSE_REQUIRED",
        message:
          "Falta warehouse_id (depósito). Enviá warehouse_id o asegurate de tener al menos 1 depósito creado para la sucursal.",
      });
    }

    if (items.length === 0) {
      return res.status(400).json({ ok: false, code: "EMPTY_ITEMS", message: "Venta sin items" });
    }

    const normalizedItems = items.map((i) => ({
      product_id: toNum(i.product_id),
      quantity: toNum(i.quantity),
      unit_price: toNum(i.unit_price),
    }));

    for (const it of normalizedItems) {
      if (!it.product_id)
        throw Object.assign(new Error("Item inválido: falta product_id"), { httpStatus: 400, code: "INVALID_ITEM" });
      if (!Number.isFinite(it.quantity) || it.quantity <= 0)
        throw Object.assign(new Error(`Item inválido: quantity=${it.quantity}`), { httpStatus: 400, code: "INVALID_ITEM" });
      if (!Number.isFinite(it.unit_price) || it.unit_price <= 0)
        throw Object.assign(new Error(`Item inválido: unit_price=${it.unit_price}`), { httpStatus: 400, code: "INVALID_ITEM" });
    }

    let subtotal = 0;
    for (const it of normalizedItems) subtotal += it.quantity * it.unit_price;

    t = await sequelize.transaction();

    const sale = await Sale.create(
      {
        branch_id: ctx.branchId,
        user_id: userId,
        status: "PAID",
        sale_number: null,
        customer_name,
        subtotal,
        discount_total: 0,
        tax_total: 0,
        total: subtotal,
        paid_total: 0,
        change_total: 0,
        note,
        sold_at: new Date(),
      },
      { transaction: t }
    );

    const movement = await StockMovement.create(
      {
        type: "out",
        warehouse_id: ctx.warehouseId,
        ref_type: "sale",
        ref_id: String(sale.id),
        note: `Venta POS #${sale.id}`,
        created_by: userId,
      },
      { transaction: t }
    );

    for (const it of normalizedItems) {
      const p = await Product.findByPk(it.product_id, { transaction: t });
      if (!p) {
        throw Object.assign(new Error(`Producto no existe: id=${it.product_id}`), { httpStatus: 400, code: "PRODUCT_NOT_FOUND" });
      }

      const sb = await StockBalance.findOne({
        where: { warehouse_id: ctx.warehouseId, product_id: it.product_id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!sb) {
        throw Object.assign(
          new Error(`No existe stock_balance para producto ${p.sku || p.id} en depósito ${ctx.warehouseId}`),
          { httpStatus: 409, code: "STOCK_BALANCE_MISSING" }
        );
      }

      if (Number(sb.qty) < it.quantity) {
        throw Object.assign(
          new Error(`Stock insuficiente (depósito ${ctx.warehouseId}) para producto ${p.sku || p.id}`),
          { httpStatus: 409, code: "STOCK_INSUFFICIENT" }
        );
      }

      await sb.update({ qty: literal(`qty - ${it.quantity}`) }, { transaction: t });

      const lineTotal = it.quantity * it.unit_price;

      await SaleItem.create(
        {
          sale_id: sale.id,
          product_id: it.product_id,
          warehouse_id: ctx.warehouseId,
          quantity: it.quantity,
          unit_price: it.unit_price,
          discount_amount: 0,
          tax_amount: 0,
          line_total: lineTotal,
          product_name_snapshot: p.name,
          product_sku_snapshot: p.sku,
          product_barcode_snapshot: p.barcode,
        },
        { transaction: t }
      );

      await StockMovementItem.create(
        {
          movement_id: movement.id,
          product_id: it.product_id,
          qty: it.quantity,
          unit_cost: p.cost || null,
        },
        { transaction: t }
      );
    }

    let totalPaid = 0;

    for (const pay of payments) {
      const amount = toNum(pay.amount);
      const method = String(pay.method || "CASH").toUpperCase();

      if (!Number.isFinite(amount) || amount <= 0) {
        throw Object.assign(new Error(`Pago inválido: amount=${pay.amount}`), { httpStatus: 400, code: "INVALID_PAYMENT" });
      }

      if (!["CASH", "TRANSFER", "CARD", "QR", "OTHER"].includes(method)) {
        throw Object.assign(new Error(`Pago inválido: method=${method}`), { httpStatus: 400, code: "INVALID_PAYMENT_METHOD" });
      }

      totalPaid += amount;

      await Payment.create(
        {
          sale_id: sale.id,
          method,
          amount,
          reference: pay.reference || null,
          note: pay.note || null,
          paid_at: new Date(),
        },
        { transaction: t }
      );
    }

    if (payments.length === 0) totalPaid = subtotal;

    sale.paid_total = totalPaid;
    sale.change_total = totalPaid - subtotal;
    await sale.save({ transaction: t });

    await t.commit();

    logCtx(req, "createSale:ok", {
      resolved: ctx,
      sale_id: sale.id,
      subtotal: sale.subtotal,
      paid_total: sale.paid_total,
      change_total: sale.change_total,
    });

    return res.json({
      ok: true,
      data: {
        sale_id: sale.id,
        branch_id: sale.branch_id,
        user_id: sale.user_id,
        warehouse_id: ctx.warehouseId,
        subtotal: sale.subtotal,
        total: sale.total,
        paid_total: sale.paid_total,
        change_total: sale.change_total,
        status: sale.status,
        sold_at: sale.sold_at,
      },
    });
  } catch (e) {
    if (t) await t.rollback();

    const status = e.httpStatus || 500;
    const code = e.code || "POS_CREATE_SALE_ERROR";

    console.error("❌ [POS] createSale error:", {
      code,
      status,
      message: e.message,
      stack: e.stack,
      user: req.user ? { id: req.user.id, email: req.user.email, branch_id: req.user.branch_id, roles: req.user.roles } : null,
      body_branch_id: req?.body?.branch_id,
      body_warehouse_id: req?.body?.warehouse_id,
    });

    return res.status(status).json({ ok: false, code, message: e.message });
  }
}

module.exports = {
  getContext,
  listProductsForPos,
  createSale,
};
