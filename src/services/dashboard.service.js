// ✅ COPY-PASTE FINAL COMPLETO
// src/services/dashboard.service.js
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");

// =========================
// Helpers
// =========================
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
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

function ymd(d) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

// =========================
// Queries (RAW SQL) — exacto a tu BD
// =========================
async function queryOne(sql, replacements = {}) {
  const rows = await sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
  return rows?.[0] || null;
}

async function queryAll(sql, replacements = {}) {
  return sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
}

// =========================
// SALES
// =========================
async function getSalesTotals({ from, to, branchId = null }) {
  const whereBranch = branchId ? "AND s.branch_id = :branchId" : "";
  const row = await queryOne(
    `
    SELECT
      COUNT(*) AS count_sales,
      COALESCE(SUM(s.total),0) AS sum_total,
      COALESCE(AVG(s.total),0) AS avg_ticket,
      COALESCE(SUM(s.discount_total),0) AS sum_discount,
      COALESCE(SUM(s.tax_total),0) AS sum_tax
    FROM sales s
    WHERE s.status='PAID'
      AND s.sold_at BETWEEN :from AND :to
      ${whereBranch}
    `,
    { from, to, branchId }
  );

  return {
    count: Number(row?.count_sales || 0),
    total: Number(row?.sum_total || 0),
    avgTicket: Number(row?.avg_ticket || 0),
    discountTotal: Number(row?.sum_discount || 0),
    taxTotal: Number(row?.sum_tax || 0),
  };
}

async function getPaymentsByMethodToday({ from, to, branchId = null }) {
  const whereBranch = branchId ? "AND s.branch_id = :branchId" : "";
  const rows = await queryAll(
    `
    SELECT
      p.method AS method,
      COALESCE(SUM(p.amount),0) AS sum_amount
    FROM payments p
    INNER JOIN sales s ON s.id = p.sale_id
    WHERE s.status='PAID'
      AND s.sold_at BETWEEN :from AND :to
      ${whereBranch}
    GROUP BY p.method
    ORDER BY sum_amount DESC
    `,
    { from, to, branchId }
  );

  return (rows || []).map((r) => ({
    method: String(r.method || "").toUpperCase(),
    label: methodLabel(r.method),
    total: Number(r.sum_amount || 0),
  }));
}

async function getSalesByDay({ start, days = 7, branchId = null }) {
  const whereBranch = branchId ? "AND s.branch_id = :branchId" : "";
  const rows = await queryAll(
    `
    SELECT
      DATE(s.sold_at) AS day,
      COALESCE(SUM(s.total),0) AS sum_total,
      COUNT(*) AS count_sales
    FROM sales s
    WHERE s.status='PAID'
      AND s.sold_at >= :start
      ${whereBranch}
    GROUP BY DATE(s.sold_at)
    ORDER BY day ASC
    `,
    { start, branchId }
  );

  const map = new Map();
  for (const r of rows || []) {
    map.set(String(r.day), { total: Number(r.sum_total || 0), count: Number(r.count_sales || 0) });
  }

  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = ymd(d);
    const v = map.get(key) || { total: 0, count: 0 };
    out.push({ date: key, total: v.total, count: v.count });
  }
  return out;
}

async function getSalesByBranch({ from, branchId = null }) {
  const whereBranch = branchId ? "AND s.branch_id = :branchId" : "";
  const rows = await queryAll(
    `
    SELECT
      s.branch_id,
      b.name AS branch_name,
      COALESCE(SUM(s.total),0) AS sum_total,
      COUNT(*) AS count_sales
    FROM sales s
    LEFT JOIN branches b ON b.id = s.branch_id
    WHERE s.status='PAID'
      AND s.sold_at >= :from
      ${whereBranch}
    GROUP BY s.branch_id, b.name
    ORDER BY sum_total DESC
    `,
    { from, branchId }
  );

  return (rows || []).map((r) => ({
    branch_id: Number(r.branch_id || 0),
    branch_name: r.branch_name || `Sucursal #${r.branch_id}`,
    total: Number(r.sum_total || 0),
    count: Number(r.count_sales || 0),
  }));
}

