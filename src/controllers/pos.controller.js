// src/controllers/pos.controller.js
const { Op, literal } = require("sequelize");
const {
  sequelize,
  Sale,
  SaleItem,
  Payment,
  Product,
  StockBalance,
  StockMovement,
  StockMovementItem,
} = require("../models");

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

async function getContext(req, res) {
  return res.json({
    ok: true,
    data: {
      user: { id: req.user.id, email: req.user.email, username: req.user.username },
      branch: req.ctx.branch,
      warehouse: req.ctx.warehouse,
    },
  });
}

async function listProductsForPos(req, res) {
  try {
    const warehouseId = req.ctx.warehouseId;

    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || "24", 10), 1), 200);
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const offset = (page - 1) * limit;

    const like = `%${q}%`;

    const whereQ = q
      ? `AND (
          p.name LIKE :like OR p.sku LIKE :like OR p.barcode LIKE :like OR p.code LIKE :like
          OR p.brand LIKE :like OR p.model LIKE :like
        )`
      : "";

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
      ORDER BY p.name ASC
      LIMIT :limit OFFSET :offset
      `,
      {
        replacements: { warehouseId, like, limit, offset },
      }
    );

    const [[countRow]] = await sequelize.query(
      `
      SELECT COUNT(*) AS total
      FROM products p
      WHERE p.is_active = 1
      ${
        q
          ? `AND (
        p.name LIKE :like OR p.sku LIKE :like OR p.barcode LIKE :like OR p.code LIKE :like
        OR p.brand LIKE :like OR p.model LIKE :like
      )`
          : ""
      }
      `,
      { replacements: { like } }
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

    const userId = req.user.id;
    const branchId = req.ctx.branchId;
    const warehouseId = req.ctx.warehouseId;

    if (items.length === 0) {
      return res.status(400).json({ ok: false, code: "EMPTY_ITEMS", message: "Venta sin items" });
    }

    const normalizedItems = items.map((i) => ({
      product_id: toNum(i.product_id),
      quantity: toNum(i.quantity),
      unit_price: toNum(i.unit_price),
    }));

    for (const it of normalizedItems) {
      if (!it.product_id) throw Object.assign(new Error("Item inválido: falta product_id"), { httpStatus: 400, code: "INVALID_ITEM" });
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) throw Object.assign(new Error(`Item inválido: quantity=${it.quantity}`), { httpStatus: 400, code: "INVALID_ITEM" });
      if (!Number.isFinite(it.unit_price) || it.unit_price <= 0) throw Object.assign(new Error(`Item inválido: unit_price=${it.unit_price}`), { httpStatus: 400, code: "INVALID_ITEM" });
    }

    let subtotal = 0;
    for (const it of normalizedItems) subtotal += it.quantity * it.unit_price;

    t = await sequelize.transaction();

    const sale = await Sale.create(
      {
        branch_id: branchId,
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
        warehouse_id: warehouseId,
        ref_type: "sale",
        ref_id: String(sale.id),
        note: `Venta POS #${sale.id}`,
        created_by: userId,
      },
      { transaction: t }
    );

    // ✅ PRO TIP: lock por producto para evitar doble venta simultánea con mismo stock
    for (const it of normalizedItems) {
      const p = await Product.findByPk(it.product_id, { transaction: t });
      if (!p) {
        throw Object.assign(new Error(`Producto no existe: id=${it.product_id}`), { httpStatus: 400, code: "PRODUCT_NOT_FOUND" });
      }

      // Traigo el balance con lock (si no existe, no hay stock cargado)
      const sb = await StockBalance.findOne({
        where: { warehouse_id: warehouseId, product_id: it.product_id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!sb) {
        throw Object.assign(new Error(`No existe stock_balance para producto ${p.sku || p.id} en depósito ${warehouseId}`), {
          httpStatus: 409,
          code: "STOCK_BALANCE_MISSING",
        });
      }

      if (Number(sb.qty) < it.quantity) {
        throw Object.assign(new Error(`Stock insuficiente (depósito ${warehouseId}) para producto ${p.sku || p.id}`), {
          httpStatus: 409,
          code: "STOCK_INSUFFICIENT",
        });
      }

      // ✅ actualizo con literal (el trigger también protege)
      await sb.update({ qty: literal(`qty - ${it.quantity}`) }, { transaction: t });

      const lineTotal = it.quantity * it.unit_price;

      await SaleItem.create(
        {
          sale_id: sale.id,
          product_id: it.product_id,
          warehouse_id: warehouseId,
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

    return res.json({
      ok: true,
      data: {
        sale_id: sale.id,
        branch_id: sale.branch_id,
        user_id: sale.user_id,
        warehouse_id: warehouseId,
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
