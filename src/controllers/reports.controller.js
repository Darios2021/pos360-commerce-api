// src/controllers/reports.controller.js
// Reportes de ventas para liquidación de franquicias.
// - GET /reports/sales
//   Parámetros: branch_id? (number), year? (number), month? (1-12),
//               date_from? (YYYY-MM-DD), date_to? (YYYY-MM-DD), status? (PAID|ALL),
//               user_id? (number)
//   Retorna: ventas del período, agregados globales, por día y por sucursal.

const { Op, fn, col, literal } = require("sequelize");
const {
  Sale,
  SaleItem,
  Payment,
  Branch,
  User,
} = require("../models");
const access = require("../utils/accessScope");

function toInt(v, def = null) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function monthRange(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) return null;
  const from = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const to = new Date(y, m, 1, 0, 0, 0, 0); // inicio del mes siguiente
  return { from, to };
}

function parseDateStr(s) {
  if (!s) return null;
  const d = new Date(String(s));
  return isNaN(d.getTime()) ? null : d;
}

function buildName(u) {
  if (!u) return "—";
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return full || u.username || u.email || `Usuario #${u.id}`;
}

function money(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function getSalesReport(req, res, next) {
  try {
    const now = new Date();
    const qs = req.query || {};

    // Período: prioridad a date_from/date_to, si no year+month, si no mes actual.
    let from = parseDateStr(qs.date_from);
    let to = parseDateStr(qs.date_to);

    let year = toInt(qs.year);
    let month = toInt(qs.month);

    if (!from || !to) {
      if (!year) year = now.getFullYear();
      if (!month) month = now.getMonth() + 1;
      const range = monthRange(year, month);
      from = range.from;
      to = range.to;
    } else {
      // Si llegan both date_from/date_to hacemos to exclusivo al día siguiente
      to = new Date(to.getTime() + 24 * 60 * 60 * 1000);
      year = from.getFullYear();
      month = from.getMonth() + 1;
    }

    const branch_id = toInt(qs.branch_id);
    const user_id = toInt(qs.user_id);
    const statusFilter = String(qs.status || "PAID").toUpperCase();

    const where = {
      sold_at: { [Op.gte]: from, [Op.lt]: to },
    };

    if (statusFilter !== "ALL") {
      where.status = statusFilter;
    }

    // SCOPE EFECTIVO
    //  - super_admin: puede pasar branch_id y user_id libremente.
    //  - branch admin: forzado a su sucursal activa.
    //  - cajero: forzado a su sucursal + sus propias ventas (user_id = self).
    const superAdmin  = access.isSuperAdmin(req);
    const branchAdmin = access.isBranchAdmin(req);
    const ctxBranchId = access.getBranchId(req);
    const ctxUserId   = access.getUserId(req);

    if (superAdmin) {
      if (branch_id) where.branch_id = branch_id;
      if (user_id) where.user_id = user_id;
    } else {
      if (!ctxBranchId) {
        return res.status(400).json({
          ok: false,
          code: "BRANCH_REQUIRED",
          message: "No se pudo determinar la sucursal del usuario.",
        });
      }
      where.branch_id = ctxBranchId;

      if (!branchAdmin) {
        // cajero: solo sus ventas
        if (!ctxUserId) {
          return res.status(401).json({
            ok: false,
            code: "AUTH_REQUIRED",
            message: "No se pudo determinar el usuario autenticado.",
          });
        }
        where.user_id = ctxUserId;
      } else if (user_id) {
        // branch admin: opcional acotar a un cajero específico
        where.user_id = user_id;
      }
    }

    // Traer ventas con user/branch/payments
    const sales = await Sale.findAll({
      where,
      include: [
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name"],
          required: false,
        },
        {
          model: User,
          as: "user",
          attributes: ["id", "first_name", "last_name", "username", "email"],
          required: false,
        },
        {
          model: Payment,
          as: "payments",
          attributes: ["id", "method", "amount", "installments"],
          required: false,
        },
      ],
      order: [["sold_at", "ASC"]],
    });

    // items_count por venta (consulta aparte para no hacer N+1 pesados)
    const saleIds = sales.map((s) => Number(s.id));
    const itemCounts = {};
    if (saleIds.length) {
      const rows = await SaleItem.findAll({
        where: { sale_id: { [Op.in]: saleIds } },
        attributes: ["sale_id", [fn("COUNT", col("id")), "c"], [fn("SUM", col("quantity")), "q"]],
        group: ["sale_id"],
        raw: true,
      });
      for (const r of rows) {
        itemCounts[Number(r.sale_id)] = {
          count: Number(r.c || 0),
          qty: Number(r.q || 0),
        };
      }
    }

    // Mapear ventas
    const mapped = sales.map((s) => {
      const payments = Array.isArray(s.payments) ? s.payments : [];
      const methods = {};
      let maxMethod = null;
      let maxAmount = -1;
      for (const p of payments) {
        const m = String(p.method || "OTHER").toUpperCase();
        methods[m] = (methods[m] || 0) + money(p.amount);
        if (money(p.amount) > maxAmount) {
          maxAmount = money(p.amount);
          maxMethod = m;
        }
      }
      const ic = itemCounts[Number(s.id)] || { count: 0, qty: 0 };
      return {
        id: Number(s.id),
        sale_number: s.sale_number || null,
        sold_at: s.sold_at,
        status: s.status,
        customer_name: s.customer_name || null,
        customer_doc: s.customer_doc || null,
        subtotal: money(s.subtotal),
        discount_total: money(s.discount_total),
        total: money(s.total),
        paid_total: money(s.paid_total),
        branch_id: Number(s.branch_id),
        branch_name: s.branch?.name || null,
        user_id: Number(s.user_id),
        user_name: buildName(s.user),
        items_count: ic.count,
        items_qty: ic.qty,
        primary_method: maxMethod,
        payments_by_method: methods,
      };
    });

    // Summary global
    const summary = {
      sales_count: mapped.length,
      subtotal_sum: 0,
      discount_sum: 0,
      total_sum: 0,
      paid_sum: 0,
      items_count: 0,
      items_qty: 0,
      by_method: {},
    };
    for (const s of mapped) {
      summary.subtotal_sum += s.subtotal;
      summary.discount_sum += s.discount_total;
      summary.total_sum += s.total;
      summary.paid_sum += s.paid_total;
      summary.items_count += s.items_count;
      summary.items_qty += s.items_qty;
      for (const [m, amt] of Object.entries(s.payments_by_method || {})) {
        summary.by_method[m] = (summary.by_method[m] || 0) + amt;
      }
    }
    summary.subtotal_sum = money(summary.subtotal_sum);
    summary.discount_sum = money(summary.discount_sum);
    summary.total_sum = money(summary.total_sum);
    summary.paid_sum = money(summary.paid_sum);
    for (const k of Object.keys(summary.by_method)) {
      summary.by_method[k] = money(summary.by_method[k]);
    }

    // Agrupación por día
    const byDayMap = new Map();
    for (const s of mapped) {
      const d = new Date(s.sold_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const acc = byDayMap.get(key) || { date: key, sales_count: 0, total_sum: 0 };
      acc.sales_count += 1;
      acc.total_sum = money(acc.total_sum + s.total);
      byDayMap.set(key, acc);
    }
    const by_day = Array.from(byDayMap.values()).sort((a, b) => (a.date < b.date ? -1 : 1));

    // Agrupación por sucursal
    const byBranchMap = new Map();
    for (const s of mapped) {
      const key = Number(s.branch_id) || 0;
      const acc = byBranchMap.get(key) || {
        branch_id: key,
        branch_name: s.branch_name || `Sucursal #${key}`,
        sales_count: 0,
        total_sum: 0,
        subtotal_sum: 0,
        discount_sum: 0,
      };
      acc.sales_count += 1;
      acc.total_sum = money(acc.total_sum + s.total);
      acc.subtotal_sum = money(acc.subtotal_sum + s.subtotal);
      acc.discount_sum = money(acc.discount_sum + s.discount_total);
      byBranchMap.set(key, acc);
    }
    const by_branch = Array.from(byBranchMap.values()).sort(
      (a, b) => b.total_sum - a.total_sum
    );

    return res.json({
      ok: true,
      data: {
        period: {
          year,
          month,
          from: from.toISOString(),
          to: to.toISOString(),
        },
        filters: {
          branch_id: branch_id || null,
          user_id: user_id || null,
          status: statusFilter,
        },
        summary,
        by_day,
        by_branch,
        sales: mapped,
      },
    });
  } catch (e) {
    console.error("[reports.getSalesReport] error:", e);
    next(e);
  }
}

module.exports = {
  getSalesReport,
};
