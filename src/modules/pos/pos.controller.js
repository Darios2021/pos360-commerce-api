// src/modules/pos/pos.controller.js
const { Op } = require("sequelize");
const { sequelize, Sale, SaleItem, Payment, Product } = require("../../models");

async function createSale(req, res) {
  let t;
  try {
    const body = req.body || {};
    const {
      branch_id = 1,
      customer_name,
      items = [],
      payments = [],
    } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, message: "Venta sin items" });
    }
    if (!Array.isArray(payments)) {
      return res.status(400).json({ ok: false, message: "payments debe ser un array" });
    }

    t = await sequelize.transaction();

    // 1) Calcular total
    let total = 0;
    for (const i of items) {
      const q = Number(i.quantity ?? 0);
      const p = Number(i.unit_price ?? 0);

      if (!i.product_id) throw new Error("Item inválido: falta product_id");
      if (!Number.isFinite(q) || q <= 0) throw new Error(`Item inválido: quantity=${i.quantity}`);
      if (!Number.isFinite(p) || p <= 0) throw new Error(`Item inválido: unit_price=${i.unit_price}`);

      total += q * p;
    }

    const sale = await Sale.create(
      {
        branch_id: Number(branch_id) || 1,
        user_id: req.user?.id || 1,
        customer_name: customer_name || "Consumidor Final",
        subtotal: total,
        discount_total: 0,
        tax_total: 0,
        total: total,
        paid_total: 0,
        change_total: 0,
        status: "PAID",
        sold_at: new Date(),
      },
      { transaction: t }
    );

    for (const i of items) {
      const qty = Number(i.quantity);
      const price = Number(i.unit_price);
      const lineTotal = qty * price;

      await SaleItem.create(
        {
          sale_id: sale.id,
          product_id: i.product_id,
          quantity: qty,
          unit_price: price,
          line_total: lineTotal,
          product_name_snapshot: i.product_name_snapshot || "Item",
          product_sku_snapshot: i.product_sku_snapshot || null,
          product_barcode_snapshot: i.product_barcode_snapshot || null,
        },
        { transaction: t }
      );
    }

    let totalPaid = 0;
    for (const p of payments) {
      const amount = Number(p.amount ?? 0);
      const method = String(p.method || "CASH").toUpperCase();

      if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Pago inválido: amount=${p.amount}`);
      if (!["CASH", "TRANSFER", "CARD", "QR", "OTHER"].includes(method)) {
        throw new Error(`Método de pago inválido: ${method}`);
      }

      totalPaid += amount;

      await Payment.create(
        {
          sale_id: sale.id,
          amount,
          method,
        },
        { transaction: t }
      );
    }

    if (payments.length === 0) totalPaid = total;

    sale.paid_total = totalPaid;
    sale.change_total = totalPaid - total;
    await sale.save({ transaction: t });

    await t.commit();
    return res.json({ ok: true, data: sale });
  } catch (e) {
    if (t) await t.rollback();
    console.error("❌ [POS ERROR] createSale:", e);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

/**
 * GET /api/v1/pos/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&status=PAID&q=...&page=1&limit=20
 */
async function listSales(req, res) {
  try {
    const {
      from,
      to,
      status,
      q,
      page = 1,
      limit = 20,
      branch_id,
    } = req.query;

    const where = {};
    if (branch_id) where.branch_id = Number(branch_id);

    if (status) where.status = status;

    // rango de fechas (sold_at)
    if (from || to) {
      const start = from ? new Date(`${from}T00:00:00`) : new Date("1970-01-01T00:00:00");
      const end = to ? new Date(`${to}T23:59:59`) : new Date("2999-12-31T23:59:59");
      where.sold_at = { [Op.between]: [start, end] };
    }

    // búsqueda por customer o sale_number o id
    if (q && String(q).trim()) {
      const s = String(q).trim();
      where[Op.or] = [
        { customer_name: { [Op.like]: `%${s}%` } },
        { sale_number: { [Op.like]: `%${s}%` } },
      ];
      // si es número, también buscar por id
      const n = Number(s);
      if (Number.isFinite(n)) where[Op.or].push({ id: n });
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const { rows, count } = await Sale.findAndCountAll({
      where,
      order: [["sold_at", "DESC"]],
      limit: limitNum,
      offset,
      include: [
        { model: Payment, as: "payments", required: false },
      ],
    });

    return res.json({
      ok: true,
      data: rows,
      meta: {
        page: pageNum,
        limit: limitNum,
        total: count,
        pages: Math.ceil(count / limitNum),
      },
    });
  } catch (e) {
    console.error("❌ [POS ERROR] listSales:", e);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

/**
 * GET /api/v1/pos/sales/:id
 */
async function getSaleById(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "ID inválido" });

    const sale = await Sale.findByPk(id, {
      include: [
        { model: SaleItem, as: "items", required: false },
        { model: Payment, as: "payments", required: false },
      ],
    });

    if (!sale) return res.status(404).json({ ok: false, message: "Venta no encontrada" });

    return res.json({ ok: true, data: sale });
  } catch (e) {
    console.error("❌ [POS ERROR] getSaleById:", e);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

module.exports = { createSale, listSales, getSaleById };
