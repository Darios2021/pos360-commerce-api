// src/controllers/dashboard.controller.js
const { Op, fn, col, literal } = require("sequelize");
const { Product, Category, Sale, Payment, Branch, User } = require("../models");

// ===== Helpers =====
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
 * ✅ Decide el scope de sucursal:
 * - Admin: puede ver todas (si no manda branch_id), o filtrar si manda branch_id
 * - No-admin: obligado a su branch
 */
function resolveBranchScope(req) {
  const admin = isAdminReq(req);

  // admin puede filtrar por query
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

/**
 * Helpers: agrega branch_id si aplica
 */
function withBranchWhere(whereBase, branchId) {
  const where = { ...(whereBase || {}) };
  if (branchId) where.branch_id = branchId;
  return where;
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

    // Si Product tiene branch_id, filtramos por branch cuando corresponda
    const productHasBranch = !!Product?.rawAttributes?.branch_id;
    const categoryHasBranch = !!Category?.rawAttributes?.branch_id;

    const prodWhere = productHasBranch ? withBranchWhere({}, scope.branchId) : {};
    const prodActiveWhere = productHasBranch
      ? withBranchWhere({ is_active: 1 }, scope.branchId)
      : { is_active: 1 };

    const totalProducts = await Product.count({ where: prodWhere });
    const activeProducts = await Product.count({ where: prodActiveWhere });

    const noPriceWhere = {
      [Op.and]: [
        { [Op.or]: [{ price_list: { [Op.lte]: 0 } }, { price_list: null }] },
        { [Op.or]: [{ price: { [Op.lte]: 0 } }, { price: null }] },
      ],
    };
    const noPriceProducts = await Product.count({
      where: productHasBranch ? withBranchWhere(noPriceWhere, scope.branchId) : noPriceWhere,
    });

    const categories = await Category.count({
      where: categoryHasBranch ? withBranchWhere({}, scope.branchId) : {},
    });

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
      scope,
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

    // Where base (con branch si aplica)
    const saleWhereToday = withBranchWhere(
      { sold_at: { [Op.between]: [from, to] }, status: "PAID" },
      scope.branchId
    );

    // --- Ventas hoy (conteo + total + ticket prom) ---
    const todayCount = await Sale.count({ where: saleWhereToday });

    const todayTotalRow = await Sale.findOne({
      attributes: [[fn("SUM", col("total")), "sum_total"]],
      where: saleWhereToday,
      raw: true,
    });

    const todayTotal = Number(todayTotalRow?.sum_total || 0);
    const avgTicket = todayCount > 0 ? todayTotal / todayCount : 0;

    // --- Pagos hoy por método ---
    // Payment -> Sale (alias "sale") + filtra por fechas/branch/status en Sale
    const paymentRows = await Payment.findAll({
      attributes: ["method", [fn("SUM", col("amount")), "sum_amount"]],
      include: [
        {
          model: Sale,
          as: "sale",
          attributes: [],
          required: true,
          where: saleWhereToday,
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

    // --- Ventas últimos 7 días (global o por branch) ---
    const days = 7;
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);

    const saleWhere7 = withBranchWhere({ sold_at: { [Op.gte]: start }, status: "PAID" }, scope.branchId);

    const salesByDayRows = await Sale.findAll({
      attributes: [
        [fn("DATE", col("sold_at")), "day"],
        [fn("SUM", col("total")), "sum_total"],
      ],
      where: saleWhere7,
      group: [fn("DATE", col("sold_at"))],
      order: [[fn("DATE", col("sold_at")), "ASC"]],
      raw: true,
    });

    const map = new Map();
    for (const r of salesByDayRows) {
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
    // Incluimos payments + branch + user (si existen asociaciones)
    const includeLast = [
      { model: Payment, as: "payments", required: false },
    ];

    if (Branch) {
      includeLast.push({ model: Branch, as: "branch", required: false, attributes: ["id", "name"] });
    }
    if (User) {
      // evitamos user.name si no existe
      const attrs = ["id"];
      if (User.rawAttributes?.full_name) attrs.push("full_name");
      if (User.rawAttributes?.name) attrs.push("name");
      if (User.rawAttributes?.username) attrs.push("username");
      if (User.rawAttributes?.email) attrs.push("email");
      if (User.rawAttributes?.identifier) attrs.push("identifier");

      includeLast.push({ model: User, as: "user", required: false, attributes: attrs });
    }

    const lastSales = await Sale.findAll({
      where: withBranchWhere({ status: "PAID" }, scope.branchId),
      order: [["id", "DESC"]],
      limit: 10,
      include: includeLast,
    });

    // ============================
    // ✅ EXTRA PARA ADMIN: breakdown por sucursal
    // ============================
    let byBranch = null;

    if (scope.admin && !scope.branchId) {
      // Hoy por sucursal
      const todayByBranchRows = await Sale.findAll({
        attributes: [
          "branch_id",
          [fn("COUNT", col("id")), "count_sales"],
          [fn("SUM", col("total")), "sum_total"],
        ],
        where: { sold_at: { [Op.between]: [from, to] }, status: "PAID" },
        group: ["branch_id"],
        order: [[fn("SUM", col("total")), "DESC"]],
        raw: true,
      });

      // Últimos 7 días por sucursal (una curva por branch)
      const sales7ByBranchRows = await Sale.findAll({
        attributes: [
          "branch_id",
          [fn("DATE", col("sold_at")), "day"],
          [fn("SUM", col("total")), "sum_total"],
        ],
        where: { sold_at: { [Op.gte]: start }, status: "PAID" },
        group: ["branch_id", fn("DATE", col("sold_at"))],
        order: [["branch_id", "ASC"], [fn("DATE", col("sold_at")), "ASC"]],
        raw: true,
      });

      // Pagos hoy por sucursal + método
      const paymentsTodayByBranchRows = await Payment.findAll({
        attributes: [
          "method",
          [col("sale.branch_id"), "branch_id"],
          [fn("SUM", col("amount")), "sum_amount"],
        ],
        include: [
          {
            model: Sale,
            as: "sale",
            attributes: [],
            required: true,
            where: { sold_at: { [Op.between]: [from, to] }, status: "PAID" },
          },
        ],
        group: [col("sale.branch_id"), "method"],
        raw: true,
      });

      // Mapa nombres de sucursal (si Branch existe)
      let branchNameMap = new Map();
      if (Branch) {
        const brs = await Branch.findAll({ attributes: ["id", "name"], raw: true });
        branchNameMap = new Map(brs.map((b) => [toInt(b.id, 0), b.name]));
      }

      // Normalizamos “hoy por sucursal”
      const todayByBranch = todayByBranchRows.map((r) => {
        const bid = toInt(r.branch_id, 0);
        return {
          branch_id: bid,
          branch_name: branchNameMap.get(bid) || null,
          count: Number(r.count_sales || 0),
          total: Number(r.sum_total || 0),
        };
      });

      // Normalizamos curva 7 días por sucursal
      const curveMap = new Map(); // branch_id -> Map(day->total)
      for (const r of sales7ByBranchRows) {
        const bid = toInt(r.branch_id, 0);
        const day = String(r.day);
        const tot = Number(r.sum_total || 0);
        if (!curveMap.has(bid)) curveMap.set(bid, new Map());
        curveMap.get(bid).set(day, tot);
      }

      const salesByDayByBranch = [];
      for (const [bid, dayMap] of curveMap.entries()) {
        const series = [];
        for (let i = 0; i < days; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          const key = ymd(d);
          series.push({ date: key, total: dayMap.get(key) || 0 });
        }
        salesByDayByBranch.push({
          branch_id: bid,
          branch_name: branchNameMap.get(bid) || null,
          series,
        });
      }

      // Normalizamos pagos hoy por sucursal
      const paymentsByBranch = new Map(); // branch_id -> { METHOD: amount }
      for (const r of paymentsTodayByBranchRows) {
        const bid = toInt(r.branch_id, 0);
        const m = String(r.method || "").toUpperCase();
        const v = Number(r.sum_amount || 0);
        if (!paymentsByBranch.has(bid)) paymentsByBranch.set(bid, {});
        paymentsByBranch.get(bid)[m] = v;
      }

      const paymentsTodayByBranch = [];
      for (const [bid, obj] of paymentsByBranch.entries()) {
        paymentsTodayByBranch.push({
          branch_id: bid,
          branch_name: branchNameMap.get(bid) || null,
          paymentsByMethod: obj,
        });
      }

      byBranch = {
        todayByBranch,
        salesByDayByBranch,
        paymentsTodayByBranch,
      };
    }

    return res.json({
      ok: true,
      scope,
      data: {
        todayCount,
        todayTotal,
        avgTicket,
        topPaymentLabel,
        salesByDay,
        paymentsByMethod,
        lastSales,

        // ✅ Solo viene poblado cuando admin ve todas las sucursales
        byBranch,
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
