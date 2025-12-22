// src/modules/pos/pos.controller.js
const { Op } = require("sequelize");
const { sequelize, Sale, SaleItem, Payment, Product, ProductImage, Category } = require("../../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function parseDateTime(v) {
  if (!v) return null;
  // Acepta "YYYY-MM-DD" o "YYYY-MM-DD HH:mm:ss"
  const s = String(v).trim();
  const dt = s.length === 10 ? `${s} 00:00:00` : s;
  const d = new Date(dt.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

function includeFullProduct() {
  return [
    {
      model: Product,
      as: "product",
      required: false,
      include: [
        { model: Category, as: "category", required: false, attributes: ["id", "name", "parent_id"] },
        { model: ProductImage, as: "images", required: false }, // para foto
      ],
    },
  ];
}

/**
 * GET /pos/sales
 * Query: page, limit, q, status, from, to, branch_id
 */
async function listSales(req, res) {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim();
    const branchId = toInt(req.query.branch_id, 0) || null;

    const from = parseDateTime(req.query.from);
    const to = parseDateTime(req.query.to);

    const where = {};
    if (branchId) where.branch_id = branchId;
    if (status) where.status = status;

    if (from || to) {
      where.sold_at = {};
      if (from) where.sold_at[Op.gte] = from;
      if (to) where.sold_at[Op.lte] = to;
    }

    if (q) {
      where[Op.or] = [
        { customer_name: { [Op.like]: `%${q}%` } },
        { sale_number: { [Op.like]: `%${q}%` } },
        { id: toInt(q, -1) > 0 ? toInt(q, -1) : -999999999 },
      ];
    }

    const { rows, count } = await Sale.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
      include: [
        { model: Payment, as: "payments", required: false },
        {
          model: SaleItem,
          as: "items",
          required: false,
          include: includeFullProduct(),
        },
      ],
    });

    const pages = Math.max(1, Math.ceil(count / limit));

    res.json({
      ok: true,
      data: rows,
      meta: { page, limit, total: count, pages },
    });
  } catch (e) {
    console.error("[POS listSales ERROR]", e);
    res.status(500).json({ ok: false, message: e.message });
  }
}

/**
 * GET /pos/sales/:id
 */
async function getSale(req, res) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const sale = await Sale.findByPk(id, {
      include: [
        { model: Payment, as: "payments", required: false },
        {
          model: SaleItem,
          as: "items",
          required: false,
          include: includeFullProduct(),
        },
      ],
    });

    if (!sale) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    res.json({ ok: true, data: sale });
  } catch (e) {
    console.error("[POS getSale ERROR]", e);
    res.status(500).json({ ok: false, message: e.message });
  }
}

/**
 * POST /pos/sales
 * (tu createSale actual)
 */
async function createSale(req, res) {
  let t;
  try {
    const { branch_id, user_id, customer_name, items = [], payments = [] } = req.body;

    if (!items.length) {
      return res.status(400).json({ ok: false, message: "Venta sin items." });
    }

    t = await sequelize.transaction();

    let calculatedTotal = 0;
    items.forEach(i => {
      calculatedTotal += (Number(i.quantity) * Number(i.unit_price));
    });

    const sale = await Sale.create({
      branch_id: branch_id || 1,
      user_id: user_id || 1,
      customer_name: customer_name || "Consumidor Final",
      subtotal: calculatedTotal,
      tax_total: 0,
      discount_total: 0,
      total: calculatedTotal,
      paid_total: 0,
      change_total: 0,
      status: "PAID",
      sold_at: new Date()
    }, { transaction: t });

    for (const item of items) {
      const qty = Number(item.quantity);
      const price = Number(item.unit_price);
      const lineTotal = qty * price;

      await SaleItem.create({
        sale_id: sale.id,
        product_id: item.product_id,
        quantity: qty,
        unit_price: price,
        line_total: lineTotal,
        product_name_snapshot: item.product_name_snapshot || "Item",
        product_sku_snapshot: item.product_sku_snapshot || null,
        product_barcode_snapshot: item.product_barcode_snapshot || null,
      }, { transaction: t });
    }

    let totalPaid = 0;
    for (const p of payments) {
      const amount = Number(p.amount);
      totalPaid += amount;

      await Payment.create({
        sale_id: sale.id,
        amount,
        method: p.method,
        paid_at: new Date(),
      }, { transaction: t });
    }

    sale.paid_total = totalPaid;
    sale.change_total = totalPaid - calculatedTotal;
    await sale.save({ transaction: t });

    await t.commit();

    // devolver venta completa con include
    const full = await Sale.findByPk(sale.id, {
      include: [
        { model: Payment, as: "payments", required: false },
        {
          model: SaleItem,
          as: "items",
          required: false,
          include: includeFullProduct(),
        },
      ],
    });

    res.json({ ok: true, data: full });
  } catch (e) {
    if (t) await t.rollback();
    console.error("[POS createSale ERROR]", e);
    res.status(500).json({ ok: false, message: e.message });
  }
}

/**
 * DELETE /pos/sales/:id  (solo admin por middleware)
 * Borra cabecera + items + pagos (FK cascade puede ayudar, pero lo hacemos prolijo)
 */
async function deleteSale(req, res) {
  let t;
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    t = await sequelize.transaction();

    const sale = await Sale.findByPk(id, { transaction: t });
    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "NOT_FOUND" });
    }

    await Payment.destroy({ where: { sale_id: id }, transaction: t });
    await SaleItem.destroy({ where: { sale_id: id }, transaction: t });
    await Sale.destroy({ where: { id }, transaction: t });

    await t.commit();
    res.json({ ok: true, message: `Venta #${id} eliminada.` });
  } catch (e) {
    if (t) await t.rollback();
    console.error("[POS deleteSale ERROR]", e);
    res.status(500).json({ ok: false, message: e.message });
  }
}

module.exports = {
  listSales,
  getSale,
  createSale,
  deleteSale,
};
