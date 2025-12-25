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
  StockMovementItem,
} = require("../models");

// =========================
// Helpers
// =========================
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toFloat(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
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
  // si no hay ninguno, mínimo id
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
  return roleNames.map(norm).some((x) =>
    ["admin", "super_admin", "superadmin", "root", "owner"].includes(x)
  );
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
// SALES STATS (helpers)
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
// -> mix grande: ventas + stock + inventario + usuarios + sucursales
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

    // ===== Ventas KPIs
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

    // ===== Pagos hoy por método
    const paymentsTodayRows = await Payment.findAll({
      attributes: ["method", [fn("SUM", col("amount")), "sum_amount"]],
      include: [
        {
          model: Sale,
          as: "sale", // ⚠️ si tu alias no es "sale", cambiá acá
          attributes: [],
          required: true,
          where: todayWhere,
        },
      ],
      group: ["method"],
      raw: true,
    });

    const paymentsToday = paymentsTodayRows.map((r) => ({
      method: String(r.method || "").toUpperCase(),
      label: methodLabel(r.method),
      total: Number(r.sum_amount || 0),
    })).sort((a,b) => b.total - a.total);

    // ===== Inventario KPIs rápidos (por branch si Product tiene branch_id)
    const productHasBranch = !!Product?.rawAttributes?.branch_id;
    const prodWhere = productHasBranch && scope.branchId ? { branch_id: scope.branchId } : {};
    const totalProducts = await Product.count({ where: prodWhere });
    const activeProducts = await Product.count({ where: { ...prodWhere, is_active: 1 } }).catch(() => 0);
    const promoProducts = await Product.count({ where: { ...prodWhere, is_promo: 1 } }).catch(() => 0);
    const newProducts = await Product.count({ where: { ...prodWhere, is_new: 1 } }).catch(() => 0);

    const noPriceWhere = {
      ...prodWhere,
      [Op.and]: [
        { [Op.or]: [{ price_list: { [Op.lte]: 0 } }, { price_list: null }] },
        { [Op.or]: [{ price: { [Op.lte]: 0 } }, { price: null }] },
      ],
    };
    const noPriceProducts = await Product.count({ where: noPriceWhere }).catch(() => 0);

    const categoriesTotal = await Category.count().catch(() => 0);

    // ===== Usuarios / sucursales
    const usersTotal = await User.count().catch(() => 0);
    const branchesTotal = await Branch.count().catch(() => 0);

    // ===== Stock KPIs (usa StockBalance + Warehouse branch)
    // Detecta columna cantidad
    const stockQtyField =
      StockBalance?.rawAttributes?.quantity ? "quantity"
      : StockBalance?.rawAttributes?.qty ? "qty"
      : StockBalance?.rawAttributes?.stock ? "stock"
      : "quantity";

    const warehouseHasBranch = !!Warehouse?.rawAttributes?.branch_id;

    // Out/Low stock por branch (si Warehouse tiene branch_id)
    const lowThreshold = 3;

    // Stock balances join warehouse para filtrar branch
    const stockIncludeWarehouse = {
      model: Warehouse,
      as: "warehouse", // ⚠️ si tu alias no es "warehouse", cambiá acá
      attributes: [],
      required: true,
      ...(warehouseHasBranch && scope.branchId ? { where: { branch_id: scope.branchId } } : {}),
    };

    const stockAggRow = await StockBalance.findOne({
      attributes: [
        [fn("SUM", literal(`CASE WHEN ${stockQtyField} <= 0 THEN 1 ELSE 0 END`)), "out_cnt"],
        [fn("SUM", literal(`CASE WHEN ${stockQtyField} > 0 AND ${stockQtyField} <= ${lowThreshold} THEN 1 ELSE 0 END`)), "low_cnt"],
        [fn("SUM", literal(`CASE WHEN ${stockQtyField} > ${lowThreshold} THEN 1 ELSE 0 END`)), "ok_cnt"],
      ],
      include: [stockIncludeWarehouse],
      raw: true,
    }).catch(() => ({ out_cnt: 0, low_cnt: 0, ok_cnt: 0 }));

    const stockKpis = {
      outCount: Number(stockAggRow?.out_cnt || 0),
      lowCount: Number(stockAggRow?.low_cnt || 0),
      okCount: Number(stockAggRow?.ok_cnt || 0),
      lowThreshold,
    };

    // ===== Admin: torta ventas por sucursal (hoy o mes)
    let salesByBranchPie = null;
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

      salesByBranchPie = rows.map((r) => ({
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
        sales: { today, week, month, trend, paymentsToday, salesByBranchPie },
        inventory: { totalProducts, activeProducts, promoProducts, newProducts, noPriceProducts, categoriesTotal },
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
// GET /api/v1/dashboard/inventory
// (tu endpoint actual, pero con extras)
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
    const categoryHasBranch = !!Category?.rawAttributes?.branch_id;

    const prodWhere = productHasBranch && (scope.branchId ? true : false)
      ? { branch_id: scope.branchId }
      : {};

    const totalProducts = await Product.count({ where: prodWhere });
    const activeProducts = await Product.count({ where: { ...prodWhere, is_active: 1 } }).catch(() => 0);
    const promoProducts = await Product.count({ where: { ...prodWhere, is_promo: 1 } }).catch(() => 0);
    const newProducts = await Product.count({ where: { ...prodWhere, is_new: 1 } }).catch(() => 0);

    const noPriceProducts = await Product.count({
      where: {
        ...prodWhere,
        [Op.and]: [
          { [Op.or]: [{ price_list: { [Op.lte]: 0 } }, { price_list: null }] },
          { [Op.or]: [{ price: { [Op.lte]: 0 } }, { price: null }] },
        ],
      },
    }).catch(() => 0);

    const categories = await Category.count({
      where: categoryHasBranch && scope.branchId ? { branch_id: scope.branchId } : {},
    }).catch(() => 0);

    // Top categorías por cantidad productos (si Product.category_id existe)
    let topCategories = [];
    if (Product?.rawAttributes?.category_id) {
      const rows = await Product.findAll({
        attributes: ["category_id", [fn("COUNT", col("Product.id")), "count_products"]],
        where: prodWhere,
        group: ["category_id"],
        order: [[fn("COUNT", col("Product.id")), "DESC"]],
        limit: 8,
        raw: true,
      });

      const ids = rows.map((r) => toInt(r.category_id, 0)).filter(Boolean);
      const cats = await Category.findAll({ where: { id: ids }, attributes: ["id", "name"], raw: true }).catch(() => []);
      const map = new Map(cats.map((c) => [toInt(c.id, 0), c.name]));

      topCategories = rows.map((r) => ({
        category_id: toInt(r.category_id, 0),
        category_name: map.get(toInt(r.category_id, 0)) || `Cat #${r.category_id}`,
        count: Number(r.count_products || 0),
      }));
    }

    // últimos productos (tabla)
    const lastProducts = await Product.findAll({
      where: prodWhere,
      order: [["id", "DESC"]],
      limit: 10,
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["id", "name", "parent_id"],
          required: false,
          include: [
            { model: Category, as: "parent", attributes: ["id", "name"], required: false },
          ],
        },
      ],
    });

    return res.json({
      ok: true,
      scope,
      data: {
        totalProducts,
        activeProducts,
        promoProducts,
        newProducts,
        noPriceProducts,
        categories,
        topCategories,
        lastProducts,
      },
    });
  } catch (e) {
    next(e);
  }
}

