// src/controllers/dashboard.controller.js
const { Op, fn, col, Sequelize } = require("sequelize");
const { Product, Category, Sale, Payment } = require("../models");

// ===== Helpers =====
function ymd(d) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function methodLabel(m) {
  const x = String(m || "").toUpperCase();
  if (x === "CASH") return "Efectivo";
  if (x === "CARD") return "Tarjeta / Débito";
  if (x === "TRANSFER") return "Transferencia";
  if (x === "QR") return "QR";
  if (x === "OTHER") return "Otro";
  return x || "—";
}

// ============================
// GET /api/v1/dashboard/inventory
// ============================
async function inventory(req, res, next) {
  try {
    const totalProducts = await Product.count();
    const activeProducts = await Product.count({ where: { is_active: 1 } });

    // Sin precio (price_list<=0 y price<=0)
    const noPriceProducts = await Product.count({
      where: {
        [Op.and]: [
          { [Op.or]: [{ price_list: { [Op.lte]: 0 } }, { price_list: null }] },
          { [Op.or]: [{ price: { [Op.lte]: 0 } }, { price: null }] },
        ],
      },
    });

    const categories = await Category.count();

    const lastProducts = await Product.findAll({
      order: [["id", "DESC"]],
      limit: 10,
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["id", "name", "parent_id"],
          required: false,
          include: [
            {
              model: Category,
              as: "parent",
              attributes: ["id", "name"],
              required: false,
            },
          ],
        },
      ],
    });

    return res.json({
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
    next(e);
  }
}

// ============================
// GET /api/v1/dashboard/sales
// ============================
async function sales(req, res, next) {
  try {
    const now = new Date();
    const from = startOfDay(now);
    const to = endOfDay(now);

    // --- Ventas hoy ---
    const todayCount = await Sale.count({
      where: { sold_at: { [Op.between]: [from, to] }, status: "PAID" },
    });

    const todayTotalRow = await Sale.findOne({
      attributes: [[fn("SUM", col("total")), "sum_total"]],
      where: { sold_at: { [Op.between]: [from, to] }, status: "PAID" },
      raw: true,
    });

    const todayTotal = Number(todayTotalRow?.sum_total || 0);
    const avgTicket = todayCount > 0 ? todayTotal / todayCount : 0;

    // --- Pagos hoy por método ---
    // ✅ IMPORTANTÍSIMO: NO usamos "as: sale" porque tu asociación Payment.belongsTo(Sale) no tiene alias.
    const paymentRows = await Payment.findAll({
      attributes: ["method", [fn("SUM", col("amount")), "sum_amount"]],
      include: [
        {
          model: Sale,
          attributes: [],
          required: true,
          where: { sold_at: { [Op.between]: [from, to] }, status: "PAID" },
        },
      ],
      group: ["method"],
      raw: true,
    });

    const paymentsByMethod = {};
    let topPaymentLabel = "—";
    let topVal = 0;

    for (const r of paymentRows) {
      const m = String(r.method || "").toUpperCase();
      const v = Number(r.sum_amount || 0);
      paymentsByMethod[m] = v;
      if (v > topVal) {
        topVal = v;
        topPaymentLabel = methodLabel(m);
      }
    }

    // --- Ventas últimos 7 días ---
    const days = 7;
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);

    const salesByDayRows = await Sale.findAll({
      attributes: [
        [fn("DATE", col("sold_at")), "day"],
        [fn("SUM", col("total")), "sum_total"],
      ],
      where: { sold_at: { [Op.gte]: start }, status: "PAID" },
      group: [fn("DATE", col("sold_at"))], // ✅ más robusto en MySQL
      order: [[fn("DATE", col("sold_at")), "ASC"]],
      raw: true,
    });

    const map = new Map();
    for (const r of salesByDayRows) {
      // r.day suele venir como 'YYYY-MM-DD'
      map.set(String(r.day), Number(r.sum_total || 0));
    }

    const salesByDay = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = ymd(d);
      salesByDay.push({ date: key, total: map.get(key) || 0 });
    }

    // --- Últimas ventas (tabla) ---
    const lastSales = await Sale.findAll({
      where: { status: "PAID" },
      order: [["id", "DESC"]],
      limit: 10,
      include: [
        // ✅ acá SÍ usamos alias "payments" porque vos lo definiste en Sale.hasMany(Payment, { as: "payments" })
        { model: Payment, as: "payments", required: false },
      ],
    });

    return res.json({
      ok: true,
      data: {
        todayCount,
        todayTotal,
        avgTicket,
        topPaymentLabel,
        salesByDay,
        paymentsByMethod,
        lastSales,
      },
    });
  } catch (e) {
    console.error("❌ [DASHBOARD SALES ERROR]", e);
    next(e);
  }
}

module.exports = {
  inventory,
  sales,
};
