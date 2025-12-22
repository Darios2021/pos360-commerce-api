// src/controllers/dashboard.controller.js
const { Op } = require("sequelize");
const { Product, Category, Sale, Payment, SaleItem } = require("../models");

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

async function inventory(req, res) {
  try {
    const totalProducts = await Product.count();
    const activeProducts = await Product.count({ where: { is_active: 1 } });

    // sin precio (price_list y price en 0)
    const noPriceProducts = await Product.count({
      where: {
        [Op.and]: [
          { [Op.or]: [{ price_list: 0 }, { price_list: null }] },
          { [Op.or]: [{ price: 0 }, { price: null }] },
        ],
      },
    });

    const categories = await Category.count();

    const lastProducts = await Product.findAll({
      order: [["id", "DESC"]],
      limit: 8,
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["id", "name", "parent_id"],
          required: false,
          include: [{ model: Category, as: "parent", attributes: ["id", "name"], required: false }],
        },
      ],
    });

    res.json({
      ok: true,
      data: {
        totalProducts,
        activeProducts,
        noPriceProducts,
        categories,
        lastProducts,
      },
    });
  } catch (e) {
    console.error("[DASH inventory ERROR]", e);
    res.status(500).json({ ok: false, message: e.message });
  }
}

async function sales(req, res) {
  try {
    const from = startOfToday();
    const to = endOfToday();

    const todayCount = await Sale.count({
      where: { sold_at: { [Op.between]: [from, to] } },
    });

    const todaySales = await Sale.findAll({
      where: { sold_at: { [Op.between]: [from, to] } },
      attributes: ["id", "total"],
    });

    const todayTotal = todaySales.reduce((acc, s) => acc + Number(s.total || 0), 0);
    const avgTicket = todayCount ? todayTotal / todayCount : 0;

    // top payment method (hoy)
    const paymentsToday = await Payment.findAll({
      include: [{ model: Sale, as: "sale", required: true, where: { sold_at: { [Op.between]: [from, to] } } }],
    });

    const map = {};
    for (const p of paymentsToday) {
      const m = String(p.method || "OTHER").toUpperCase();
      map[m] = (map[m] || 0) + Number(p.amount || 0);
    }
    const topMethod = Object.entries(map).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const lastSales = await Sale.findAll({
      order: [["id", "DESC"]],
      limit: 8,
      include: [{ model: Payment, as: "payments", required: false }],
    });

    res.json({
      ok: true,
      data: {
        todayCount,
        todayTotal,
        avgTicket,
        topPaymentLabel: topMethod || "—",
        lastSales,
      },
    });
  } catch (e) {
    console.error("[DASH sales ERROR]", e);
    res.status(500).json({ ok: false, message: e.message });
  }
}

module.exports = { inventory, sales };
