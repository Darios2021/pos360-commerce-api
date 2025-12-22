// src/controllers/dashboard.controller.js
const { Op, fn, col } = require("sequelize");
const { Product, Category, Sale, Payment } = require("../models");

// ============================
// GET /dashboard/inventory
// ============================
async function inventory(req, res, next) {
  try {
    const totalProducts = await Product.count();
    const activeProducts = await Product.count({ where: { is_active: 1 } });
    const categories = await Category.count();

    return res.json({
      ok: true,
      data: { totalProducts, activeProducts, categories },
    });
  } catch (e) {
    next(e);
  }
}

// ============================
// GET /dashboard/sales
// ============================
async function sales(req, res, next) {
  try {
    const from = new Date();
    from.setHours(0, 0, 0, 0);

    const to = new Date();
    to.setHours(23, 59, 59, 999);

    const todayCount = await Sale.count({
      where: { sold_at: { [Op.between]: [from, to] }, status: "PAID" },
    });

    const todayTotalRow = await Sale.findOne({
      attributes: [[fn("SUM", col("total")), "sum"]],
      where: { sold_at: { [Op.between]: [from, to] }, status: "PAID" },
      raw: true,
    });

    // 🔥 FIX CLAVE: alias "payments"
    const payments = await Payment.findAll({
      attributes: ["method", [fn("SUM", col("amount")), "total"]],
      include: [{
        model: Sale,
        as: "sale",
        where: { sold_at: { [Op.between]: [from, to] }, status: "PAID" },
        attributes: [],
      }],
      group: ["method"],
      raw: true,
    });

    return res.json({
      ok: true,
      data: {
        todayCount,
        todayTotal: Number(todayTotalRow?.sum || 0),
        paymentsByMethod: payments,
      },
    });
  } catch (e) {
    console.error("❌ DASHBOARD SALES ERROR", e);
    next(e);
  }
}

module.exports = { inventory, sales };
