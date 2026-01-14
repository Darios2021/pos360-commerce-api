// src/controllers/admin.shopOrders.controller.js
// ✅ COPY-PASTE FINAL (con scope por branch_ids según RBAC)
//
// Admin Ecommerce Orders
// GET  /api/v1/admin/shop/orders
// GET  /api/v1/admin/shop/orders/:id
//
// Lee desde tablas:
// - ecom_orders, ecom_order_items, ecom_payments, ecom_customers, branches
//
// Soporta filtros:
// - q (public_code, email, nombre)
// - status
// - fulfillment_type
// - branch_id
// - from, to (YYYY-MM-DD)
// - page, limit
//
// ✅ FIX IMPORTANTE:
// - Si NO es super_admin, limita por req.access.branch_ids (user_branches)
// - branch_id solo si está permitido

const { sequelize } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toStr(v) {
  return String(v ?? "").trim();
}

function normDate(v) {
  const s = toStr(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function getAccess(req) {
  const a = req.access || {};
  const branch_ids = Array.isArray(a.branch_ids) ? a.branch_ids.map((x) => toInt(x, 0)).filter(Boolean) : [];
  return {
    is_super_admin: Boolean(a.is_super_admin),
    branch_ids,
  };
}

function buildWhere({ q, status, fulfillment_type, branch_id, from, to, allowedBranchIds, isSuperAdmin }) {
  const where = [];
  const repl = {};

  if (status) {
    where.push("o.status = :status");
    repl.status = status;
  }
  if (fulfillment_type) {
    where.push("o.fulfillment_type = :fulfillment_type");
    repl.fulfillment_type = fulfillment_type;
  }

  // ✅ Scope por sucursal:
  // - super_admin => no aplica
  // - no super_admin => restringe a allowedBranchIds
  if (!isSuperAdmin) {
    const allowed = (allowedBranchIds || []).map((x) => Number(x)).filter(Boolean);

    // si no tiene branches, no debería ver nada
    if (!allowed.length) {
      where.push("1 = 0");
    } else {
      where.push(`o.branch_id IN (:allowed_branch_ids)`);
      repl.allowed_branch_ids = allowed;
    }
  }

  // Filtro por branch_id (solo si está permitido)
  if (branch_id) {
    where.push("o.branch_id = :branch_id");
    repl.branch_id = Number(branch_id);
  }

  const dFrom = normDate(from);
  const dTo = normDate(to);

  if (dFrom) {
    where.push("o.created_at >= CONCAT(:from,' 00:00:00')");
    repl.from = dFrom;
  }
  if (dTo) {
    where.push("o.created_at <= CONCAT(:to,' 23:59:59')");
    repl.to = dTo;
  }

  const qq = toStr(q);
  if (qq) {
    where.push(`
      (
        o.public_code LIKE :q_like
        OR c.email LIKE :q_like
        OR CONCAT(COALESCE(c.first_name,''),' ',COALESCE(c.last_name,'')) LIKE :q_like
        OR CAST(o.id AS CHAR) = :q_exact
      )
    `);
    repl.q_like = `%${qq}%`;
    repl.q_exact = qq;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return { whereSql, repl };
}

// ===============================
// GET /api/v1/admin/shop/orders
// ===============================
async function listOrders(req, res) {
  try {
    const { is_super_admin, branch_ids } = getAccess(req);

    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const q = req.query.q;
    const status = req.query.status;
    const fulfillment_type = req.query.fulfillment_type;
    const branch_id = req.query.branch_id ? Number(req.query.branch_id) : null;
    const from = req.query.from;
    const to = req.query.to;

    // ✅ Si mandan branch_id pero no está permitido => 403
    if (!is_super_admin && branch_id) {
      const ok = branch_ids.includes(Number(branch_id));
      if (!ok) {
        return res.status(403).json({
          ok: false,
          code: "BRANCH_NOT_ALLOWED",
          message: "No tenés permisos para ver pedidos de esa sucursal.",
          branch_id,
          allowed_branch_ids: branch_ids,
        });
      }
    }

    const { whereSql, repl } = buildWhere({
      q,
      status,
      fulfillment_type,
      branch_id,
      from,
      to,
      allowedBranchIds: branch_ids,
      isSuperAdmin: is_super_admin,
    });

    // count
    const [countRows] = await sequelize.query(
      `
      SELECT COUNT(*) AS total
      FROM ecom_orders o
      LEFT JOIN ecom_customers c ON c.id = o.customer_id
      ${whereSql}
      `,
      { replacements: repl }
    );

    const total = Number(countRows?.[0]?.total || 0);

    // data (con agregados de items y pagos)
    const [rows] = await sequelize.query(
      `
      SELECT
        o.id,
        o.public_code,
        o.status,
        o.fulfillment_type,
        o.branch_id,
        b.name AS branch_name,
        o.customer_id,
        c.email AS customer_email,
        CONCAT(COALESCE(c.first_name,''),' ',COALESCE(c.last_name,'')) AS customer_name,
        o.subtotal,
        o.shipping_total,
        o.total,
        o.created_at,

        COALESCE(oi.items_count, 0) AS items_count,
        COALESCE(oi.items_qty, 0) AS items_qty,

        ep.provider AS payment_provider,
        ep.status AS payment_status,
        ep.amount  AS payment_amount

      FROM ecom_orders o
      LEFT JOIN ecom_customers c ON c.id = o.customer_id
      LEFT JOIN branches b ON b.id = o.branch_id

      LEFT JOIN (
        SELECT
          order_id,
          COUNT(*) AS items_count,
          CAST(SUM(qty) AS DECIMAL(14,3)) AS items_qty
        FROM ecom_order_items
        GROUP BY order_id
      ) oi ON oi.order_id = o.id

      LEFT JOIN (
        SELECT p1.*
        FROM ecom_payments p1
        INNER JOIN (
          SELECT order_id, MAX(id) AS max_id
          FROM ecom_payments
          GROUP BY order_id
        ) px ON px.order_id = p1.order_id AND px.max_id = p1.id
      ) ep ON ep.order_id = o.id

      ${whereSql}
      ORDER BY o.id DESC
      LIMIT :limit OFFSET :offset
      `,
      {
        replacements: { ...repl, limit, offset },
      }
    );

    return res.json({
      ok: true,
      data: rows || [],
      meta: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (e) {
    console.error("❌ listOrders error:", e);
    return res.status(500).json({ ok: false, message: "Error listando pedidos.", detail: e?.message || String(e) });
  }
}

// ===============================
// GET /api/v1/admin/shop/orders/:id
// ===============================
async function getOrderById(req, res) {
  try {
    const { is_super_admin, branch_ids } = getAccess(req);

    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const [orders] = await sequelize.query(
      `
      SELECT
        o.*,
        b.name AS branch_name,
        c.email AS customer_email,
        c.first_name,
        c.last_name,
        c.phone,
        c.doc_number
      FROM ecom_orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      LEFT JOIN ecom_customers c ON c.id = o.customer_id
      WHERE o.id = :id
      LIMIT 1
      `,
      { replacements: { id } }
    );

    const order = orders?.[0];
    if (!order) return res.status(404).json({ ok: false, message: "Pedido no encontrado" });

    // ✅ Scope por sucursal en detalle
    if (!is_super_admin) {
      const ok = branch_ids.includes(Number(order.branch_id));
      if (!ok) {
        return res.status(403).json({
          ok: false,
          code: "BRANCH_NOT_ALLOWED",
          message: "No tenés permisos para ver este pedido (sucursal no permitida).",
          order_branch_id: order.branch_id,
          allowed_branch_ids: branch_ids,
        });
      }
    }

    const [items] = await sequelize.query(
      `
      SELECT
        i.id,
        i.order_id,
        i.product_id,
        p.name AS product_name,
        i.qty,
        i.unit_price,
        i.line_total,
        i.created_at
      FROM ecom_order_items i
      JOIN products p ON p.id = i.product_id
      WHERE i.order_id = :id
      ORDER BY i.id ASC
      `,
      { replacements: { id } }
    );

    const [payments] = await sequelize.query(
      `
      SELECT
        id,
        order_id,
        provider,
        status,
        amount,
        external_id,
        external_status,
        external_payload,
        created_at,
        updated_at
      FROM ecom_payments
      WHERE order_id = :id
      ORDER BY id ASC
      `,
      { replacements: { id } }
    );

    return res.json({
      ok: true,
      order,
      items: items || [],
      payments: payments || [],
    });
  } catch (e) {
    console.error("❌ getOrderById error:", e);
    return res.status(500).json({ ok: false, message: "Error obteniendo pedido.", detail: e?.message || String(e) });
  }
}

module.exports = {
  listOrders,
  getOrderById,
};
