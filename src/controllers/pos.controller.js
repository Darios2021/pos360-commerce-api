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
  return roles.includes("admin");
}

/**
 * Resuelve branchId/warehouseId de forma robusta:
 * 1) req.ctx (si existe)
 * 2) req.body.branch_id / req.body.warehouse_id
 * 3) req.query.branch_id / req.query.warehouse_id
 */
function resolvePosContext(req) {
  const branchId =
    toInt(req?.ctx?.branchId, 0) ||
    toInt(req?.body?.branch_id, 0) ||
    toInt(req?.query?.branch_id, 0);

  const warehouseId =
    toInt(req?.ctx?.warehouseId, 0) ||
    toInt(req?.body?.warehouse_id, 0) ||
    toInt(req?.query?.warehouse_id, 0);

  return { branchId, warehouseId };
}

/**
 * ✅ si no viene warehouse_id:
 * - intenta tomar el "primer warehouse" de la sucursal (branch_id)
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

async function getContext(req, res) {
  const { branchId, warehouseId } = resolvePosContext(req);

  return res.json({
    ok: true,
    data: {
      user: req.user
        ? { id: req.user.id, email: req.user.email, username: req.user.username, branch_id: req.user.branch_id, roles: req.user.roles }
        : null,
      branch: req?.ctx?.branch || (branchId ? { id: branchId } : null),
      warehouse: req?.ctx?.warehouse || (warehouseId ? { id: warehouseId } : null),
      branchId: branchId || null,
      warehouseId: warehouseId || null,
    },
  });
}

// REEMPLAZAR SOLO ESTA FUNCIÓN en src/controllers/pos.controller.js
async function listProductsForPos(req, res) {
  try {
    const { warehouseId } = resolvePosContext(req);

    if (!warehouseId) {
      return res.status(400).json({
        ok: false,
        code: "WAREHOUSE_REQUIRED",
        message: "Falta warehouse_id (depósito). Enviá warehouse_id o configurá req.ctx.warehouseId.",
      });
    }

    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || "24", 10), 1), 200);
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const offset = (page - 1) * limit;

    // ✅ por defecto NO mostrar sin stock
    const inStock = String(req.query.in_stock ?? "1") === "1";

    const like = `%${q}%`;

    const whereQ = q
      ? `AND (
          p.name LIKE :like OR p.sku LIKE :like OR p.barcode LIKE :like OR p.code LIKE :like
          OR p.brand LIKE :like OR p.model LIKE :like
        )`
      : "";

    const whereStock = inStock ? `AND COALESCE(sb.qty, 0) > 0` : "";

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
        p.price,
        p.price_list,
        p.price_discount,
        p.price_reseller,
        COALESCE(sb.qty, 0) AS qty
      FROM products p
      LEFT JOIN stock_balances sb
        ON sb.product_id = p.id AND sb.warehouse_id = :warehouseId
      WHERE p.is_active = 1
      ${whereQ}
      ${whereStock}
      ORDER BY p.name ASC
      LIMIT :limit OFFSET :offset
      `,
      {
        replacements: { warehouseId, like, limit, offset },
      }
    );

    // ✅ count consistente con el listado (incluye filtro de stock)
    const [[countRow]] = await sequelize.query(
      `
      SELECT COUNT(*) AS total
      FROM products p
      LEFT JOIN stock_balances sb
        ON sb.product_id = p.id AND sb.warehouse_id = :warehouseId
      WHERE p.is_active = 1
      ${whereQ}
      ${whereStock}
      `,
      { replacements: { warehouseId, like } }
    );

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
    const admin = isAdminReq(req);

    // ✅ branch: user normal = SIEMPRE su branch_id. admin: puede mandar branch_id, si no usa el suyo
    const userBranchId = toInt(req.user.branch_id, 0);
    const { branchId: ctxBranchId, warehouseId: ctxWarehouseId } = resolvePosContext(req);

    const resolvedBranchId = admin ? (toInt(ctxBranchId, 0) || userBranchId) : userBranchId;

    if (!resolvedBranchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "Falta branch_id (sucursal). El usuario no tiene sucursal asignada.",
      });
    }

    // ✅ warehouse: si no viene, intentamos resolver por branch
    let resolvedWarehouseId = toInt(ctxWarehouseId, 0);
    if (!resolvedWarehouseId) {
      resolvedWarehouseId = await resolveWarehouseForBranch(resolvedBranchId);
    }

    if (!resolvedWarehouseId) {
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
        throw Object.assign(new Error("Item inválido: falta product_id"), {
          httpStatus: 400,
          code: "INVALID_ITEM",
        });
      if (!Number.isFinite(it.quantity) || it.quantity <= 0)
        throw Object.assign(new Error(`Item inválido: quantity=${it.quantity}`), {
          httpStatus: 400,
          code: "INVALID_ITEM",
        });
      if (!Number.isFinite(it.unit_price) || it.unit_price <= 0)
        throw Object.assign(new Error(`Item inválido: unit_price=${it.unit_price}`), {
          httpStatus: 400,
          code: "INVALID_ITEM",
        });
    }

    let subtotal = 0;
    for (const it of normalizedItems) subtotal += it.quantity * it.unit_price;

    t = await sequelize.transaction();

    const sale = await Sale.create(
      {
        branch_id: resolvedBranchId,
        user_id: userId, // ✅ siempre registra el usuario logueado
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
        warehouse_id: resolvedWarehouseId,
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
        throw Object.assign(new Error(`Producto no existe: id=${it.product_id}`), {
          httpStatus: 400,
          code: "PRODUCT_NOT_FOUND",
        });
      }

      const sb = await StockBalance.findOne({
        where: { warehouse_id: resolvedWarehouseId, product_id: it.product_id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!sb) {
        throw Object.assign(
          new Error(
            `No existe stock_balance para producto ${p.sku || p.id} en depósito ${resolvedWarehouseId}`
          ),
          { httpStatus: 409, code: "STOCK_BALANCE_MISSING" }
        );
      }

      if (Number(sb.qty) < it.quantity) {
        throw Object.assign(
          new Error(`Stock insuficiente (depósito ${resolvedWarehouseId}) para producto ${p.sku || p.id}`),
          { httpStatus: 409, code: "STOCK_INSUFFICIENT" }
        );
      }

      await sb.update({ qty: literal(`qty - ${it.quantity}`) }, { transaction: t });

      const lineTotal = it.quantity * it.unit_price;

      await SaleItem.create(
        {
          sale_id: sale.id,
          product_id: it.product_id,
          warehouse_id: resolvedWarehouseId,
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
        throw Object.assign(new Error(`Pago inválido: amount=${pay.amount}`), {
          httpStatus: 400,
          code: "INVALID_PAYMENT",
        });
      }

      if (!["CASH", "TRANSFER", "CARD", "QR", "OTHER"].includes(method)) {
        throw Object.assign(new Error(`Pago inválido: method=${method}`), {
          httpStatus: 400,
          code: "INVALID_PAYMENT_METHOD",
        });
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

    return res.json({
      ok: true,
      data: {
        sale_id: sale.id,
        branch_id: sale.branch_id,
        user_id: sale.user_id,
        warehouse_id: resolvedWarehouseId,
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

    console.error("❌ [POS] createSale error:", e);
    return res.status(status).json({ ok: false, code, message: e.message });
  }
}

module.exports = {
  getContext,
  listProductsForPos,
  createSale,
};
