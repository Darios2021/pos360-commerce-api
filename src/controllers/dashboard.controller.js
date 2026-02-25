// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/dashboard.controller.js

const { Op, fn, col, literal, QueryTypes } = require("sequelize");
const {
  sequelize,
  Product,
  Category,
  Sale,
  SaleItem,
  Payment,
  Branch,
  User,
  Warehouse,
  StockBalance,
  StockMovement,
} = require("../models");

// =========================
// Helpers
// =========================
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

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

function pickExistingAttrs(model, candidates, always = ["id"]) {
  const attrs = [];
  for (const a of always) if (model?.rawAttributes?.[a]) attrs.push(a);
  for (const a of candidates) if (model?.rawAttributes?.[a]) attrs.push(a);
  return attrs.length ? attrs : ["id"];
}

/**
 * ✅ branch_id desde contexto/auth (mismo criterio que POS)
 */
function getAuthBranchId(req) {
  return (
    toInt(req?.ctx?.branchId, 0) ||
    toInt(req?.ctx?.branch_id, 0) ||
    toInt(req?.user?.branch_id, 0) ||
    toInt(req?.user?.branchId, 0) ||
    toInt(req?.auth?.branch_id, 0) ||
    toInt(req?.auth?.branchId, 0) ||
    toInt(req?.branch?.id, 0) ||
    toInt(req?.branchId, 0) ||
    toInt(req?.branchContext?.branch_id, 0) ||
    toInt(req?.branchContext?.id, 0) ||
    0
  );
}

/**
 * ✅ Admin detector robusto
 */
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
      else if (typeof r?.role === "string") roleNames.push(r.role);
      else if (typeof r?.role?.name === "string") roleNames.push(r.role.name);
    }
  }

  const norm = (s) => String(s || "").trim().toLowerCase();
  return roleNames.map(norm).some((x) => ["admin", "super_admin", "superadmin", "root", "owner"].includes(x));
}

/**
 * ✅ Decide scope de sucursal:
 * - Admin: todas (si no manda branch_id) o filtra (si manda branch_id)
 * - No-admin: obligado a su branch (desde auth)
 */
function resolveBranchScope(req) {
  const admin = isAdminReq(req);
  const qBranch = toInt(req.query.branch_id ?? req.query.branchId, 0);

  if (admin) {
    return {
      admin: true,
      branchId: qBranch > 0 ? qBranch : null,
      mode: qBranch > 0 ? "SINGLE_BRANCH" : "ALL_BRANCHES",
    };
  }

  const branchId = getAuthBranchId(req);
  return {
    admin: false,
    branchId: branchId > 0 ? branchId : null,
    mode: "USER_BRANCH",
  };
}

function withBranchWhere(whereBase, branchId) {
  const where = { ...(whereBase || {}) };
  if (branchId) where.branch_id = branchId;
  return where;
}

/**
 * ✅ Encuentra el alias real de una asociación Sequelize (evita 500 por "as" mal)
 */
function findAssocAs(fromModel, toModel) {
  try {
    const assocs = fromModel?.associations || {};
    for (const key of Object.keys(assocs)) {
      const a = assocs[key];
      if (a?.target === toModel) return a.as || key;
    }
  } catch {}
  return null;
}

// =========================
// SALES STATS
// =========================
async function salesTotalsBetween(whereBase) {
  const row = await Sale.findOne({
    attributes: [
      [fn("COUNT", col("Sale.id")), "count_sales"],
      [fn("SUM", col("total")), "sum_total"],
      [fn("AVG", col("total")), "avg_ticket"],
      [fn("SUM", col("discount_total")), "sum_discount"],
      [fn("SUM", col("tax_total")), "sum_tax"],
    ],
    where: whereBase,
    raw: true,
  });

  return {
    count: Number(row?.count_sales || 0),
    total: Number(row?.sum_total || 0),
    avgTicket: Number(row?.avg_ticket || 0),
    discountTotal: Number(row?.sum_discount || 0),
    taxTotal: Number(row?.sum_tax || 0),
  };
}

function pctChange(curr, prev) {
  const c = Number(curr || 0);
  const p = Number(prev || 0);
  if (p === 0 && c === 0) return 0;
  if (p === 0) return 100;
  return ((c - p) / p) * 100;
}

