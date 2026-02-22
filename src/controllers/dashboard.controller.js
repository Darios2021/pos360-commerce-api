// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/dashboard.controller.js
const svc = require("../services/dashboard.service");

// ============================
// GET /api/v1/dashboard/overview
// ============================
async function overview(req, res, next) {
  try {
    const scope = svc.resolveBranchScope(req);

    if (!scope.admin && !scope.branchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const now = new Date();
    const todayFrom = svc.startOfDay(now);
    const todayTo = svc.endOfDay(now);

    const weekFrom = new Date(todayFrom);
    weekFrom.setDate(weekFrom.getDate() - 6);

    const monthFrom = new Date(todayFrom);
    monthFrom.setDate(1);

    const prevWeekFrom = new Date(weekFrom);
    prevWeekFrom.setDate(prevWeekFrom.getDate() - 7);
    const prevWeekTo = new Date(weekFrom);
    prevWeekTo.setMilliseconds(-1);

    const prevMonthFrom = new Date(monthFrom);
    prevMonthFrom.setMonth(prevMonthFrom.getMonth() - 1);
    prevMonthFrom.setDate(1);
    const prevMonthTo = new Date(monthFrom);
    prevMonthTo.setMilliseconds(-1);

    const branchId = scope.branchId; // null => todas
    const today = await svc.getSalesTotals({ from: todayFrom, to: todayTo, branchId });
    const week = await svc.getSalesTotals({ from: weekFrom, to: todayTo, branchId });
    const month = await svc.getSalesTotals({ from: monthFrom, to: todayTo, branchId });

    const prevWeek = await svc.getSalesTotals({ from: prevWeekFrom, to: prevWeekTo, branchId });
    const prevMonth = await svc.getSalesTotals({ from: prevMonthFrom, to: prevMonthTo, branchId });

    const trend = {
      week_total_pct: svc.pctChange(week.total, prevWeek.total),
      week_count_pct: svc.pctChange(week.count, prevWeek.count),
      month_total_pct: svc.pctChange(month.total, prevMonth.total),
      month_count_pct: svc.pctChange(month.count, prevMonth.count),
    };

    // Pagos por método (hoy)
    const paymentsToday = await svc.getPaymentsByMethodToday({ from: todayFrom, to: todayTo, branchId });

    // Ventas por sucursal (últimos 30 días) — SIEMPRE
    const d30 = new Date(todayFrom);
    d30.setDate(d30.getDate() - 30);
    const salesByBranch = await svc.getSalesByBranch({ from: d30, branchId });

    // Stock KPIs
    const stock = await svc.getStock({ branchId, lowThreshold: 3 });

    // Inventory KPIs + últimos productos
    const inventory = await svc.getInventory({ branchId });

    return res.json({
      ok: true,
      scope,
      data: {
        sales: {
          today,
          week,
          month,
          trend,
          paymentsToday,

          // ✅ canon
          salesByBranch,

          // ✅ compat con dashboards viejos (por si el front mira otro nombre)
          byBranch: salesByBranch,
          salesByBranchPie: salesByBranch,
        },
        inventory,
        stock,
      },
    });
  } catch (e) {
    console.error("❌ [DASHBOARD OVERVIEW ERROR]", e);
    next(e);
  }
}

// ============================
// GET /api/v1/dashboard/inventory
// ============================
async function inventory(req, res, next) {
  try {
    const scope = svc.resolveBranchScope(req);

    if (!scope.admin && !scope.branchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const data = await svc.getInventory({ branchId: scope.branchId });

    return res.json({
      ok: true,
      scope,
      data,
    });
  } catch (e) {
    console.error("❌ [DASHBOARD INVENTORY ERROR]", e);
    next(e);
  }
}

// ============================
// GET /api/v1/dashboard/sales
// ============================
async function sales(req, res, next) {
  try {
    const scope = svc.resolveBranchScope(req);

    if (!scope.admin && !scope.branchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const now = new Date();
    const from = svc.startOfDay(now);
    const to = svc.endOfDay(now);
    const branchId = scope.branchId;

    const todayAgg = await svc.getSalesTotals({ from, to, branchId });

    const days = 7;
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);

    const salesByDay = await svc.getSalesByDay({ start, days, branchId });

    const paymentsToday = await svc.getPaymentsByMethodToday({ from, to, branchId });

    let topPaymentLabel = "—";
    let topVal = 0;
    const paymentsByMethod = {};
    for (const p of paymentsToday) {
      paymentsByMethod[p.method] = p.total;
      if (p.total > topVal) {
        topVal = p.total;
        topPaymentLabel = p.label;
      }
    }

    const lastSales = await svc.getLastSales({ limit: 10, branchId });

    // Ventas por sucursal últimos 30 días — SIEMPRE (aunque sea una sola)
    const d30 = new Date(from);
    d30.setDate(d30.getDate() - 30);
    const salesByBranch = await svc.getSalesByBranch({ from: d30, branchId });

    return res.json({
      ok: true,
      scope,
      data: {
        todayCount: todayAgg.count,
        todayTotal: todayAgg.total,
        avgTicket: todayAgg.avgTicket,

        topPaymentLabel,
        paymentsByMethod,

        salesByDay,
        lastSales,

        // ✅ canon
        salesByBranch,

        // ✅ compat
        byBranch: salesByBranch,
        salesByBranchPie: salesByBranch,
      },
    });
  } catch (e) {
    console.error("❌ [DASHBOARD SALES ERROR]", e);
    next(e);
  }
}

// ============================
// GET /api/v1/dashboard/stock
// ============================
async function stock(req, res, next) {
  try {
    const scope = svc.resolveBranchScope(req);

    if (!scope.admin && !scope.branchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const data = await svc.getStock({ branchId: scope.branchId, lowThreshold: 3 });

    return res.json({
      ok: true,
      scope,
      data,
    });
  } catch (e) {
    console.error("❌ [DASHBOARD STOCK ERROR]", e);
    next(e);
  }
}

module.exports = {
  overview,
  inventory,
  sales,
  stock,
};