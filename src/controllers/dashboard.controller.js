// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/dashboard.controller.js
const { Op, fn, col, literal } = require("sequelize");
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
function pctChange(curr, prev) {
  const c = Number(curr || 0);
  const p = Number(prev || 0);
  if (p === 0 && c === 0) return 0;
  if (p === 0) return 100;
  return ((c - p) / p) * 100;
}
function pickExistingAttrs(model, candidates, always = ["id"]) {
  const attrs = [];
  for (const a of always) if (model?.rawAttributes?.[a]) attrs.push(a);
  for (const a of candidates) if (model?.rawAttributes?.[a]) attrs.push(a);
  return attrs.length ? attrs : ["id"];
}

/**
 * ✅ Detecta alias real de asociación para evitar "as" errado
 * - Busca por target model name (Sale/Product/Warehouse/Branch/User/Payment/etc)
 * - Prioriza aliases preferidos si existen
 */
function assocAlias(fromModel, targetModel, preferredAliases = []) {
  try {
    if (!fromModel?.associations || !targetModel) return null;
    const assocs = Object.values(fromModel.associations);

    // 1) preferidos
    for (const pref of preferredAliases) {
      const found = assocs.find((a) => a?.as === pref && a?.target === targetModel);
      if (found?.as) return found.as;
    }

    // 2) por target
    const found = assocs.find((a) => a?.target === targetModel);
    if (found?.as) return found.as;

    // 3) por nombre
    const tname = String(targetModel?.name || "").toLowerCase();
    const found2 = assocs.find((a) => String(a?.target?.name || "").toLowerCase() === tname);
    return found2?.as || null;
  } catch {
    return null;
  }
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
 * - No-admin: obligado a su branch
 */
function resolveBranchScope(req) {
  const admin = isAdminReq(req);
  const qBranch = toInt(req.query.branch_id ?? req.query.branchId, 0);

  if (admin) {
    return {
      admin: true,
      branchId: qBranch > 0 ? qBranch : null, // null => todas
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

// =========================
// SALES STATS
// =========================
async function salesTotalsBetween(whereBase) {
  const row = await Sale.findOne({
    attributes: [
      [fn("COUNT", col("Sale.id")), "count_sales"],
      [fn("SUM", col("total")), "sum_total"],
      [fn("AVG", col("total")), "avg_ticket"],
    ],
    where: whereBase,
    raw: true,
  });

  return {
    count: Number(row?.count_sales || 0),
    total: Number(row?.sum_total || 0),
    avgTicket: Number(row?.avg_ticket || 0),
  };
}

// ============================
// GET /api/v1/dashboard/overview
// (mix grande: ventas + stock + inventario + usuarios + sucursales)
// ============================
async function overview(req, res, next) {
  try {
    const scope = resolveBranchScope(req);
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

    // ===== Pagos hoy por método (alias seguro)
    const paySaleAlias = assocAlias(Payment, Sale, ["sale", "Sale"]);
    const paymentsTodayRows = await Payment.findAll({
      attributes: ["method", [fn("SUM", col("amount")), "sum_amount"]],
      include: [
        {
          model: Sale,
          as: paySaleAlias || undefined,
          attributes: [],
          required: true,
          where: todayWhere,
        },
      ],
      group: ["method"],
      raw: true,
    }).catch(() => []);

    const paymentsToday = paymentsTodayRows
      .map((r) => ({
        method: String(r.method || "").toUpperCase(),
        label: methodLabel(r.method),
        total: Number(r.sum_amount || 0),
      }))
      .sort((a, b) => b.total - a.total);

    // ===== Inventario KPIs rápidos
    const productHasBranch = !!Product?.rawAttributes?.branch_id;
    const prodWhere = productHasBranch && scope.branchId ? { branch_id: scope.branchId } : {};
    const totalProducts = await Product.count({ where: prodWhere });

    const activeProducts = await Product.count({ where: { ...prodWhere, ...(Product?.rawAttributes?.is_active ? { is_active: 1 } : {}) } }).catch(() => 0);
    const promoProducts = await Product.count({ where: { ...prodWhere, ...(Product?.rawAttributes?.is_promo ? { is_promo: 1 } : {}) } }).catch(() => 0);
    const newProducts = await Product.count({ where: { ...prodWhere, ...(Product?.rawAttributes?.is_new ? { is_new: 1 } : {}) } }).catch(() => 0);

    // noPrice: si existen campos price/price_list
    let noPriceProducts = 0;
    if (Product?.rawAttributes?.price || Product?.rawAttributes?.price_list) {
      const ands = [];
      if (Product?.rawAttributes?.price_list) {
        ands.push({ [Op.or]: [{ price_list: { [Op.lte]: 0 } }, { price_list: null }] });
      }
      if (Product?.rawAttributes?.price) {
        ands.push({ [Op.or]: [{ price: { [Op.lte]: 0 } }, { price: null }] });
      }
      if (ands.length) {
        noPriceProducts = await Product.count({ where: { ...prodWhere, [Op.and]: ands } }).catch(() => 0);
      }
    }

    const categories = await Category.count().catch(() => 0);

    const usersTotal = await User.count().catch(() => 0);
    const branchesTotal = await Branch.count().catch(() => 0);

    // ===== Stock KPIs (básico: depende de StockBalance + Warehouse branch)
    const qtyField =
      StockBalance?.rawAttributes?.quantity ? "quantity" :
      StockBalance?.rawAttributes?.qty ? "qty" :
      StockBalance?.rawAttributes?.stock ? "stock" :
      "quantity";

    const warehouseHasBranch = !!Warehouse?.rawAttributes?.branch_id;
    const sbWarehouseAlias = assocAlias(StockBalance, Warehouse, ["warehouse", "Warehouse"]);
    const lowThreshold = 3;

    const stockAggRow = await StockBalance.findOne({
      attributes: [
        [fn("SUM", literal(`CASE WHEN ${qtyField} <= 0 THEN 1 ELSE 0 END`)), "out_cnt"],
        [fn("SUM", literal(`CASE WHEN ${qtyField} > 0 AND ${qtyField} <= ${lowThreshold} THEN 1 ELSE 0 END`)), "low_cnt"],
        [fn("SUM", literal(`CASE WHEN ${qtyField} > ${lowThreshold} THEN 1 ELSE 0 END`)), "ok_cnt"],
      ],
      include: [
        {
          model: Warehouse,
          as: sbWarehouseAlias || undefined,
          attributes: [],
          required: true,
          ...(warehouseHasBranch && scope.branchId ? { where: { branch_id: scope.branchId } } : {}),
        },
      ],
      raw: true,
    }).catch(() => ({ out_cnt: 0, low_cnt: 0, ok_cnt: 0 }));

    const stock = {
      outOfStockCount: Number(stockAggRow?.out_cnt || 0),
      lowStockCount: Number(stockAggRow?.low_cnt || 0),
      okStockCount: Number(stockAggRow?.ok_cnt || 0),
      lowThreshold,
    };

    // ===== Admin: ventas por sucursal (para el pie del frontend)
    let salesByBranch = null;
    if (scope.admin && !scope.branchId) {
      const rows = await Sale.findAll({
        attributes: [
          "branch_id",
          [fn("SUM", col("total")), "sum_total"],
          [fn("COUNT", col("id")), "count_sales"],
        ],
        where: { status: "PAID", sold_at: { [Op.between]: [monthFrom, todayTo] } },
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
          // ✅ compat con tu DashboardSalesTab
          salesByBranch,
        },
        inventory: {
          totalProducts,
          activeProducts,
          promoProducts,
          newProducts,
          noPriceProducts,
          categories,
        },
        users: { usersTotal, branchesTotal },
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
    const scope = resolveBranchScope(req);
    if (!scope.admin && !scope.branchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const productHasBranch = !!Product?.rawAttributes?.branch_id;
    const prodWhere = productHasBranch && scope.branchId ? { branch_id: scope.branchId } : {};

    const totalProducts = await Product.count({ where: prodWhere });
    const activeProducts = await Product.count({ where: { ...prodWhere, ...(Product?.rawAttributes?.is_active ? { is_active: 1 } : {}) } }).catch(() => 0);
    const noPriceProducts = (() => {
      const hasPrice = !!Product?.rawAttributes?.price;
      const hasPriceList = !!Product?.rawAttributes?.price_list;
      if (!hasPrice && !hasPriceList) return Promise.resolve(0);

      const ands = [];
      if (hasPriceList) ands.push({ [Op.or]: [{ price_list: { [Op.lte]: 0 } }, { price_list: null }] });
      if (hasPrice) ands.push({ [Op.or]: [{ price: { [Op.lte]: 0 } }, { price: null }] });
      return Product.count({ where: { ...prodWhere, [Op.and]: ands } }).catch(() => 0);
    })();

    const categories = await Category.count().catch(() => 0);

    // últimos productos (tabla) - include category/parent si existe la asociación
    const prodCatAlias = assocAlias(Product, Category, ["category", "Category"]);
    const catParentAlias = assocAlias(Category, Category, ["parent", "Parent"]); // self ref

    const lastProducts = await Product.findAll({
      where: prodWhere,
      order: [["id", "DESC"]],
      limit: 10,
      include: prodCatAlias
        ? [
            {
              model: Category,
              as: prodCatAlias,
              attributes: pickExistingAttrs(Category, ["name", "parent_id"], ["id"]),
              required: false,
              include: catParentAlias
                ? [{ model: Category, as: catParentAlias, attributes: pickExistingAttrs(Category, ["name"], ["id"]), required: false }]
                : [],
            },
          ]
        : [],
    }).catch(() => []);

    return res.json({
      ok: true,
      scope,
      data: {
        totalProducts,
        activeProducts,
        noPriceProducts: await noPriceProducts,
        categories,
        lastProducts,
      },
    });
  } catch (e) {
    console.error("❌ [DASHBOARD INVENTORY ERROR]", e);
    next(e);
  }
}

// ============================
// GET /api/v1/dashboard/sales
// ✅ payload COMPAT con tu DashboardSalesTab.vue
// ============================
async function sales(req, res, next) {
  try {
    const scope = resolveBranchScope(req);
    if (!scope.admin && !scope.branchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const now = new Date();
    const from = startOfDay(now);
    const to = endOfDay(now);

    const whereToday = withBranchWhere({ sold_at: { [Op.between]: [from, to] }, status: "PAID" }, scope.branchId);

    const todayAgg = await salesTotalsBetween(whereToday);

    // ✅ compat: fields planos
    const todayCount = todayAgg.count;
    const todayTotal = todayAgg.total;
    const avgTicket = todayAgg.avgTicket;

    // últimos 7 días
    const days = 7;
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);

    const where7 = withBranchWhere({ sold_at: { [Op.gte]: start }, status: "PAID" }, scope.branchId);

    const salesByDayRows = await Sale.findAll({
      attributes: [
        [fn("DATE", col("sold_at")), "day"],
        [fn("SUM", col("total")), "sum_total"],
        [fn("COUNT", col("Sale.id")), "count_sales"],
      ],
      where: where7,
      group: [fn("DATE", col("sold_at"))],
      order: [[fn("DATE", col("sold_at")), "ASC"]],
      raw: true,
    }).catch(() => []);

    const map = new Map();
    for (const r of salesByDayRows) {
      map.set(String(r.day), { total: Number(r.sum_total || 0), count: Number(r.count_sales || 0) });
    }

    const salesByDay = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = ymd(d);
      const v = map.get(key) || { total: 0, count: 0 };
      salesByDay.push({ date: key, total: v.total, count: v.count });
    }

    // pagos hoy por método
    const paySaleAlias = assocAlias(Payment, Sale, ["sale", "Sale"]);
    const paymentRows = await Payment.findAll({
      attributes: ["method", [fn("SUM", col("amount")), "sum_amount"]],
      include: [
        {
          model: Sale,
          as: paySaleAlias || undefined,
          attributes: [],
          required: true,
          where: whereToday,
        },
      ],
      group: ["method"],
      raw: true,
    }).catch(() => []);

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

    // últimas ventas (tabla)
    const salePaymentsAlias = assocAlias(Sale, Payment, ["payments", "Payments"]);
    const saleBranchAlias = assocAlias(Sale, Branch, ["branch", "Branch"]);
    const saleUserAlias = assocAlias(Sale, User, ["user", "User"]);

    const includeLast = [];
    if (salePaymentsAlias) includeLast.push({ model: Payment, as: salePaymentsAlias, required: false });
    if (saleBranchAlias) includeLast.push({ model: Branch, as: saleBranchAlias, required: false, attributes: ["id", "name"] });
    if (saleUserAlias) {
      const userAttrs = pickExistingAttrs(User, ["full_name", "name", "username", "email", "identifier"], ["id"]);
      includeLast.push({ model: User, as: saleUserAlias, required: false, attributes: userAttrs });
    }

    const lastSales = await Sale.findAll({
      where: withBranchWhere({ status: "PAID" }, scope.branchId),
      order: [["id", "DESC"]],
      limit: 10,
      include: includeLast,
    }).catch(() => []);

    // ✅ Admin: ventas por sucursal (para el PieChart del frontend)
    let salesByBranch = null;
    if (scope.admin && !scope.branchId) {
      const d30 = new Date();
      d30.setDate(d30.getDate() - 30);
      d30.setHours(0, 0, 0, 0);

      const rows = await Sale.findAll({
        attributes: [
          "branch_id",
          [fn("SUM", col("total")), "sum_total"],
          [fn("COUNT", col("id")), "count_sales"],
        ],
        where: { status: "PAID", sold_at: { [Op.gte]: d30 } },
        group: ["branch_id"],
        order: [[fn("SUM", col("total")), "DESC"]],
        raw: true,
      }).catch(() => []);

      const brs = await Branch.findAll({ attributes: ["id", "name"], raw: true }).catch(() => []);
      const m = new Map(brs.map((b) => [toInt(b.id, 0), b.name]));

      salesByBranch = rows.map((r) => ({
        branch_id: toInt(r.branch_id, 0),
        branch_name: m.get(toInt(r.branch_id, 0)) || `Sucursal #${r.branch_id}`,
        total: Number(r.sum_total || 0),
        count: Number(r.count_sales || 0),
      }));
    }

    return res.json({
      ok: true,
      scope,
      data: {
        // ✅ compat exacta con DashboardSalesTab.vue
        todayCount,
        todayTotal,
        avgTicket,
        topPaymentLabel,
        paymentsByMethod,
        salesByDay,
        lastSales,
        salesByBranch, // null si no admin o si filtró una sucursal
      },
    });
  } catch (e) {
    console.error("❌ [DASHBOARD SALES ERROR]", e);
    next(e);
  }
}

// ============================
// GET /api/v1/dashboard/stock
// ✅ payload COMPAT con tu DashboardStockTab.vue
// ============================
async function stock(req, res, next) {
  try {
    const scope = resolveBranchScope(req);
    if (!scope.admin && !scope.branchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const lowThreshold = 3;

    const qtyField =
      StockBalance?.rawAttributes?.quantity ? "quantity" :
      StockBalance?.rawAttributes?.qty ? "qty" :
      StockBalance?.rawAttributes?.stock ? "stock" :
      "quantity";

    const minField =
      StockBalance?.rawAttributes?.min_stock ? "min_stock" :
      StockBalance?.rawAttributes?.min ? "min" :
      null;

    const warehouseHasBranch = !!Warehouse?.rawAttributes?.branch_id;

    const sbWarehouseAlias = assocAlias(StockBalance, Warehouse, ["warehouse", "Warehouse"]);
    const sbProductAlias = assocAlias(StockBalance, Product, ["product", "Product"]);
    const whBranchAlias = assocAlias(Warehouse, Branch, ["branch", "Branch"]);

    const includeWarehouse = {
      model: Warehouse,
      as: sbWarehouseAlias || undefined,
      attributes: pickExistingAttrs(Warehouse, ["name", ...(warehouseHasBranch ? ["branch_id"] : [])], ["id"]),
      required: true,
      ...(warehouseHasBranch && scope.branchId ? { where: { branch_id: scope.branchId } } : {}),
      include: whBranchAlias
        ? [{ model: Branch, as: whBranchAlias, attributes: ["id", "name"], required: false }]
        : [],
    };

    const includeProduct = sbProductAlias
      ? {
          model: Product,
          as: sbProductAlias,
          attributes: pickExistingAttrs(Product, ["name", "sku", "track_stock"], ["id"]),
          required: false,
        }
      : null;

    // KPIs: out/low/ok
    const agg = await StockBalance.findOne({
      attributes: [
        [fn("SUM", literal(`CASE WHEN ${qtyField} <= 0 THEN 1 ELSE 0 END`)), "out_cnt"],
        [fn("SUM", literal(`CASE WHEN ${qtyField} > 0 AND ${qtyField} <= ${lowThreshold} THEN 1 ELSE 0 END`)), "low_cnt"],
        [fn("SUM", literal(`CASE WHEN ${qtyField} > ${lowThreshold} THEN 1 ELSE 0 END`)), "ok_cnt"],
      ],
      include: [includeWarehouse],
      raw: true,
    }).catch(() => ({ out_cnt: 0, low_cnt: 0, ok_cnt: 0 }));

    const outOfStockCount = Number(agg?.out_cnt || 0);
    const lowStockCount = Number(agg?.low_cnt || 0);

    // trackedProducts: si Product.track_stock existe => contar productos distintos track_stock=1 en balances
    let trackedProducts = 0;
    if (includeProduct && Product?.rawAttributes?.track_stock) {
      try {
        const rows = await StockBalance.findAll({
          attributes: [[fn("COUNT", fn("DISTINCT", col("product_id"))), "cnt"]],
          include: [
            includeWarehouse,
            {
              ...includeProduct,
              required: true,
              where: { track_stock: 1 },
            },
          ],
          raw: true,
        });
        trackedProducts = Number(rows?.[0]?.cnt || 0);
      } catch {
        trackedProducts = 0;
      }
    } else {
      // fallback: distinct product_id en balances
      try {
        const rows = await StockBalance.findAll({
          attributes: [[fn("COUNT", fn("DISTINCT", col("product_id"))), "cnt"]],
          include: [includeWarehouse],
          raw: true,
        });
        trackedProducts = Number(rows?.[0]?.cnt || 0);
      } catch {
        trackedProducts = 0;
      }
    }

    // Low stock items (tabla) -> compat con tu DashboardStockTab
    const lowItemsRows = await StockBalance.findAll({
      attributes: ["id", "product_id", "warehouse_id", qtyField, ...(minField ? [minField] : [])],
      include: [includeWarehouse, ...(includeProduct ? [includeProduct] : [])],
      where: { [qtyField]: { [Op.lte]: lowThreshold } },
      order: [[col(qtyField), "ASC"]],
      limit: 50,
    }).catch(() => []);

    const lowStockItems = lowItemsRows.map((r) => {
      const stockVal = Number(r?.[qtyField] || 0);
      const minVal = minField ? Number(r?.[minField] || 0) : lowThreshold;

      return {
        product_id: r.product_id,
        name: r.product?.name || `Producto #${r.product_id}`,
        sku: r.product?.sku || null,

        // ✅ estos campos los usa tu tabla
        stock: stockVal,
        min_stock: minVal,

        branch_id: r.warehouse?.branch_id ?? null,
        branch_name: r.warehouse?.branch?.name ?? null,
        warehouse_id: r.warehouse_id,
        warehouse_name: r.warehouse?.name ?? null,
      };
    });

    // Stock por sucursal (admin only, todas)
    let stockByBranch = null;
    if (scope.admin && !scope.branchId && warehouseHasBranch) {
      const rows = await StockBalance.findAll({
        attributes: [
          [col(`${sbWarehouseAlias || "warehouse"}.branch_id`), "branch_id"],
          [fn("SUM", literal(`CASE WHEN ${qtyField} <= 0 THEN 1 ELSE 0 END`)), "out_cnt"],
          [fn("SUM", literal(`CASE WHEN ${qtyField} > 0 AND ${qtyField} <= ${lowThreshold} THEN 1 ELSE 0 END`)), "low_cnt"],
          [fn("SUM", literal(`CASE WHEN ${qtyField} > ${lowThreshold} THEN 1 ELSE 0 END`)), "ok_cnt"],
        ],
        include: [
          {
            model: Warehouse,
            as: sbWarehouseAlias || undefined,
            attributes: [],
            required: true,
          },
        ],
        group: [col(`${sbWarehouseAlias || "warehouse"}.branch_id`)],
        raw: true,
      }).catch(() => []);

      const brs = await Branch.findAll({ attributes: ["id", "name"], raw: true }).catch(() => []);
      const m = new Map(brs.map((b) => [toInt(b.id, 0), b.name]));

      stockByBranch = rows
        .map((r) => ({
          branch_id: toInt(r.branch_id, 0),
          branch_name: m.get(toInt(r.branch_id, 0)) || `Sucursal #${r.branch_id}`,
          out: Number(r.out_cnt || 0),
          low: Number(r.low_cnt || 0),
          ok: Number(r.ok_cnt || 0),
        }))
        .sort((a, b) => (b.ok + b.low + b.out) - (a.ok + a.low + a.out));
    }

    return res.json({
      ok: true,
      scope,
      data: {
        // ✅ compat exacta con DashboardStockTab.vue
        outOfStockCount,
        lowStockCount,
        trackedProducts,
        lowStockItems,
        stockByBranch, // null si no admin/todas
      },
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