// ============================
// GET /api/v1/dashboard/overview
// ============================
async function overview(req, res, next) {
  try {
    const scope = resolveBranchScope(req);

    // ✅ NO-admin debe tener sucursal sí o sí
    if (!scope.admin && !scope.branchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const now = new Date();
    const todayFrom = startOfDay(now);
    const todayTo = endOfDay(now);

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

    const baseBranch = scope.branchId ? { branch_id: scope.branchId } : {};

    const todayWhere = { ...baseBranch, status: "PAID", sold_at: { [Op.between]: [todayFrom, todayTo] } };
    const weekWhere = { ...baseBranch, status: "PAID", sold_at: { [Op.between]: [weekFrom, todayTo] } };
    const monthWhere = { ...baseBranch, status: "PAID", sold_at: { [Op.between]: [monthFrom, todayTo] } };

    const prevWeekWhere = { ...baseBranch, status: "PAID", sold_at: { [Op.between]: [prevWeekFrom, prevWeekTo] } };
    const prevMonthWhere = { ...baseBranch, status: "PAID", sold_at: { [Op.between]: [prevMonthFrom, prevMonthTo] } };

    const today = await salesTotalsBetween(todayWhere);
    const week = await salesTotalsBetween(weekWhere);
    const month = await salesTotalsBetween(monthWhere);

    const prevWeek = await salesTotalsBetween(prevWeekWhere);
    const prevMonth = await salesTotalsBetween(prevMonthWhere);

    const trend = {
      week_total_pct: pctChange(week.total, prevWeek.total),
      week_count_pct: pctChange(week.count, prevWeek.count),
      month_total_pct: pctChange(month.total, prevMonth.total),
      month_count_pct: pctChange(month.count, prevMonth.count),
    };

    // ===== Pagos hoy por método (alias-safe + fallback SQL)
    let paymentsToday = [];
    try {
      const asSale = findAssocAs(Payment, Sale);
      if (asSale) {
        const rows = await Payment.findAll({
          attributes: ["method", [fn("SUM", col("amount")), "sum_amount"]],
          include: [
            {
              model: Sale,
              as: asSale,
              attributes: [],
              required: true,
              where: todayWhere,
            },
          ],
          group: ["method"],
          raw: true,
        });

        paymentsToday = rows
          .map((r) => ({
            method: String(r.method || "").toUpperCase(),
            label: methodLabel(r.method),
            total: Number(r.sum_amount || 0),
          }))
          .sort((a, b) => b.total - a.total);
      } else {
        const rows = await sequelize.query(
          `
          SELECT p.method, SUM(p.amount) as sum_amount
          FROM payments p
          INNER JOIN sales s ON s.id = p.sale_id
          WHERE s.status = 'PAID'
            AND s.sold_at BETWEEN :from AND :to
            ${scope.branchId ? "AND s.branch_id = :branchId" : ""}
          GROUP BY p.method
          `,
          {
            type: QueryTypes.SELECT,
            replacements: {
              from: todayFrom,
              to: todayTo,
              branchId: scope.branchId || null,
            },
          }
        );

        paymentsToday = rows
          .map((r) => ({
            method: String(r.method || "").toUpperCase(),
            label: methodLabel(r.method),
            total: Number(r.sum_amount || 0),
          }))
          .sort((a, b) => b.total - a.total);
      }
    } catch {
      paymentsToday = [];
    }

    // ===== ventas últimos 7 días (FIX key YYYY-MM-DD)
    const salesByDayRows = await Sale.findAll({
      attributes: [
        [literal("DATE_FORMAT(sold_at, '%Y-%m-%d')"), "day"],
        [fn("SUM", col("total")), "sum_total"],
        [fn("COUNT", col("Sale.id")), "count_sales"],
      ],
      where: { ...baseBranch, status: "PAID", sold_at: { [Op.gte]: weekFrom } },
      group: [literal("DATE_FORMAT(sold_at, '%Y-%m-%d')")],
      order: [[literal("DATE_FORMAT(sold_at, '%Y-%m-%d')"), "ASC"]],
      raw: true,
    });

    const mapDay = new Map();
    for (const r of salesByDayRows) {
      const k = String(r.day);
      mapDay.set(k, { total: Number(r.sum_total || 0), count: Number(r.count_sales || 0) });
    }

    const salesByDay = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekFrom);
      d.setDate(weekFrom.getDate() + i);
      const key = ymd(d);
      const v = mapDay.get(key) || { total: 0, count: 0 };
      salesByDay.push({ date: key, total: v.total, count: v.count });
    }

    // ===== últimas ventas
    const includeLast = [];
    const asPayments = findAssocAs(Sale, Payment);
    if (asPayments) includeLast.push({ model: Payment, as: asPayments, required: false });

    const asBranch = findAssocAs(Sale, Branch);
    if (asBranch) includeLast.push({ model: Branch, as: asBranch, required: false, attributes: ["id", "name"] });

    const asUser = findAssocAs(Sale, User);
    if (asUser) {
      const userAttrs = pickExistingAttrs(User, ["full_name", "name", "username", "email", "identifier"], ["id"]);
      includeLast.push({ model: User, as: asUser, required: false, attributes: userAttrs });
    }

    const lastSales = await Sale.findAll({
      where: withBranchWhere({ status: "PAID" }, scope.branchId),
      order: [["id", "DESC"]],
      limit: 10,
      include: includeLast,
    });

    // ==========================
    // ✅ NUEVO: Ventas 30 días (serie diaria para picos)
    // ==========================
    const d30From = new Date(todayFrom);
    d30From.setDate(d30From.getDate() - 29);

    const whereBranch30 = scope.branchId ? "AND s.branch_id = :branchId" : "";
    const sales30Rows = await sequelize
      .query(
        `
        SELECT
          DATE_FORMAT(s.sold_at, '%Y-%m-%d') AS day,
          COALESCE(SUM(s.total),0) AS sum_total,
          COUNT(*) AS count_sales
        FROM sales s
        WHERE s.status='PAID'
          AND s.sold_at BETWEEN :from AND :to
          ${whereBranch30}
        GROUP BY DATE_FORMAT(s.sold_at, '%Y-%m-%d')
        ORDER BY day ASC
        `,
        {
          type: QueryTypes.SELECT,
          replacements: { from: d30From, to: todayTo, branchId: scope.branchId || null },
        }
      )
      .catch(() => []);

    const map30 = new Map((sales30Rows || []).map((r) => [String(r.day), { total: Number(r.sum_total || 0), count: Number(r.count_sales || 0) }]));
    const salesByDay30 = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(d30From);
      d.setDate(d30From.getDate() + i);
      const key = ymd(d);
      const v = map30.get(key) || { total: 0, count: 0 };
      salesByDay30.push({ date: key, total: v.total, count: v.count });
    }

    // ==========================
    // ✅ NUEVO: Sucursal top (30 días) — SOLO si está en "Todas las sucursales"
    // ==========================
    let topBranch30d = null;
    if (!scope.branchId) {
      const topBranchRow = await sequelize
        .query(
          `
          SELECT
            s.branch_id,
            b.name AS branch_name,
            COALESCE(SUM(s.total),0) AS sum_total,
            COUNT(*) AS count_sales
          FROM sales s
          LEFT JOIN branches b ON b.id = s.branch_id
          WHERE s.status='PAID'
            AND s.sold_at BETWEEN :from AND :to
          GROUP BY s.branch_id, b.name
          ORDER BY sum_total DESC
          LIMIT 1
          `,
          {
            type: QueryTypes.SELECT,
            replacements: { from: d30From, to: todayTo },
          }
        )
        .then((rows) => rows?.[0] || null)
        .catch(() => null);

      if (topBranchRow && Number(topBranchRow.sum_total || 0) > 0) {
        topBranch30d = {
          branch_id: Number(topBranchRow.branch_id || 0),
          branch_name: topBranchRow.branch_name || `Sucursal #${topBranchRow.branch_id}`,
          total: Number(topBranchRow.sum_total || 0),
          count: Number(topBranchRow.count_sales || 0),
        };
      }
    }

    // ==========================
    // ✅ NUEVO: Top cajeros (30 días)
    // ==========================
    const topCashiers30d = await sequelize
      .query(
        `
        SELECT
          s.user_id,
          COALESCE(u.full_name, u.name, u.username, u.email, CONCAT('User #', u.id)) AS user_label,
          COALESCE(SUM(s.total),0) AS sum_total,
          COUNT(*) AS count_sales
        FROM sales s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.status='PAID'
          AND s.sold_at BETWEEN :from AND :to
          ${whereBranch30}
        GROUP BY s.user_id, user_label
        ORDER BY sum_total DESC
        LIMIT 10
        `,
        {
          type: QueryTypes.SELECT,
          replacements: { from: d30From, to: todayTo, branchId: scope.branchId || null },
        }
      )
      .then((rows) =>
        (rows || []).map((r) => ({
          user_id: Number(r.user_id || 0),
          user_label: r.user_label || (r.user_id ? `User #${r.user_id}` : "—"),
          total: Number(r.sum_total || 0),
          count: Number(r.count_sales || 0),
        }))
      )
      .catch(() => []);

    // ==========================
    // ✅ NUEVO: Top productos (30 días)
    // - usa sale_items: qty / line_total si existen, sino fallback unit_price*qty
    // ==========================
    const hasQty = !!SaleItem?.rawAttributes?.qty;
    const hasLineTotal = !!SaleItem?.rawAttributes?.line_total;
    const qtyExpr = hasQty ? "si.qty" : "1";
    const totalExpr = hasLineTotal ? "si.line_total" : "(COALESCE(si.unit_price,0) * COALESCE(si.qty,1))";

    const topProducts30d = await sequelize
      .query(
        `
        SELECT
          si.product_id,
          COALESCE(p.name, CONCAT('Producto #', si.product_id)) AS product_name,
          p.sku AS sku,
          COALESCE(SUM(${qtyExpr}),0) AS units,
          COALESCE(SUM(${totalExpr}),0) AS sum_total
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
        LEFT JOIN products p ON p.id = si.product_id
        WHERE s.status='PAID'
          AND s.sold_at BETWEEN :from AND :to
          ${whereBranch30}
        GROUP BY si.product_id, product_name, sku
        ORDER BY units DESC, sum_total DESC
        LIMIT 10
        `,
        {
          type: QueryTypes.SELECT,
          replacements: { from: d30From, to: todayTo, branchId: scope.branchId || null },
        }
      )
      .then((rows) =>
        (rows || []).map((r) => ({
          product_id: Number(r.product_id || 0),
          product_name: r.product_name || (r.product_id ? `Producto #${r.product_id}` : "—"),
          sku: r.sku || null,
          units: Number(r.units || 0),
          total: Number(r.sum_total || 0),
        }))
      )
      .catch(() => []);

    // ==========================
    // ✅ NUEVO: Mejor mes (últimos 12 meses)
    // ==========================
    const m12From = new Date(todayFrom);
    m12From.setMonth(m12From.getMonth() - 11);
    m12From.setDate(1);

    const whereBranch12 = scope.branchId ? "AND s.branch_id = :branchId" : "";
    const bestMonthRow = await sequelize
      .query(
        `
        SELECT
          DATE_FORMAT(s.sold_at, '%Y-%m') AS ym,
          COALESCE(SUM(s.total),0) AS sum_total,
          COUNT(*) AS count_sales
        FROM sales s
        WHERE s.status='PAID'
          AND s.sold_at BETWEEN :from AND :to
          ${whereBranch12}
        GROUP BY ym
        ORDER BY sum_total DESC
        LIMIT 1
        `,
        {
          type: QueryTypes.SELECT,
          replacements: { from: m12From, to: todayTo, branchId: scope.branchId || null },
        }
      )
      .then((rows) => rows?.[0] || null)
      .catch(() => null);

    const bestMonth12m =
      bestMonthRow && Number(bestMonthRow.sum_total || 0) > 0
        ? {
            ym: String(bestMonthRow.ym || ""),
            total: Number(bestMonthRow.sum_total || 0),
            count: Number(bestMonthRow.count_sales || 0),
          }
        : null;

    // ===== ventas por sucursal (últimos 30 días) (admin-only sin filtro)
    let salesByBranch = [];
    if (scope.admin && !scope.branchId) {
      const rows = await Sale.findAll({
        attributes: ["branch_id", [fn("SUM", col("total")), "sum_total"], [fn("COUNT", col("id")), "count_sales"]],
        where: { status: "PAID", sold_at: { [Op.gte]: d30From } },
        group: ["branch_id"],
        order: [[fn("SUM", col("total")), "DESC"]],
        raw: true,
      });

      const brs = await Branch.findAll({ attributes: ["id", "name"], raw: true }).catch(() => []);
      const m = new Map(brs.map((b) => [toInt(b.id, 0), b.name]));

      salesByBranch = rows.map((r) => ({
        branch_id: toInt(r.branch_id, 0),
        branch_name: m.get(toInt(r.branch_id, 0)) || `Sucursal #${r.branch_id}`,
        total: Number(r.sum_total || 0),
        count: Number(r.count_sales || 0),
      }));
    }

    // ===== inventory KPIs + lastProducts (para que NO diga "Sin productos")
    const prodWhere = scope.branchId ? { branch_id: scope.branchId } : {};
    const totalProducts = await Product.count({ where: prodWhere });
    const activeProducts = await Product.count({ where: { ...prodWhere, is_active: 1 } }).catch(() => 0);

    const noPriceProducts = await Product.count({
      where: {
        ...prodWhere,
        [Op.and]: [
          { [Op.or]: [{ price_list: { [Op.lte]: 0 } }, { price_list: null }] },
          { [Op.or]: [{ price: { [Op.lte]: 0 } }, { price: null }] },
        ],
      },
    }).catch(() => 0);

    const categoriesTotal = await Category.count().catch(() => 0);
    const usersTotal = await User.count().catch(() => 0);
    const branchesTotal = await Branch.count().catch(() => 0);

    // ✅ lastProducts (RAW SQL con categoría + parent)
    const whereProdSql = scope.branchId ? "WHERE p.branch_id = :branchId" : "WHERE 1=1";
    const lastProducts = await sequelize.query(
      `
      SELECT
        p.id, p.name, p.sku, p.is_active,
        p.category_id,
        c.name AS category_name,
        c.parent_id AS category_parent_id,
        cp.name AS category_parent_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN categories cp ON cp.id = c.parent_id
      ${whereProdSql}
      ORDER BY p.id DESC
      LIMIT 10
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { branchId: scope.branchId || null },
      }
    );

    const invLastProducts = (lastProducts || []).map((r) => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      is_active: r.is_active,
      category: r.category_id
        ? {
            id: r.category_id,
            name: r.category_name,
            parent_id: r.category_parent_id,
            parent: r.category_parent_id ? { id: r.category_parent_id, name: r.category_parent_name } : null,
          }
        : null,
    }));

    // ===== stock KPIs + stockByBranch + lowStockItems (para gráficos completos)
    const lowThreshold = 3;

    const whereWhBranch = scope.branchId ? "AND w.branch_id = :branchId" : "";
    const stockAgg = await sequelize
      .query(
        `
        SELECT
          SUM(CASE WHEN sb.qty <= 0 THEN 1 ELSE 0 END) AS out_cnt,
          SUM(CASE WHEN sb.qty > 0 AND sb.qty <= :lowThreshold THEN 1 ELSE 0 END) AS low_cnt,
          SUM(CASE WHEN sb.qty > :lowThreshold THEN 1 ELSE 0 END) AS ok_cnt,
          COALESCE(SUM(sb.qty),0) AS sum_units,
          COUNT(DISTINCT sb.product_id) AS distinct_products
        FROM stock_balances sb
        INNER JOIN warehouses w ON w.id = sb.warehouse_id
        WHERE 1=1
          ${whereWhBranch}
        `,
        {
          type: QueryTypes.SELECT,
          replacements: { branchId: scope.branchId || null, lowThreshold },
        }
      )
      .then((rows) => rows?.[0] || null)
      .catch(() => null);

    const lowStockItemsRows = await sequelize
      .query(
        `
        SELECT
          sb.product_id,
          p.name,
          p.sku,
          sb.qty AS stock,
          sb.warehouse_id,
          w.name AS warehouse_name,
          w.branch_id,
          b.name AS branch_name
        FROM stock_balances sb
        INNER JOIN warehouses w ON w.id = sb.warehouse_id
        LEFT JOIN branches b ON b.id = w.branch_id
        LEFT JOIN products p ON p.id = sb.product_id
        WHERE sb.qty <= :lowThreshold
          ${whereWhBranch}
        ORDER BY sb.qty ASC
        LIMIT 50
        `,
        {
          type: QueryTypes.SELECT,
          replacements: { branchId: scope.branchId || null, lowThreshold },
        }
      )
      .catch(() => []);

    const stockByBranchRows = await sequelize
      .query(
        `
        SELECT
          w.branch_id,
          b.name AS branch_name,
          SUM(CASE WHEN sb.qty <= 0 THEN 1 ELSE 0 END) AS out_cnt,
          SUM(CASE WHEN sb.qty > 0 AND sb.qty <= :lowThreshold THEN 1 ELSE 0 END) AS low_cnt,
          SUM(CASE WHEN sb.qty > :lowThreshold THEN 1 ELSE 0 END) AS ok_cnt,
          COALESCE(SUM(sb.qty),0) AS sum_units
        FROM stock_balances sb
        INNER JOIN warehouses w ON w.id = sb.warehouse_id
        LEFT JOIN branches b ON b.id = w.branch_id
        WHERE 1=1
          ${whereWhBranch}
        GROUP BY w.branch_id, b.name
        ORDER BY sum_units DESC
        `,
        {
          type: QueryTypes.SELECT,
          replacements: { branchId: scope.branchId || null, lowThreshold },
        }
      )
      .catch(() => []);

    const stockKpis = {
      outCount: Number(stockAgg?.out_cnt || 0),
      lowCount: Number(stockAgg?.low_cnt || 0),
      okCount: Number(stockAgg?.ok_cnt || 0),
      totalUnits: Number(stockAgg?.sum_units || 0),
      trackedProducts: Number(stockAgg?.distinct_products || 0),
      lowThreshold,

      lowStockItems: (lowStockItemsRows || []).map((r) => ({
        product_id: r.product_id,
        name: r.name || `Producto #${r.product_id}`,
        sku: r.sku || null,
        stock: Number(r.stock || 0),
        min_stock: lowThreshold,
        warehouse_id: r.warehouse_id,
        warehouse_name: r.warehouse_name || null,
        branch_id: r.branch_id || null,
        branch_name: r.branch_name || null,
      })),

      stockByBranch: (stockByBranchRows || []).map((r) => ({
        branch_id: Number(r.branch_id || 0),
        branch_name: r.branch_name || `Sucursal #${r.branch_id}`,
        out: Number(r.out_cnt || 0),
        low: Number(r.low_cnt || 0),
        ok: Number(r.ok_cnt || 0),
        units: Number(r.sum_units || 0),
      })),
    };

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
          salesByDay,
          salesByDay30, // ✅ NUEVO
          salesByBranch,
          lastSales,

          topBranch30d, // ✅ NUEVO
          topCashiers30d, // ✅ NUEVO
          topProducts30d, // ✅ NUEVO
          bestMonth12m, // ✅ NUEVO
        },
        inventory: {
          totalProducts,
          activeProducts,
          noPriceProducts,
          categories: categoriesTotal,
          lastProducts: invLastProducts,
        },
        users: { usersTotal, branchesTotal },
        stock: stockKpis,
      },
    });
  } catch (e) {
    console.error("❌ [DASHBOARD OVERVIEW ERROR]", e);
    next(e);
  }
}

// ============================
// Endpoints "compat"
// ============================
async function sales(req, res, next) {
  try {
    return overview(req, res, next);
  } catch (e) {
    next(e);
  }
}
async function inventory(req, res, next) {
  try {
    return overview(req, res, next);
  } catch (e) {
    next(e);
  }
}
async function stock(req, res, next) {
  try {
    return overview(req, res, next);
  } catch (e) {
    next(e);
  }
}

module.exports = { overview, sales, inventory, stock };