// ============================
// GET /api/v1/dashboard/sales
// (tu endpoint pero “full”: compara períodos, top productos, top vendedores, admin por sucursal)
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

    // base where (branch si aplica)
    const whereToday = withBranchWhere(
      { sold_at: { [Op.between]: [from, to] }, status: "PAID" },
      scope.branchId
    );

    const today = await salesTotalsBetween(whereToday);

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
    });

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
    const paymentRows = await Payment.findAll({
      attributes: ["method", [fn("SUM", col("amount")), "sum_amount"]],
      include: [
        {
          model: Sale,
          as: "sale", // ⚠️ alias Payment->Sale
          attributes: [],
          required: true,
          where: whereToday,
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

    // últimas ventas (tabla) con branch + user SIN romper columnas
    const includeLast = [{ model: Payment, as: "payments", required: false }];

    if (Branch) includeLast.push({ model: Branch, as: "branch", required: false, attributes: ["id", "name"] });

    if (User) {
      const userAttrs = pickExistingAttrs(User, ["full_name", "name", "username", "email", "identifier"], ["id"]);
      includeLast.push({ model: User, as: "user", required: false, attributes: userAttrs });
    }

    const lastSales = await Sale.findAll({
      where: withBranchWhere({ status: "PAID" }, scope.branchId),
      order: [["id", "DESC"]],
      limit: 10,
      include: includeLast,
    });

    // Top productos por facturación (últimos 30 días)
    const d30 = new Date();
    d30.setDate(d30.getDate() - 30);
    d30.setHours(0, 0, 0, 0);

    let topProducts = [];
    try {
      // SaleItem join Sale para filtrar por fecha/branch
      const rows = await SaleItem.findAll({
        attributes: [
          "product_id",
          [fn("SUM", col("line_total")), "sum_total"],
          [fn("SUM", col("quantity")), "sum_qty"],
        ],
        include: [
          {
            model: Sale,
            as: "sale", // ⚠️ alias SaleItem->Sale
            attributes: [],
            required: true,
            where: withBranchWhere({ status: "PAID", sold_at: { [Op.gte]: d30 } }, scope.branchId),
          },
          {
            model: Product,
            as: "product", // ⚠️ alias SaleItem->Product
            attributes: ["id", "name", ...(Product?.rawAttributes?.sku ? ["sku"] : [])],
            required: false,
          },
        ],
        group: ["product_id", "product.id"],
        order: [[fn("SUM", col("line_total")), "DESC"]],
        limit: 10,
      });

      topProducts = rows.map((r) => ({
        product_id: toInt(r.product_id, 0),
        name: r.product?.name || `Producto #${r.product_id}`,
        sku: r.product?.sku || null,
        total: Number(r.get("sum_total") || 0),
        qty: Number(r.get("sum_qty") || 0),
      }));
    } catch {
      topProducts = [];
    }

    // Top vendedores por facturación (últimos 30 días)
    let topSellers = [];
    try {
      const rows = await Sale.findAll({
        attributes: [
          "user_id",
          [fn("SUM", col("total")), "sum_total"],
          [fn("COUNT", col("Sale.id")), "count_sales"],
        ],
        where: withBranchWhere({ status: "PAID", sold_at: { [Op.gte]: d30 } }, scope.branchId),
        group: ["user_id"],
        order: [[fn("SUM", col("total")), "DESC"]],
        limit: 10,
        raw: true,
      });

      const userIds = rows.map((r) => toInt(r.user_id, 0)).filter(Boolean);
      const userAttrs = pickExistingAttrs(User, ["full_name", "name", "username", "email", "identifier"], ["id"]);
      const us = await User.findAll({ where: { id: userIds }, attributes: userAttrs, raw: true }).catch(() => []);
      const mapU = new Map(us.map((u) => [toInt(u.id, 0), u.full_name || u.name || u.username || u.email || u.identifier || `User #${u.id}`]));

      topSellers = rows.map((r) => ({
        user_id: toInt(r.user_id, 0),
        user_label: mapU.get(toInt(r.user_id, 0)) || `User #${r.user_id}`,
        total: Number(r.sum_total || 0),
        count: Number(r.count_sales || 0),
      }));
    } catch {
      topSellers = [];
    }

    // ✅ Admin: ventas por sucursal (para torta y ranking)
    let byBranch = null;
    if (scope.admin && !scope.branchId) {
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
      });

      const brs = await Branch.findAll({ attributes: ["id", "name"], raw: true }).catch(() => []);
      const m = new Map(brs.map((b) => [toInt(b.id, 0), b.name]));

      byBranch = rows.map((r) => ({
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
        today,
        topPaymentLabel,
        paymentsByMethod,
        salesByDay,
        lastSales,
        topProducts,
        topSellers,
        byBranch, // null si no admin o si filtró una sucursal
      },
    });
  } catch (e) {
    console.error("❌ [DASHBOARD SALES ERROR]", e);
    next(e);
  }
}

// ============================
// GET /api/v1/dashboard/stock
// (resuelve tu 404 + mete métricas fuertes)
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

    const warehouseHasBranch = !!Warehouse?.rawAttributes?.branch_id;

    const includeWarehouse = {
      model: Warehouse,
      as: "warehouse", // ⚠️ alias StockBalance->Warehouse
      attributes: ["id", ...(Warehouse?.rawAttributes?.name ? ["name"] : []), ...(warehouseHasBranch ? ["branch_id"] : [])],
      required: true,
      ...(warehouseHasBranch && scope.branchId ? { where: { branch_id: scope.branchId } } : {}),
      include: [
        {
          model: Branch,
          as: "branch", // ⚠️ alias Warehouse->Branch
          attributes: ["id", "name"],
          required: false,
        },
      ],
    };

    const includeProduct = {
      model: Product,
      as: "product", // ⚠️ alias StockBalance->Product
      attributes: ["id", "name", ...(Product?.rawAttributes?.sku ? ["sku"] : [])],
      required: false,
    };

    // KPIs: out/low/ok
    const agg = await StockBalance.findOne({
      attributes: [
        [fn("SUM", literal(`CASE WHEN ${qtyField} <= 0 THEN 1 ELSE 0 END`)), "out_cnt"],
        [fn("SUM", literal(`CASE WHEN ${qtyField} > 0 AND ${qtyField} <= ${lowThreshold} THEN 1 ELSE 0 END`)), "low_cnt"],
        [fn("SUM", literal(`CASE WHEN ${qtyField} > ${lowThreshold} THEN 1 ELSE 0 END`)), "ok_cnt"],
        [fn("SUM", col(qtyField)), "sum_units"],
      ],
      include: [includeWarehouse],
      raw: true,
    }).catch(() => ({ out_cnt: 0, low_cnt: 0, ok_cnt: 0, sum_units: 0 }));

    const kpis = {
      outCount: Number(agg?.out_cnt || 0),
      lowCount: Number(agg?.low_cnt || 0),
      okCount: Number(agg?.ok_cnt || 0),
      totalUnits: Number(agg?.sum_units || 0),
      lowThreshold,
    };

    // Low stock items (tabla)
    const lowItemsRows = await StockBalance.findAll({
      attributes: ["id", "product_id", "warehouse_id", qtyField],
      include: [includeWarehouse, includeProduct],
      where: { [qtyField]: { [Op.lte]: lowThreshold } },
      order: [[col(qtyField), "ASC"]],
      limit: 50,
    }).catch(() => []);

    const lowItems = lowItemsRows.map((r) => ({
      id: r.id,
      product_id: r.product_id,
      product_name: r.product?.name || `Producto #${r.product_id}`,
      sku: r.product?.sku || null,
      warehouse_id: r.warehouse_id,
      warehouse_name: r.warehouse?.name || null,
      branch_id: r.warehouse?.branch_id || null,
      branch_name: r.warehouse?.branch?.name || null,
      qty: Number(r[qtyField] || 0),
      threshold: lowThreshold,
    }));

    // Stock por sucursal (admin only, todas)
    let stockByBranch = null;
    if (scope.admin && !scope.branchId) {
      const rows = await StockBalance.findAll({
        attributes: [
          [col("warehouse.branch_id"), "branch_id"],
          [fn("SUM", literal(`CASE WHEN ${qtyField} <= 0 THEN 1 ELSE 0 END`)), "out_cnt"],
          [fn("SUM", literal(`CASE WHEN ${qtyField} > 0 AND ${qtyField} <= ${lowThreshold} THEN 1 ELSE 0 END`)), "low_cnt"],
          [fn("SUM", literal(`CASE WHEN ${qtyField} > ${lowThreshold} THEN 1 ELSE 0 END`)), "ok_cnt"],
          [fn("SUM", col(qtyField)), "sum_units"],
        ],
        include: [
          {
            model: Warehouse,
            as: "warehouse",
            attributes: [],
            required: true,
          },
        ],
        group: [col("warehouse.branch_id")],
        raw: true,
      });

      const brs = await Branch.findAll({ attributes: ["id", "name"], raw: true }).catch(() => []);
      const m = new Map(brs.map((b) => [toInt(b.id, 0), b.name]));

      stockByBranch = rows.map((r) => ({
        branch_id: toInt(r.branch_id, 0),
        branch_name: m.get(toInt(r.branch_id, 0)) || `Sucursal #${r.branch_id}`,
        out: Number(r.out_cnt || 0),
        low: Number(r.low_cnt || 0),
        ok: Number(r.ok_cnt || 0),
        units: Number(r.sum_units || 0),
      })).sort((a,b) => (b.units - a.units));
    }

    // Movimientos últimos 7 días (para graficar actividad)
    const days = 7;
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);

    const moveWhere = scope.branchId ? { branch_id: scope.branchId } : {};
    const movementByDayRows = await StockMovement.findAll({
      attributes: [
        [fn("DATE", col("created_at")), "day"],
        [fn("COUNT", col("StockMovement.id")), "count_moves"],
      ],
      where: { ...moveWhere, created_at: { [Op.gte]: start } },
      group: [fn("DATE", col("created_at"))],
      order: [[fn("DATE", col("created_at")), "ASC"]],
      raw: true,
    }).catch(() => []);

    const map = new Map();
    for (const r of movementByDayRows) map.set(String(r.day), Number(r.count_moves || 0));

    const movementsByDay = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = ymd(d);
      movementsByDay.push({ date: key, count: map.get(key) || 0 });
    }

    return res.json({
      ok: true,
      scope,
      data: {
        kpis,
        lowItems,
        stockByBranch, // null si no admin/todas
        movementsByDay,
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