async function getLastSales({ limit = 10, branchId = null }) {
  const whereBranch = branchId ? "WHERE s.branch_id = :branchId" : "WHERE 1=1";
  const rows = await queryAll(
    `
    SELECT
      s.id,
      s.sold_at,
      s.status,
      s.total,
      s.customer_name,
      s.branch_id,
      b.name AS branch_name,
      s.user_id,
      u.username,
      u.name AS user_name,
      u.full_name AS user_full_name,
      -- método principal (primer pago más grande)
      (
        SELECT p.method
        FROM payments p
        WHERE p.sale_id = s.id
        ORDER BY p.amount DESC, p.id DESC
        LIMIT 1
      ) AS top_method
    FROM sales s
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN users u ON u.id = s.user_id
    ${whereBranch}
      AND s.status='PAID'
    ORDER BY s.id DESC
    LIMIT ${Number(limit) || 10}
    `,
    { branchId }
  );

  // compat con tu tabla (que lee payments[0].method a veces)
  return (rows || []).map((r) => ({
    id: r.id,
    sold_at: r.sold_at,
    status: r.status,
    total: Number(r.total || 0),
    customer_name: r.customer_name || null,
    branch_id: r.branch_id,
    branch: r.branch_id ? { id: r.branch_id, name: r.branch_name } : null,
    user_id: r.user_id,
    user: r.user_id
      ? {
          id: r.user_id,
          label: r.user_full_name || r.user_name || r.username || `User #${r.user_id}`,
        }
      : null,
    payments: r.top_method ? [{ method: r.top_method }] : [],
  }));
}

// =========================
// INVENTORY
// =========================
async function getInventory({ branchId = null }) {
  const whereBranch = branchId ? "WHERE p.branch_id = :branchId" : "WHERE 1=1";

  const totals = await queryOne(
    `
    SELECT
      COUNT(*) AS total_products,
      SUM(CASE WHEN p.is_active=1 THEN 1 ELSE 0 END) AS active_products,
      SUM(CASE WHEN (p.price<=0 OR p.price IS NULL) AND (p.price_list<=0 OR p.price_list IS NULL) THEN 1 ELSE 0 END) AS no_price_products
    FROM products p
    ${whereBranch}
    `,
    { branchId }
  );

  const categories = await queryOne(`SELECT COUNT(*) AS cnt FROM categories`, {});
  const lastProducts = await queryAll(
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
    ${whereBranch}
    ORDER BY p.id DESC
    LIMIT 10
    `,
    { branchId }
  );

  return {
    totalProducts: Number(totals?.total_products || 0),
    activeProducts: Number(totals?.active_products || 0),
    noPriceProducts: Number(totals?.no_price_products || 0),
    categories: Number(categories?.cnt || 0),
    lastProducts: (lastProducts || []).map((r) => ({
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
    })),
  };
}

// =========================
// STOCK
// =========================
async function getStock({ branchId = null, lowThreshold = 3 }) {
  // ✅ Tu columna real es stock_balances.qty
  const whereBranch = branchId ? "AND w.branch_id = :branchId" : "";

  const agg = await queryOne(
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
      ${whereBranch}
    `,
    { branchId, lowThreshold }
  );

  const lowItems = await queryAll(
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
      ${whereBranch}
    ORDER BY sb.qty ASC
    LIMIT 50
    `,
    { branchId, lowThreshold }
  );

  const stockByBranch = await queryAll(
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
      ${whereBranch}
    GROUP BY w.branch_id, b.name
    ORDER BY sum_units DESC
    `,
    { branchId, lowThreshold }
  );

  return {
    outOfStockCount: Number(agg?.out_cnt || 0),
    lowStockCount: Number(agg?.low_cnt || 0),
    trackedProducts: Number(agg?.distinct_products || 0),
    okStockCount: Number(agg?.ok_cnt || 0),
    totalUnits: Number(agg?.sum_units || 0),
    lowThreshold,

    lowStockItems: (lowItems || []).map((r) => ({
      product_id: r.product_id,
      name: r.name || `Producto #${r.product_id}`,
      sku: r.sku || null,
      stock: Number(r.stock || 0),
      min_stock: lowThreshold, // tu tabla no tiene min_stock, lo emulamos con threshold
      warehouse_id: r.warehouse_id,
      warehouse_name: r.warehouse_name || null,
      branch_id: r.branch_id || null,
      branch_name: r.branch_name || null,
    })),

    stockByBranch: (stockByBranch || []).map((r) => ({
      branch_id: Number(r.branch_id || 0),
      branch_name: r.branch_name || `Sucursal #${r.branch_id}`,
      out: Number(r.out_cnt || 0),
      low: Number(r.low_cnt || 0),
      ok: Number(r.ok_cnt || 0),
      units: Number(r.sum_units || 0),
    })),
  };
}

module.exports = {
  // scope helpers
  resolveBranchScope,

  // overview parts
  getSalesTotals,
  getPaymentsByMethodToday,
  getSalesByDay,
  getSalesByBranch,
  getLastSales,

  // inventory/stock
  getInventory,
  getStock,

  // misc helpers
  startOfDay,
  endOfDay,
  pctChange,
  methodLabel,
};