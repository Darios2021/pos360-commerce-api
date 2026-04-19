// src/controllers/analytics.controller.js
// Endpoints de analytics profundo — cubre TODOS los modelos disponibles

const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");

// ─── helpers ─────────────────────────────────────────────────────────────────
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function ymd(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function startOfDay(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}
function endOfDay(d = new Date()) {
  const x = new Date(d); x.setHours(23, 59, 59, 999); return x;
}

function isAdminReq(req) {
  const u = req?.user || req?.auth || {};
  const email = String(u?.email || u?.identifier || u?.username || "").toLowerCase();
  if (email === "admin@360pos.local" || email.includes("admin@360pos.local")) return true;
  if (u?.is_admin === true || u?.isAdmin === true || u?.admin === true) return true;
  const roleNames = [];
  if (typeof u?.role === "string") roleNames.push(u.role);
  if (typeof u?.rol === "string") roleNames.push(u.rol);
  if (Array.isArray(u?.roles)) {
    for (const r of u.roles) {
      if (!r) continue;
      if (typeof r === "string") roleNames.push(r);
      else if (typeof r?.name === "string") roleNames.push(r.name);
    }
  }
  const norm = (s) => String(s || "").trim().toLowerCase();
  return roleNames.map(norm).some((x) => ["admin", "super_admin", "superadmin", "root", "owner"].includes(x));
}

function getAuthBranchId(req) {
  return (
    toInt(req?.ctx?.branchId, 0) || toInt(req?.ctx?.branch_id, 0) ||
    toInt(req?.user?.branch_id, 0) || toInt(req?.user?.branchId, 0) ||
    toInt(req?.auth?.branch_id, 0) || toInt(req?.auth?.branchId, 0) ||
    toInt(req?.branch?.id, 0) || toInt(req?.branchId, 0) ||
    toInt(req?.branchContext?.branch_id, 0) || toInt(req?.branchContext?.id, 0) || 0
  );
}

function resolveBranchScope(req) {
  const admin = isAdminReq(req);
  const qBranch = toInt(req.query.branch_id ?? req.query.branchId, 0);
  if (admin) {
    return { admin: true, branchId: qBranch > 0 ? qBranch : null, mode: qBranch > 0 ? "SINGLE_BRANCH" : "ALL_BRANCHES" };
  }
  const branchId = getAuthBranchId(req);
  return { admin: false, branchId: branchId > 0 ? branchId : null, mode: "USER_BRANCH" };
}

function normalizePeriod(p) {
  const x = String(p || "").trim().toLowerCase();
  if (["90d", "3m"].includes(x)) return "90d";
  if (["12m", "1y", "anual", "año", "year"].includes(x)) return "12m";
  if (["all", "todo", "historico"].includes(x)) return "all";
  return "30d";
}

function computeRange(period, todayFrom, todayTo) {
  const p = normalizePeriod(period);
  if (p === "all") return { period: "all", from: null, to: todayTo };
  if (p === "12m") {
    const from = new Date(todayFrom); from.setMonth(from.getMonth() - 11); from.setDate(1);
    return { period: "12m", from, to: todayTo };
  }
  const days = p === "90d" ? 90 : 30;
  const from = new Date(todayFrom); from.setDate(from.getDate() - (days - 1));
  return { period: p, from, to: todayTo };
}

function q(sql, replacements, retDefault = []) {
  return sequelize.query(sql, { type: QueryTypes.SELECT, replacements }).catch(() => retDefault);
}

function num(v) { return Number(v || 0); }

// ─── GET /analytics/cash ─────────────────────────────────────────────────────
async function cashAnalytics(req, res, next) {
  try {
    const scope = resolveBranchScope(req);
    if (!scope.admin && !scope.branchId) {
      return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED" });
    }

    const now = new Date();
    const todayFrom = startOfDay(now);
    const todayTo = endOfDay(now);
    const range = computeRange(req.query.period, todayFrom, todayTo);

    const branchCond = scope.branchId ? "AND cr.branch_id = :branchId" : "";
    const dateCondRegister = range.from
      ? "AND cr.opened_at BETWEEN :from AND :to"
      : "AND cr.opened_at <= :to";
    const replacements = { from: range.from, to: range.to, branchId: scope.branchId || null };

    // Resumen sesiones de caja
    const [sessionsSummary] = await q(
      `SELECT
        COUNT(*) AS total_sessions,
        SUM(CASE WHEN cr.status='OPEN' THEN 1 ELSE 0 END) AS open_sessions,
        SUM(CASE WHEN cr.status='CLOSED' THEN 1 ELSE 0 END) AS closed_sessions,
        COALESCE(AVG(CASE WHEN cr.status='CLOSED' THEN TIMESTAMPDIFF(MINUTE, cr.opened_at, cr.closed_at) END),0) AS avg_duration_min,
        COALESCE(SUM(cr.opening_cash),0) AS total_opening,
        COALESCE(SUM(cr.closing_cash),0) AS total_closing,
        COALESCE(SUM(cr.difference_cash),0) AS total_difference,
        COALESCE(SUM(CASE WHEN cr.difference_cash < 0 THEN cr.difference_cash ELSE 0 END),0) AS total_deficit,
        COALESCE(SUM(CASE WHEN cr.difference_cash > 0 THEN cr.difference_cash ELSE 0 END),0) AS total_surplus
      FROM cash_registers cr
      WHERE 1=1 ${branchCond} ${dateCondRegister}`,
      replacements,
      [{}]
    ).then(r => r);

    // Sesiones por día (últimos 30 días o según período)
    const sessionsByDay = await q(
      `SELECT
        DATE_FORMAT(cr.opened_at,'%Y-%m-%d') AS day,
        COUNT(*) AS sessions,
        SUM(CASE WHEN cr.status='CLOSED' THEN 1 ELSE 0 END) AS closed,
        COALESCE(AVG(cr.difference_cash),0) AS avg_diff
      FROM cash_registers cr
      WHERE 1=1 ${branchCond} ${dateCondRegister}
      GROUP BY DATE_FORMAT(cr.opened_at,'%Y-%m-%d')
      ORDER BY day ASC`,
      replacements
    );

    // Movimientos de caja IN/OUT totales del periodo
    const [movementsSummary] = await q(
      `SELECT
        COALESCE(SUM(CASE WHEN cm.type='IN' THEN cm.amount ELSE 0 END),0) AS total_in,
        COALESCE(SUM(CASE WHEN cm.type='OUT' THEN cm.amount ELSE 0 END),0) AS total_out,
        COUNT(CASE WHEN cm.type='IN' THEN 1 END) AS count_in,
        COUNT(CASE WHEN cm.type='OUT' THEN 1 END) AS count_out
      FROM cash_movements cm
      INNER JOIN cash_registers cr ON cr.id = cm.cash_register_id
      WHERE 1=1 ${branchCond} ${dateCondRegister}`,
      replacements,
      [{}]
    ).then(r => r);

    // Movimientos por razón
    const movementsByReason = await q(
      `SELECT
        cm.reason,
        cm.type,
        COUNT(*) AS cnt,
        COALESCE(SUM(cm.amount),0) AS total
      FROM cash_movements cm
      INNER JOIN cash_registers cr ON cr.id = cm.cash_register_id
      WHERE 1=1 ${branchCond} ${dateCondRegister}
      GROUP BY cm.reason, cm.type
      ORDER BY total DESC
      LIMIT 20`,
      replacements
    );

    // Movimientos por día (para gráfico)
    const movementsByDay = await q(
      `SELECT
        DATE_FORMAT(cm.happened_at,'%Y-%m-%d') AS day,
        COALESCE(SUM(CASE WHEN cm.type='IN' THEN cm.amount ELSE 0 END),0) AS total_in,
        COALESCE(SUM(CASE WHEN cm.type='OUT' THEN cm.amount ELSE 0 END),0) AS total_out
      FROM cash_movements cm
      INNER JOIN cash_registers cr ON cr.id = cm.cash_register_id
      WHERE 1=1 ${branchCond} ${dateCondRegister}
      GROUP BY DATE_FORMAT(cm.happened_at,'%Y-%m-%d')
      ORDER BY day ASC`,
      replacements
    );

    // Diferencias históricas por sucursal (para scatter)
    const differenceByBranch = await q(
      `SELECT
        cr.branch_id,
        b.name AS branch_name,
        COUNT(*) AS sessions,
        COALESCE(AVG(cr.difference_cash),0) AS avg_diff,
        COALESCE(SUM(CASE WHEN cr.difference_cash < 0 THEN 1 ELSE 0 END),0) AS deficit_count,
        COALESCE(SUM(CASE WHEN cr.difference_cash > 0 THEN 1 ELSE 0 END),0) AS surplus_count,
        COALESCE(SUM(CASE WHEN cr.difference_cash = 0 OR cr.difference_cash IS NULL THEN 1 ELSE 0 END),0) AS exact_count
      FROM cash_registers cr
      LEFT JOIN branches b ON b.id = cr.branch_id
      WHERE cr.status='CLOSED' ${branchCond} ${dateCondRegister}
      GROUP BY cr.branch_id, b.name
      ORDER BY sessions DESC`,
      replacements
    );

    // Últimas 15 sesiones
    const lastSessions = await q(
      `SELECT
        cr.id, cr.branch_id, b.name AS branch_name,
        cr.status, cr.opening_cash, cr.closing_cash, cr.expected_cash, cr.difference_cash,
        cr.opened_at, cr.closed_at,
        TIMESTAMPDIFF(MINUTE, cr.opened_at, cr.closed_at) AS duration_min,
        u1.first_name AS opened_by_name,
        u2.first_name AS closed_by_name
      FROM cash_registers cr
      LEFT JOIN branches b ON b.id = cr.branch_id
      LEFT JOIN users u1 ON u1.id = cr.opened_by
      LEFT JOIN users u2 ON u2.id = cr.closed_by
      WHERE 1=1 ${branchCond}
      ORDER BY cr.id DESC
      LIMIT 15`,
      { branchId: scope.branchId || null }
    );

    return res.json({
      ok: true,
      scope,
      data: {
        sessions: {
          total: num(sessionsSummary?.total_sessions),
          open: num(sessionsSummary?.open_sessions),
          closed: num(sessionsSummary?.closed_sessions),
          avgDurationMin: num(sessionsSummary?.avg_duration_min),
          totalOpening: num(sessionsSummary?.total_opening),
          totalClosing: num(sessionsSummary?.total_closing),
          totalDifference: num(sessionsSummary?.total_difference),
          totalDeficit: num(sessionsSummary?.total_deficit),
          totalSurplus: num(sessionsSummary?.total_surplus),
        },
        sessionsByDay: (sessionsByDay || []).map(r => ({
          day: r.day, sessions: num(r.sessions), closed: num(r.closed), avgDiff: num(r.avg_diff),
        })),
        movements: {
          totalIn: num(movementsSummary?.total_in),
          totalOut: num(movementsSummary?.total_out),
          countIn: num(movementsSummary?.count_in),
          countOut: num(movementsSummary?.count_out),
          net: num(movementsSummary?.total_in) - num(movementsSummary?.total_out),
        },
        movementsByReason: (movementsByReason || []).map(r => ({
          reason: r.reason, type: r.type, count: num(r.cnt), total: num(r.total),
        })),
        movementsByDay: (movementsByDay || []).map(r => ({
          day: r.day, totalIn: num(r.total_in), totalOut: num(r.total_out),
        })),
        differenceByBranch: (differenceByBranch || []).map(r => ({
          branch_id: num(r.branch_id), branch_name: r.branch_name || `Sucursal #${r.branch_id}`,
          sessions: num(r.sessions), avgDiff: num(r.avg_diff),
          deficitCount: num(r.deficit_count), surplusCount: num(r.surplus_count), exactCount: num(r.exact_count),
        })),
        lastSessions: (lastSessions || []).map(r => ({
          id: num(r.id), branch_id: num(r.branch_id), branch_name: r.branch_name,
          status: r.status, opening_cash: num(r.opening_cash), closing_cash: num(r.closing_cash),
          expected_cash: num(r.expected_cash), difference_cash: num(r.difference_cash),
          opened_at: r.opened_at, closed_at: r.closed_at, duration_min: num(r.duration_min),
          opened_by: r.opened_by_name, closed_by: r.closed_by_name,
        })),
      },
    });
  } catch (e) {
    console.error("❌ [ANALYTICS CASH]", e);
    next(e);
  }
}

// ─── GET /analytics/sales ────────────────────────────────────────────────────
async function salesDeep(req, res, next) {
  try {
    const scope = resolveBranchScope(req);
    if (!scope.admin && !scope.branchId) {
      return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED" });
    }

    const now = new Date();
    const todayFrom = startOfDay(now);
    const todayTo = endOfDay(now);
    const range = computeRange(req.query.period, todayFrom, todayTo);

    const branchCond = scope.branchId ? "AND s.branch_id = :branchId" : "";
    const dateCond = range.from ? "AND s.sold_at BETWEEN :from AND :to" : "AND s.sold_at <= :to";
    const rep = { from: range.from, to: range.to, branchId: scope.branchId || null };

    // Por condición fiscal del cliente
    const byTaxCondition = await q(
      `SELECT
        COALESCE(s.customer_tax_condition,'SIN_DATO') AS tax_condition,
        COUNT(*) AS cnt,
        COALESCE(SUM(s.total),0) AS sum_total
      FROM sales s
      WHERE s.status='PAID' ${dateCond} ${branchCond}
      GROUP BY COALESCE(s.customer_tax_condition,'SIN_DATO')
      ORDER BY cnt DESC`,
      rep
    );

    // Por tipo de cliente
    const byCustomerType = await q(
      `SELECT
        COALESCE(s.customer_type,'SIN_DATO') AS customer_type,
        COUNT(*) AS cnt,
        COALESCE(SUM(s.total),0) AS sum_total
      FROM sales s
      WHERE s.status='PAID' ${dateCond} ${branchCond}
      GROUP BY COALESCE(s.customer_type,'SIN_DATO')
      ORDER BY cnt DESC`,
      rep
    );

    // Por estado fiscal (invoice_mode)
    const byInvoiceMode = await q(
      `SELECT
        COALESCE(s.invoice_mode,'SIN_DATO') AS invoice_mode,
        COUNT(*) AS cnt,
        COALESCE(SUM(s.total),0) AS sum_total
      FROM sales s
      WHERE s.status='PAID' ${dateCond} ${branchCond}
      GROUP BY COALESCE(s.invoice_mode,'SIN_DATO')
      ORDER BY cnt DESC`,
      rep
    );

    // Análisis de descuentos
    const [discountAnalysis] = await q(
      `SELECT
        COUNT(*) AS total_sales,
        SUM(CASE WHEN s.discount_total > 0 THEN 1 ELSE 0 END) AS sales_with_discount,
        COALESCE(SUM(s.discount_total),0) AS total_discounted,
        COALESCE(AVG(CASE WHEN s.discount_total > 0 THEN s.discount_total END),0) AS avg_discount,
        COALESCE(MAX(s.discount_total),0) AS max_discount,
        COALESCE(SUM(s.tax_total),0) AS total_tax
      FROM sales s
      WHERE s.status='PAID' ${dateCond} ${branchCond}`,
      rep,
      [{}]
    ).then(r => r);

    // Análisis promedio de ítems por venta
    const [itemsAnalysis] = await q(
      `SELECT
        COALESCE(AVG(item_counts.cnt),0) AS avg_items_per_sale,
        COALESCE(MAX(item_counts.cnt),0) AS max_items_per_sale,
        COALESCE(MIN(item_counts.cnt),0) AS min_items_per_sale
      FROM (
        SELECT si.sale_id, COUNT(*) AS cnt
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
        WHERE s.status='PAID' ${dateCond} ${branchCond}
        GROUP BY si.sale_id
      ) AS item_counts`,
      rep,
      [{}]
    ).then(r => r);

    // Heatmap hora x día de semana (0=Lun..6=Dom)
    const heatmapRows = await q(
      `SELECT
        HOUR(s.sold_at) AS h,
        WEEKDAY(s.sold_at) AS dow,
        COUNT(*) AS cnt,
        COALESCE(SUM(s.total),0) AS sum_total
      FROM sales s
      WHERE s.status='PAID' ${dateCond} ${branchCond}
      GROUP BY HOUR(s.sold_at), WEEKDAY(s.sold_at)
      ORDER BY dow ASC, h ASC`,
      rep
    );
    // Construir matriz 7x24
    const heatmap = [];
    for (let dow = 0; dow < 7; dow++) {
      for (let h = 0; h < 24; h++) {
        const row = (heatmapRows || []).find(r => num(r.h) === h && num(r.dow) === dow);
        heatmap.push({ dow, hour: h, count: num(row?.cnt), total: num(row?.sum_total) });
      }
    }

    // Tendencia de métodos de pago por mes (últimos 12)
    const twelveMonthsAgo = new Date(todayFrom);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    const paymentTrendRows = await q(
      `SELECT
        DATE_FORMAT(s.sold_at,'%Y-%m') AS ym,
        p.method,
        COALESCE(SUM(p.amount),0) AS sum_amount
      FROM payments p
      INNER JOIN sales s ON s.id = p.sale_id
      WHERE s.status='PAID'
        AND s.sold_at BETWEEN :tFrom AND :tTo
        ${scope.branchId ? "AND s.branch_id = :branchId" : ""}
      GROUP BY DATE_FORMAT(s.sold_at,'%Y-%m'), p.method
      ORDER BY ym ASC`,
      { tFrom: twelveMonthsAgo, tTo: todayTo, branchId: scope.branchId || null }
    );

    // Ventas canceladas (CANCELLED)
    const [cancelledSummary] = await q(
      `SELECT
        COUNT(*) AS cnt,
        COALESCE(SUM(s.total),0) AS sum_total
      FROM sales s
      WHERE s.status='CANCELLED' ${dateCond} ${branchCond}`,
      rep,
      [{}]
    ).then(r => r);

    // Devoluciones (refunds)
    const [refundsSummary] = await q(
      `SELECT
        COUNT(*) AS cnt,
        COALESCE(SUM(sr.amount),0) AS sum_amount,
        COALESCE(AVG(sr.amount),0) AS avg_amount
      FROM sale_refunds sr
      WHERE sr.created_at BETWEEN :from AND :to
        ${scope.branchId ? "AND sr.branch_id = :branchId" : ""}`,
      { from: range.from || new Date(0), to: range.to, branchId: scope.branchId || null },
      [{}]
    ).then(r => r);

    const refundsByMethod = await q(
      `SELECT
        COALESCE(sr.refund_method,'OTHER') AS refund_method,
        COUNT(*) AS cnt,
        COALESCE(SUM(sr.amount),0) AS sum_amount
      FROM sale_refunds sr
      WHERE sr.created_at BETWEEN :from AND :to
        ${scope.branchId ? "AND sr.branch_id = :branchId" : ""}
      GROUP BY COALESCE(sr.refund_method,'OTHER')
      ORDER BY sum_amount DESC`,
      { from: range.from || new Date(0), to: range.to, branchId: scope.branchId || null }
    );

    // Ticket promedio por dia de semana
    const avgTicketByDow = await q(
      `SELECT
        WEEKDAY(s.sold_at) AS dow,
        COALESCE(AVG(s.total),0) AS avg_ticket,
        COUNT(*) AS cnt
      FROM sales s
      WHERE s.status='PAID' ${dateCond} ${branchCond}
      GROUP BY WEEKDAY(s.sold_at)
      ORDER BY dow ASC`,
      rep
    );

    // Top clientes (por nombre)
    const topCustomers = await q(
      `SELECT
        COALESCE(s.customer_name,'Consumidor Final') AS customer_name,
        COALESCE(s.customer_doc,'—') AS customer_doc,
        COUNT(*) AS cnt,
        COALESCE(SUM(s.total),0) AS sum_total,
        COALESCE(AVG(s.total),0) AS avg_ticket
      FROM sales s
      WHERE s.status='PAID'
        AND s.customer_name IS NOT NULL
        AND s.customer_name != ''
        ${dateCond} ${branchCond}
      GROUP BY s.customer_name, s.customer_doc
      ORDER BY sum_total DESC
      LIMIT 15`,
      rep
    );

    // Ventas por moneda
    const byCurrency = await q(
      `SELECT
        s.currency_code,
        COUNT(*) AS cnt,
        COALESCE(SUM(s.total),0) AS sum_total
      FROM sales s
      WHERE s.status='PAID' ${dateCond} ${branchCond}
      GROUP BY s.currency_code
      ORDER BY cnt DESC`,
      rep
    );

    return res.json({
      ok: true,
      scope,
      data: {
        byTaxCondition: (byTaxCondition || []).map(r => ({
          label: r.tax_condition, count: num(r.cnt), total: num(r.sum_total),
        })),
        byCustomerType: (byCustomerType || []).map(r => ({
          label: r.customer_type, count: num(r.cnt), total: num(r.sum_total),
        })),
        byInvoiceMode: (byInvoiceMode || []).map(r => ({
          label: r.invoice_mode, count: num(r.cnt), total: num(r.sum_total),
        })),
        discounts: {
          totalSales: num(discountAnalysis?.total_sales),
          salesWithDiscount: num(discountAnalysis?.sales_with_discount),
          totalDiscounted: num(discountAnalysis?.total_discounted),
          avgDiscount: num(discountAnalysis?.avg_discount),
          maxDiscount: num(discountAnalysis?.max_discount),
          totalTax: num(discountAnalysis?.total_tax),
          discountRate: num(discountAnalysis?.total_sales) > 0
            ? (num(discountAnalysis?.sales_with_discount) / num(discountAnalysis?.total_sales)) * 100
            : 0,
        },
        items: {
          avgItemsPerSale: num(itemsAnalysis?.avg_items_per_sale),
          maxItemsPerSale: num(itemsAnalysis?.max_items_per_sale),
          minItemsPerSale: num(itemsAnalysis?.min_items_per_sale),
        },
        heatmap,
        paymentTrend: (paymentTrendRows || []).map(r => ({
          ym: r.ym, method: String(r.method || "").toUpperCase(), total: num(r.sum_amount),
        })),
        cancelled: { count: num(cancelledSummary?.cnt), total: num(cancelledSummary?.sum_total) },
        refunds: {
          count: num(refundsSummary?.cnt),
          total: num(refundsSummary?.sum_amount),
          avg: num(refundsSummary?.avg_amount),
          byMethod: (refundsByMethod || []).map(r => ({
            method: r.refund_method, count: num(r.cnt), total: num(r.sum_amount),
          })),
        },
        avgTicketByDow: Array.from({ length: 7 }, (_, dow) => {
          const r = (avgTicketByDow || []).find(x => num(x.dow) === dow);
          return { dow, avgTicket: num(r?.avg_ticket), count: num(r?.cnt) };
        }),
        topCustomers: (topCustomers || []).map(r => ({
          name: r.customer_name, doc: r.customer_doc, count: num(r.cnt),
          total: num(r.sum_total), avgTicket: num(r.avg_ticket),
        })),
        byCurrency: (byCurrency || []).map(r => ({
          currency: r.currency_code, count: num(r.cnt), total: num(r.sum_total),
        })),
      },
    });
  } catch (e) {
    console.error("❌ [ANALYTICS SALES DEEP]", e);
    next(e);
  }
}

// ─── GET /analytics/products ─────────────────────────────────────────────────
async function productsDeep(req, res, next) {
  try {
    const scope = resolveBranchScope(req);
    if (!scope.admin && !scope.branchId) {
      return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED" });
    }

    const branchCond = scope.branchId ? "AND p.branch_id = :branchId" : "";
    const rep = { branchId: scope.branchId || null };

    // Por marca (top 15)
    const byBrand = await q(
      `SELECT
        COALESCE(NULLIF(TRIM(p.brand),''),'Sin marca') AS brand,
        COUNT(*) AS cnt,
        SUM(CASE WHEN p.is_active=1 THEN 1 ELSE 0 END) AS active_cnt,
        COALESCE(AVG(CASE WHEN p.price>0 THEN p.price END),0) AS avg_price,
        COALESCE(AVG(CASE WHEN p.cost>0 THEN p.cost END),0) AS avg_cost
      FROM products p
      WHERE 1=1 ${branchCond}
      GROUP BY COALESCE(NULLIF(TRIM(p.brand),''),'Sin marca')
      ORDER BY cnt DESC
      LIMIT 15`,
      rep
    );

    // Nunca vendidos
    const [neverSold] = await q(
      `SELECT COUNT(*) AS cnt
      FROM products p
      WHERE p.is_active=1 ${branchCond}
        AND NOT EXISTS (
          SELECT 1 FROM sale_items si
          INNER JOIN sales s ON s.id = si.sale_id
          WHERE si.product_id = p.id AND s.status='PAID'
        )`,
      rep,
      [{ cnt: 0 }]
    ).then(r => r);

    // Top 15 productos por margen absoluto
    const topByMargin = await q(
      `SELECT
        p.id, p.name, p.sku,
        COALESCE(p.cost,0) AS cost,
        COALESCE(p.price_list, p.price, 0) AS price,
        COALESCE(p.price_list, p.price, 0) - COALESCE(p.cost,0) AS margin_abs,
        CASE WHEN COALESCE(p.price_list, p.price, 0) > 0
          THEN (COALESCE(p.price_list, p.price, 0) - COALESCE(p.cost,0)) / COALESCE(p.price_list, p.price, 0) * 100
          ELSE 0
        END AS margin_pct
      FROM products p
      WHERE p.is_active=1 AND COALESCE(p.cost,0) > 0 ${branchCond}
      ORDER BY margin_abs DESC
      LIMIT 15`,
      rep
    );

    // Top 15 productos por margen %
    const topByMarginPct = await q(
      `SELECT
        p.id, p.name, p.sku,
        COALESCE(p.cost,0) AS cost,
        COALESCE(p.price_list, p.price, 0) AS price,
        COALESCE(p.price_list, p.price, 0) - COALESCE(p.cost,0) AS margin_abs,
        CASE WHEN COALESCE(p.price_list, p.price, 0) > 0
          THEN (COALESCE(p.price_list, p.price, 0) - COALESCE(p.cost,0)) / COALESCE(p.price_list, p.price, 0) * 100
          ELSE 0
        END AS margin_pct
      FROM products p
      WHERE p.is_active=1 AND COALESCE(p.cost,0) > 0
        AND COALESCE(p.price_list, p.price, 0) > 0 ${branchCond}
      ORDER BY margin_pct DESC
      LIMIT 15`,
      rep
    );

    // Histograma de rangos de precio (10 buckets)
    const priceRanges = await q(
      `SELECT
        CASE
          WHEN COALESCE(p.price_list,p.price,0) = 0 THEN 'Sin precio'
          WHEN COALESCE(p.price_list,p.price,0) < 1000 THEN '< $1.000'
          WHEN COALESCE(p.price_list,p.price,0) < 5000 THEN '$1.000–5.000'
          WHEN COALESCE(p.price_list,p.price,0) < 10000 THEN '$5.000–10.000'
          WHEN COALESCE(p.price_list,p.price,0) < 25000 THEN '$10.000–25.000'
          WHEN COALESCE(p.price_list,p.price,0) < 50000 THEN '$25.000–50.000'
          WHEN COALESCE(p.price_list,p.price,0) < 100000 THEN '$50.000–100.000'
          WHEN COALESCE(p.price_list,p.price,0) < 500000 THEN '$100k–500k'
          ELSE '> $500.000'
        END AS price_range,
        COUNT(*) AS cnt
      FROM products p
      WHERE p.is_active=1 ${branchCond}
      GROUP BY price_range
      ORDER BY MIN(COALESCE(p.price_list,p.price,0)) ASC`,
      rep
    );

    // Crecimiento del catálogo por mes (últimos 12)
    const catalogGrowth = await q(
      `SELECT
        DATE_FORMAT(p.created_at,'%Y-%m') AS ym,
        COUNT(*) AS cnt
      FROM products p
      WHERE p.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH) ${branchCond}
      GROUP BY DATE_FORMAT(p.created_at,'%Y-%m')
      ORDER BY ym ASC`,
      rep
    );

    // Productos sin precio activos
    const noPriceActive = await q(
      `SELECT
        c.name AS category_name,
        COUNT(*) AS cnt
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active=1
        AND COALESCE(p.price_list,0)<=0 AND COALESCE(p.price,0)<=0
        ${branchCond}
      GROUP BY c.name
      ORDER BY cnt DESC
      LIMIT 10`,
      rep
    );

    // Por subcategoría
    const bySubcategory = await q(
      `SELECT
        sc.name AS subcategory_name,
        COUNT(p.id) AS cnt,
        SUM(CASE WHEN p.is_active=1 THEN 1 ELSE 0 END) AS active_cnt
      FROM products p
      LEFT JOIN subcategories sc ON sc.id = p.subcategory_id
      WHERE p.subcategory_id IS NOT NULL ${branchCond}
      GROUP BY sc.name
      ORDER BY cnt DESC
      LIMIT 15`,
      rep
    );

    // Productos con track_stock=false
    const [noTrackStock] = await q(
      `SELECT COUNT(*) AS cnt FROM products p WHERE p.track_stock=0 ${branchCond}`,
      rep,
      [{ cnt: 0 }]
    ).then(r => r);

    // En promoción / nuevos
    const [promoNew] = await q(
      `SELECT
        SUM(CASE WHEN p.is_promo=1 THEN 1 ELSE 0 END) AS promo_cnt,
        SUM(CASE WHEN p.is_new=1 THEN 1 ELSE 0 END) AS new_cnt
      FROM products p
      WHERE p.is_active=1 ${branchCond}`,
      rep,
      [{}]
    ).then(r => r);

    return res.json({
      ok: true,
      scope,
      data: {
        byBrand: (byBrand || []).map(r => ({
          brand: r.brand, count: num(r.cnt), activeCount: num(r.active_cnt),
          avgPrice: num(r.avg_price), avgCost: num(r.avg_cost),
        })),
        neverSold: num(neverSold?.cnt),
        topByMargin: (topByMargin || []).map(r => ({
          id: num(r.id), name: r.name, sku: r.sku,
          cost: num(r.cost), price: num(r.price),
          marginAbs: num(r.margin_abs), marginPct: num(r.margin_pct),
        })),
        topByMarginPct: (topByMarginPct || []).map(r => ({
          id: num(r.id), name: r.name, sku: r.sku,
          cost: num(r.cost), price: num(r.price),
          marginAbs: num(r.margin_abs), marginPct: num(r.margin_pct),
        })),
        priceRanges: (priceRanges || []).map(r => ({ range: r.price_range, count: num(r.cnt) })),
        catalogGrowth: (catalogGrowth || []).map(r => ({ ym: r.ym, count: num(r.cnt) })),
        noPriceActive: (noPriceActive || []).map(r => ({ category: r.category_name || "Sin categoría", count: num(r.cnt) })),
        bySubcategory: (bySubcategory || []).map(r => ({
          subcategory: r.subcategory_name, count: num(r.cnt), activeCount: num(r.active_cnt),
        })),
        flags: {
          noTrackStock: num(noTrackStock?.cnt),
          promoCount: num(promoNew?.promo_cnt),
          newCount: num(promoNew?.new_cnt),
        },
      },
    });
  } catch (e) {
    console.error("❌ [ANALYTICS PRODUCTS DEEP]", e);
    next(e);
  }
}

// ─── GET /analytics/stock-movements ─────────────────────────────────────────
async function stockMovementsDeep(req, res, next) {
  try {
    const scope = resolveBranchScope(req);
    if (!scope.admin && !scope.branchId) {
      return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED" });
    }

    const now = new Date();
    const todayFrom = startOfDay(now);
    const todayTo = endOfDay(now);
    const range = computeRange(req.query.period, todayFrom, todayTo);

    const branchCondW = scope.branchId ? "AND w.branch_id = :branchId" : "";
    const dateCondM = range.from ? "AND sm.created_at BETWEEN :from AND :to" : "AND sm.created_at <= :to";
    const rep = { from: range.from, to: range.to, branchId: scope.branchId || null };

    // Resumen por tipo de movimiento
    const byType = await q(
      `SELECT
        sm.type,
        COUNT(DISTINCT sm.id) AS movement_cnt,
        COALESCE(SUM(smi.qty),0) AS total_qty,
        COALESCE(SUM(smi.qty * COALESCE(smi.unit_cost,0)),0) AS total_cost_value
      FROM stock_movements sm
      LEFT JOIN stock_movement_items smi ON smi.movement_id = sm.id
      LEFT JOIN warehouses w ON w.id = sm.warehouse_id
      WHERE 1=1 ${branchCondW} ${dateCondM}
      GROUP BY sm.type
      ORDER BY movement_cnt DESC`,
      rep
    );

    // Timeline diario de movimientos IN vs OUT (últimos días del periodo)
    const movementTimeline = await q(
      `SELECT
        DATE_FORMAT(sm.created_at,'%Y-%m-%d') AS day,
        COALESCE(SUM(CASE WHEN sm.type IN ('in','adjustment') AND smi.qty > 0 THEN smi.qty ELSE 0 END),0) AS qty_in,
        COALESCE(SUM(CASE WHEN sm.type = 'out' OR (sm.type='adjustment' AND smi.qty < 0) THEN ABS(smi.qty) ELSE 0 END),0) AS qty_out,
        COUNT(DISTINCT sm.id) AS movement_cnt
      FROM stock_movements sm
      LEFT JOIN stock_movement_items smi ON smi.movement_id = sm.id
      LEFT JOIN warehouses w ON w.id = sm.warehouse_id
      WHERE 1=1 ${branchCondW} ${dateCondM}
      GROUP BY DATE_FORMAT(sm.created_at,'%Y-%m-%d')
      ORDER BY day ASC`,
      rep
    );

    // Top 10 productos más movidos (entradas)
    const topInProducts = await q(
      `SELECT
        smi.product_id,
        COALESCE(p.name, CONCAT('Producto #',smi.product_id)) AS product_name,
        p.sku,
        COALESCE(SUM(smi.qty),0) AS total_qty,
        COALESCE(SUM(smi.qty * COALESCE(smi.unit_cost,0)),0) AS total_cost
      FROM stock_movement_items smi
      INNER JOIN stock_movements sm ON sm.id = smi.movement_id AND sm.type='in'
      LEFT JOIN warehouses w ON w.id = sm.warehouse_id
      LEFT JOIN products p ON p.id = smi.product_id
      WHERE 1=1 ${branchCondW} ${dateCondM}
      GROUP BY smi.product_id, product_name, sku
      ORDER BY total_qty DESC
      LIMIT 10`,
      rep
    );

    // Top 10 productos más vendidos/salidos
    const topOutProducts = await q(
      `SELECT
        smi.product_id,
        COALESCE(p.name, CONCAT('Producto #',smi.product_id)) AS product_name,
        p.sku,
        COALESCE(SUM(ABS(smi.qty)),0) AS total_qty
      FROM stock_movement_items smi
      INNER JOIN stock_movements sm ON sm.id = smi.movement_id AND sm.type='out'
      LEFT JOIN warehouses w ON w.id = sm.warehouse_id
      LEFT JOIN products p ON p.id = smi.product_id
      WHERE 1=1 ${branchCondW} ${dateCondM}
      GROUP BY smi.product_id, product_name, sku
      ORDER BY total_qty DESC
      LIMIT 10`,
      rep
    );

    // Stock por categoría
    const stockByCategory = await q(
      `SELECT
        COALESCE(c.name,'Sin categoría') AS category_name,
        COUNT(DISTINCT sb.product_id) AS product_cnt,
        COALESCE(SUM(sb.qty),0) AS total_qty,
        COALESCE(SUM(sb.qty * LEAST(COALESCE(NULLIF(p.price_list,0), p.price, 0), 99999999)),0) AS price_value,
        COALESCE(SUM(sb.qty * COALESCE(p.cost, 0)),0) AS cost_value
      FROM stock_balances sb
      INNER JOIN warehouses w ON w.id = sb.warehouse_id
      LEFT JOIN products p ON p.id = sb.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE sb.qty > 0 ${branchCondW}
      GROUP BY COALESCE(c.name,'Sin categoría')
      ORDER BY total_qty DESC
      LIMIT 15`,
      { branchId: scope.branchId || null }
    );

    // Stock por subcategoría
    const stockBySubCategory = await q(
      `SELECT
        COALESCE(sc.name,'Sin subcategoría') AS subcategory_name,
        COALESCE(c.name,'Sin categoría') AS category_name,
        COUNT(DISTINCT sb.product_id) AS product_cnt,
        COALESCE(SUM(sb.qty),0) AS total_qty,
        COALESCE(SUM(sb.qty * LEAST(COALESCE(NULLIF(p.price_list,0), p.price, 0), 99999999)),0) AS price_value
      FROM stock_balances sb
      INNER JOIN warehouses w ON w.id = sb.warehouse_id
      LEFT JOIN products p ON p.id = sb.product_id
      LEFT JOIN subcategories sc ON sc.id = p.subcategory_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE sb.qty > 0 ${branchCondW}
      GROUP BY COALESCE(sc.name,'Sin subcategoría'), COALESCE(c.name,'Sin categoría')
      ORDER BY total_qty DESC
      LIMIT 20`,
      { branchId: scope.branchId || null }
    );

    // Días estimados de inventario por producto (stock actual / promedio ventas diarias)
    const daysOfInventory = await q(
      `SELECT
        p.id, p.name, p.sku,
        COALESCE(SUM(sb.qty),0) AS current_stock,
        COALESCE(AVG(daily_sales.daily_qty),0) AS avg_daily_sales,
        CASE
          WHEN COALESCE(AVG(daily_sales.daily_qty),0) > 0
          THEN COALESCE(SUM(sb.qty),0) / COALESCE(AVG(daily_sales.daily_qty),0)
          ELSE NULL
        END AS days_remaining
      FROM products p
      INNER JOIN stock_balances sb ON sb.product_id = p.id
      INNER JOIN warehouses w ON w.id = sb.warehouse_id
      LEFT JOIN (
        SELECT
          si.product_id,
          SUM(si.quantity) / GREATEST(DATEDIFF(NOW(), DATE_SUB(NOW(), INTERVAL 30 DAY)), 1) AS daily_qty
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
        WHERE s.status='PAID' AND s.sold_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY si.product_id
      ) AS daily_sales ON daily_sales.product_id = p.id
      WHERE sb.qty > 0 ${branchCondW}
      GROUP BY p.id, p.name, p.sku
      HAVING avg_daily_sales > 0
      ORDER BY days_remaining ASC
      LIMIT 20`,
      { branchId: scope.branchId || null }
    );

    // Ajustes de stock (tipo adjustment)
    const adjustmentSummary = await q(
      `SELECT
        DATE_FORMAT(sm.created_at,'%Y-%m-%d') AS day,
        COUNT(DISTINCT sm.id) AS adj_cnt,
        COALESCE(SUM(CASE WHEN smi.qty > 0 THEN smi.qty ELSE 0 END),0) AS qty_positive,
        COALESCE(SUM(CASE WHEN smi.qty < 0 THEN ABS(smi.qty) ELSE 0 END),0) AS qty_negative
      FROM stock_movements sm
      LEFT JOIN stock_movement_items smi ON smi.movement_id = sm.id
      LEFT JOIN warehouses w ON w.id = sm.warehouse_id
      WHERE sm.type='adjustment' ${branchCondW} ${dateCondM}
      GROUP BY DATE_FORMAT(sm.created_at,'%Y-%m-%d')
      ORDER BY day ASC`,
      rep
    );

    return res.json({
      ok: true,
      scope,
      data: {
        byType: (byType || []).map(r => ({
          type: r.type, movements: num(r.movement_cnt),
          totalQty: num(r.total_qty), totalCostValue: num(r.total_cost_value),
        })),
        timeline: (movementTimeline || []).map(r => ({
          day: r.day, qtyIn: num(r.qty_in), qtyOut: num(r.qty_out), movements: num(r.movement_cnt),
        })),
        topInProducts: (topInProducts || []).map(r => ({
          product_id: num(r.product_id), name: r.product_name, sku: r.sku,
          totalQty: num(r.total_qty), totalCost: num(r.total_cost),
        })),
        topOutProducts: (topOutProducts || []).map(r => ({
          product_id: num(r.product_id), name: r.product_name, sku: r.sku,
          totalQty: num(r.total_qty),
        })),
        stockByCategory: (stockByCategory || []).map(r => ({
          category: r.category_name, products: num(r.product_cnt),
          totalQty: num(r.total_qty), priceValue: num(r.price_value), costValue: num(r.cost_value),
        })),
        stockBySubCategory: (stockBySubCategory || []).map(r => ({
          subcategory: r.subcategory_name, category: r.category_name, products: num(r.product_cnt),
          totalQty: num(r.total_qty), priceValue: num(r.price_value),
        })),
        daysOfInventory: (daysOfInventory || []).map(r => ({
          id: num(r.id), name: r.name, sku: r.sku,
          currentStock: num(r.current_stock),
          avgDailySales: num(r.avg_daily_sales),
          daysRemaining: r.days_remaining !== null ? num(r.days_remaining) : null,
        })),
        adjustments: (adjustmentSummary || []).map(r => ({
          day: r.day, count: num(r.adj_cnt),
          positive: num(r.qty_positive), negative: num(r.qty_negative),
        })),
      },
    });
  } catch (e) {
    console.error("❌ [ANALYTICS STOCK MOVEMENTS]", e);
    next(e);
  }
}

module.exports = { cashAnalytics, salesDeep, productsDeep, stockMovementsDeep };
