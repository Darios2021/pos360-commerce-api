// src/controllers/admin.shopOrders.controller.js
// ✅ COPY-PASTE FINAL (RBAC + FIX COLLATION + payment method UI fields)
//
// Admin Ecommerce Orders
// GET  /api/v1/admin/shop/orders
// GET  /api/v1/admin/shop/orders/:id
//
// Lee desde tablas:
// - ecom_orders, ecom_order_items, ecom_payments, ecom_customers, branches, ecom_payment_methods
//
// ✅ FIX CRÍTICO:
// - Evita "Illegal mix of collations (utf8mb4_0900_ai_ci) and (utf8mb4_unicode_ci)"
//   forzando conversion/collate en expresiones string.
//
// ✅ BONUS:
// - Expone campos del método de pago para que el ADMIN lo muestre igual que el frontend:
//   payment_method_title, badge_text, badge_variant, icon, requires_redirect, allows_proof_upload, is_cash_like

const { sequelize } = require("../models");

const COLL = "utf8mb4_unicode_ci";

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
    roles: Array.isArray(a.roles) ? a.roles : [],
  };
}

function buildWhere({ q, status, fulfillment_type, branch_id, from, to, allowedBranchIds, isSuperAdmin }) {
  const where = [];
  const repl = {};

  if (status) {
    // 🔒 collation-safe compare
    where.push(`o.status COLLATE ${COLL} = CONVERT(:status USING utf8mb4) COLLATE ${COLL}`);
    repl.status = String(status);
  }

  if (fulfillment_type) {
    where.push(
      `o.fulfillment_type COLLATE ${COLL} = CONVERT(:fulfillment_type USING utf8mb4) COLLATE ${COLL}`
    );
    repl.fulfillment_type = String(fulfillment_type);
  }

  // ✅ Scope por sucursal:
  // - super_admin => no aplica
  // - no super_admin => restringe a allowedBranchIds
  if (!isSuperAdmin) {
    const allowed = (allowedBranchIds || []).map((x) => Number(x)).filter(Boolean);

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
    // 🔒 collation-safe LIKE / CONCAT / CAST compare
    where.push(`
      (
        o.public_code COLLATE ${COLL} LIKE CONVERT(:q_like USING utf8mb4) COLLATE ${COLL}
        OR c.email COLLATE ${COLL} LIKE CONVERT(:q_like USING utf8mb4) COLLATE ${COLL}
        OR (
          CONCAT(
            IFNULL(CONVERT(c.first_name USING utf8mb4), ''),
            CONVERT(' ' USING utf8mb4),
            IFNULL(CONVERT(c.last_name USING utf8mb4), '')
          ) COLLATE ${COLL}
        ) LIKE CONVERT(:q_like USING utf8mb4) COLLATE ${COLL}
        OR CAST(o.id AS CHAR) COLLATE ${COLL} = CONVERT(:q_exact USING utf8mb4) COLLATE ${COLL}
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

    // data (con agregados de items y pagos + método bonito)
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

        (
          CONCAT(
            IFNULL(CONVERT(c.first_name USING utf8mb4), ''),
            CONVERT(' ' USING utf8mb4),
            IFNULL(CONVERT(c.last_name USING utf8mb4), '')
          ) COLLATE ${COLL}
        ) AS customer_name,

        o.subtotal,
        o.shipping_total,
        o.total,
        o.created_at,

        COALESCE(oi.items_count, 0) AS items_count,
        COALESCE(oi.items_qty, 0) AS items_qty,

        ep.provider AS payment_provider,
        ep.method   AS payment_method,
        ep.status   AS payment_status,
        ep.amount   AS payment_amount,

        pm.title        AS payment_method_title,
        pm.badge_text   AS payment_method_badge_text,
        pm.badge_variant AS payment_method_badge_variant,
        pm.icon         AS payment_method_icon,
        pm.requires_redirect AS payment_method_requires_redirect,
        pm.allows_proof_upload AS payment_method_allows_proof_upload,
        pm.is_cash_like AS payment_method_is_cash_like

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

      -- último pago por pedido (por id mayor)
      LEFT JOIN (
        SELECT p1.*
        FROM ecom_payments p1
        INNER JOIN (
          SELECT order_id, MAX(id) AS max_id
          FROM ecom_payments
          GROUP BY order_id
        ) px ON px.order_id = p1.order_id AND px.max_id = p1.id
      ) ep ON ep.order_id = o.id

      -- join método de pago (collation-safe)
      LEFT JOIN ecom_payment_methods pm
        ON LOWER(CONVERT(pm.code USING utf8mb4)) COLLATE ${COLL}
         = LOWER(CONVERT(ep.method USING utf8mb4)) COLLATE ${COLL}

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

    // ✅ pagos + join método bonito (collation-safe)
    const [payments] = await sequelize.query(
      `
      SELECT
        p.id,
        p.order_id,
        p.provider,
        p.method,
        p.status,
        p.amount,
        p.reference,
        p.bank_reference,
        p.external_id,
        p.external_status,
        p.external_payload,
        p.proof_url,
        p.mp_preference_id,
        p.created_at,
        p.updated_at,
        p.paid_at,

        pm.title AS method_title,
        pm.description AS method_description,
        pm.badge_text AS method_badge_text,
        pm.badge_variant AS method_badge_variant,
        pm.icon AS method_icon,
        pm.requires_redirect,
        pm.allows_proof_upload,
        pm.is_cash_like

      FROM ecom_payments p
      LEFT JOIN ecom_payment_methods pm
        ON LOWER(CONVERT(pm.code USING utf8mb4)) COLLATE ${COLL}
         = LOWER(CONVERT(p.method USING utf8mb4)) COLLATE ${COLL}
      WHERE p.order_id = :id
      ORDER BY p.id ASC
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

/**
 * PATCH /api/v1/admin/shop/orders/:id/status
 *
 * Body: { status: "created" | "processing" | "ready" | "delivered" | "cancelled" }
 *
 * Reglas:
 * - Cualquier transición es permitida (el operador del POS sabe lo que hace),
 *   pero validamos que el status sea uno de los conocidos.
 * - Auto-setea timestamps según el nuevo status:
 *     processing → processing_at = NOW()
 *     ready      → ready_at = NOW()
 *     delivered  → picked_up_at = NOW()  (cubre "retiró" y "recibió envío")
 *     cancelled  → cancelled_at = NOW()
 * - Si vuelve hacia atrás (ej: delivered → ready), NO limpia timestamps previos:
 *   queremos preservar la historia del pedido. Si hay que reabrir, mejor un
 *   endpoint distinto.
 */
// Migración idempotente: stock_committed indica si el stock real ya fue
// descontado para esta orden. ecomCheckout NO descuenta al crear; el
// descuento ocurre cuando el operador "concreta" la compra desde admin.
let stockCommittedColumnReady = false;
async function ensureStockCommittedColumn() {
  if (stockCommittedColumnReady) return;
  try {
    const [rows] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'ecom_orders'
         AND COLUMN_NAME = 'stock_committed'`
    );
    const exists = Number(rows?.[0]?.n || 0) > 0;
    if (!exists) {
      await sequelize.query(
        `ALTER TABLE ecom_orders ADD COLUMN stock_committed TINYINT(1) NOT NULL DEFAULT 0`
      );
    }
    stockCommittedColumnReady = true;
  } catch (e) {
    console.warn("[admin.shopOrders] migración stock_committed falló:", e?.message);
  }
}

/**
 * Descuento de stock idempotente al concretar el pedido.
 * - Toma el branch_id de la orden y resuelve el warehouse activo.
 * - Solo productos con track_stock = 1.
 * - Marca stock_committed = 1 para evitar doble descuento.
 * - Si la orden ya tenía stock_committed = 1, no toca nada.
 */
async function commitOrderStock({ order_id, t }) {
  const [orderRows] = await sequelize.query(
    `SELECT id, branch_id, stock_committed
       FROM ecom_orders
      WHERE id = :id
      FOR UPDATE`,
    { replacements: { id: order_id }, transaction: t }
  );
  const order = orderRows?.[0];
  if (!order) return { ok: false, reason: "not_found" };
  if (Number(order.stock_committed) === 1) return { ok: true, reason: "already_committed" };

  const branch_id = Number(order.branch_id) || 0;
  if (!branch_id) {
    await sequelize.query(
      `UPDATE ecom_orders SET stock_committed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = :id`,
      { replacements: { id: order_id }, transaction: t }
    );
    return { ok: true, reason: "no_branch" };
  }

  const [whRows] = await sequelize.query(
    `SELECT id FROM warehouses WHERE branch_id = :bid AND is_active = 1 ORDER BY id ASC LIMIT 1`,
    { replacements: { bid: branch_id }, transaction: t }
  );
  const warehouse_id = whRows?.[0]?.id ? Number(whRows[0].id) : 0;
  if (!warehouse_id) {
    await sequelize.query(
      `UPDATE ecom_orders SET stock_committed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = :id`,
      { replacements: { id: order_id }, transaction: t }
    );
    return { ok: true, reason: "no_warehouse" };
  }

  const [items] = await sequelize.query(
    `SELECT oi.product_id, oi.qty, p.name AS product_name
       FROM ecom_order_items oi
       JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = :id AND p.track_stock = 1`,
    { replacements: { id: order_id }, transaction: t }
  );

  for (const it of items || []) {
    const pid = Number(it.product_id);
    const qty = Number(it.qty);
    if (!pid || !(qty > 0)) continue;
    await sequelize.query(
      `UPDATE stock_balances SET qty = qty - :qty WHERE warehouse_id = :wid AND product_id = :pid`,
      { replacements: { qty, wid: warehouse_id, pid }, transaction: t }
    );
  }

  await sequelize.query(
    `UPDATE ecom_orders SET stock_committed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = :id`,
    { replacements: { id: order_id }, transaction: t }
  );

  return { ok: true, reason: "committed", items_count: items?.length || 0, warehouse_id };
}

async function updateStatus(req, res) {
  try {
    const orderId = toInt(req.params.id, 0);
    if (!orderId) {
      return res.status(400).json({ ok: false, message: "order_id inválido" });
    }

    const VALID = ["created", "processing", "ready", "delivered", "cancelled"];
    const next = String(req.body?.status || "").trim().toLowerCase();
    if (!VALID.includes(next)) {
      return res.status(400).json({
        ok: false,
        message: `status inválido. Debe ser uno de: ${VALID.join(", ")}`,
      });
    }

    await ensureStockCommittedColumn();

    // Verificamos que el pedido exista
    const [rows] = await sequelize.query(
      `SELECT id, status, stock_committed FROM ecom_orders WHERE id = :id LIMIT 1`,
      { replacements: { id: orderId } }
    );
    const current = rows?.[0];
    if (!current) {
      return res.status(404).json({ ok: false, message: "Pedido no encontrado" });
    }

    // Mapeo status → columna timestamp a actualizar (solo si era NULL).
    const tsColMap = {
      processing: "processing_at",
      ready: "ready_at",
      delivered: "picked_up_at",
      cancelled: "cancelled_at",
    };
    const tsCol = tsColMap[next] || null;

    // ¿Esta transición concreta la compra (descuento real de stock)?
    // Cuando pasa a "processing" o "ready" o "delivered" por primera vez
    // (stock_committed === 0), descontamos stock dentro de la TX.
    const COMMITS_STOCK = new Set(["processing", "ready", "delivered"]);
    const willCommitStock = COMMITS_STOCK.has(next) && Number(current.stock_committed) === 0;

    let commitResult = null;
    await sequelize.transaction(async (t) => {
      if (willCommitStock) {
        commitResult = await commitOrderStock({ order_id: orderId, t });
      }

      let setClause = `status = :status, updated_at = CURRENT_TIMESTAMP`;
      if (tsCol) {
        setClause += `, ${tsCol} = COALESCE(${tsCol}, CURRENT_TIMESTAMP)`;
      }
      await sequelize.query(
        `UPDATE ecom_orders SET ${setClause} WHERE id = :id`,
        { replacements: { status: next, id: orderId }, transaction: t }
      );
    });

    // Devolvemos el order actualizado para que el admin refresque su UI.
    const [updatedRows] = await sequelize.query(
      `SELECT * FROM ecom_orders WHERE id = :id LIMIT 1`,
      { replacements: { id: orderId } }
    );

    // Disparar alerta Telegram en CADA cambio de estado (fire-and-forget).
    // Diferenciamos:
    //  - processing/ready/delivered con stock recién descontado
    //  - processing/ready/delivered sin descuento (ya estaba committed)
    //  - cancelled
    if (current.status !== next) {
      const stockJustCommitted = !!(willCommitStock && commitResult?.reason === "committed");
      notifyShopOrderStatusChanged({
        order_id: orderId,
        previous_status: current.status,
        new_status: next,
        stock_just_committed: stockJustCommitted,
      }).catch((e) => console.warn("[admin.shopOrders] notify falló:", e?.message));
    }

    return res.json({
      ok: true,
      order: updatedRows?.[0] || null,
      previous_status: current.status,
      new_status: next,
      stock_commit: commitResult,
    });
  } catch (e) {
    console.error("❌ updateStatus error:", e);
    return res.status(500).json({
      ok: false,
      message: "Error actualizando estado.",
      detail: e?.message || String(e),
    });
  }
}

/**
 * Mapea el nuevo status a un título + emoji + sufijo según el contexto.
 * Si el stock acaba de descontarse en esta transición, se aclara
 * para que el operador sepa que recién ahora "salió" del inventario.
 */
function statusToTitle(new_status, stock_just_committed) {
  const s = String(new_status || "").toLowerCase();
  const stockNote = stock_just_committed ? " — stock descontado" : "";
  switch (s) {
    case "processing":
      return `📦 Pedido en preparación${stockNote}`;
    case "ready":
      return `✅ Pedido listo para retirar${stockNote}`;
    case "delivered":
      return `🎉 Pedido entregado al cliente${stockNote}`;
    case "cancelled":
      return "❌ Pedido cancelado";
    case "created":
      return "↩️ Pedido reabierto (volvió a creado)";
    default:
      return `🔔 Estado del pedido cambiado a "${new_status}"`;
  }
}

/**
 * Telegram: aviso en CADA cambio de estado de un pedido del shop.
 * Fire-and-forget. El title varía según el status y si el stock
 * se descontó en esta transición.
 */
async function notifyShopOrderStatusChanged({ order_id, previous_status, new_status, stock_just_committed }) {
  try {
    const tg = require("../services/telegramNotifier.service");

    const [orderRows] = await sequelize.query(
      `SELECT o.id, o.public_code, o.fulfillment_type, o.branch_id, o.total,
              o.ship_address1, o.ship_city, o.ship_province,
              o.ship_name, o.ship_phone,
              b.name AS branch_name
         FROM ecom_orders o
         LEFT JOIN branches b ON b.id = o.branch_id
        WHERE o.id = :id LIMIT 1`,
      { replacements: { id: order_id } }
    );
    const order = orderRows?.[0];
    if (!order) return;

    let buyer_name = null, buyer_email = null, buyer_phone = null, method_code = null;
    try {
      const [payRows] = await sequelize.query(
        `SELECT external_payload, method
           FROM ecom_payments WHERE order_id = :id ORDER BY id DESC LIMIT 1`,
        { replacements: { id: order_id } }
      );
      const raw = payRows?.[0]?.external_payload;
      method_code = payRows?.[0]?.method || null;
      if (raw) {
        const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
        buyer_name = payload?.buyer?.name || null;
        buyer_email = payload?.buyer?.email || null;
        buyer_phone = payload?.buyer?.phone || null;
      }
    } catch (_) {}

    const [items] = await sequelize.query(
      `SELECT oi.qty, p.name AS product_name
         FROM ecom_order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = :id`,
      { replacements: { id: order_id } }
    );

    const fmtMoney = (n) =>
      `$ ${new Intl.NumberFormat("es-AR").format(Math.round(Number(n) || 0))}`;

    const itemsSummary = (items || [])
      .slice(0, 5)
      .map((x) => `• ${x.qty}× ${x.product_name || "Producto"}`)
      .join("\n");
    const moreCount = (items?.length || 0) > 5 ? `\n• +${items.length - 5} más…` : "";

    const isPickup = String(order.fulfillment_type) === "pickup";

    const adminBase =
      toStr(process.env.ADMIN_BASE_URL) ||
      toStr(process.env.PUBLIC_BASE_URL) ||
      "https://sanjuantecnologia.com";
    const adminUrl = `${adminBase.replace(/\/$/, "")}/app/admin/shop/orders/${order.id}`;

    const lines = [
      { k: "Pedido", v: order.public_code || `#${order.id}` },
      { k: "Estado", v: `${previous_status || "—"} → <b>${new_status}</b>` },
      { k: "Cliente", v: buyer_name || order.ship_name || "—" },
      buyer_email ? { k: "Email", v: buyer_email } : null,
      { k: "Teléfono", v: buyer_phone || order.ship_phone || "—" },
      { k: "Total", v: fmtMoney(order.total) },
      {
        k: "Tipo",
        v: isPickup
          ? `Retiro en sucursal${order.branch_name ? ` — ${order.branch_name}` : ""}`
          : `Envío — ${[order.ship_address1, order.ship_city, order.ship_province].filter(Boolean).join(", ") || "—"}`,
      },
      method_code ? { k: "Medio de pago", v: formatPaymentLabel(method_code, order.fulfillment_type) } : null,
      `\n<b>Productos:</b>\n${itemsSummary}${moreCount}`,
      `\n<a href="${adminUrl}">🔧 Gestionar pedido en backoffice</a>`,
    ].filter(Boolean);

    // Cancelaciones tienen severity media para que destaquen visualmente.
    const isCancel = String(new_status).toLowerCase() === "cancelled";

    await tg.sendAlert({
      code: "shop_order_status_changed",
      toggleKey: "alert_shop_order_status_changed",
      title: statusToTitle(new_status, stock_just_committed),
      lines,
      severity: isCancel ? "medium" : "low",
      reference_type: "ecom_order",
      reference_id: order.id,
      // Permitir múltiples alertas para la misma orden (una por estado).
      // Sin esto, dedupe bloquearía la 2da+ transición.
      dedupe_key_extra: `status:${new_status}`,
      ref: order.public_code || null,
    });
  } catch (e) {
    console.warn("[admin.shopOrders] notifyShopOrderConfirmed falló:", e?.message || e);
  }
}

/**
 * Convierte method_code en una etiqueta humana en español, contextualizada
 * según fulfillment_type (cash + pickup → "Efectivo (paga en sucursal al
 * retirar)" vs cash + delivery → "Efectivo (paga al recibir el envío)").
 */
function formatPaymentLabel(method_code, fulfillment_type) {
  const code = String(method_code || "").toLowerCase();
  const isPickup = String(fulfillment_type || "") === "pickup";
  switch (code) {
    case "cash":
      return isPickup
        ? "Efectivo (paga en sucursal al retirar)"
        : "Efectivo (paga al recibir el envío)";
    case "transfer": return "Transferencia bancaria";
    case "mercadopago":
    case "mercado_pago": return "Mercado Pago";
    case "credit_sjt": return "Crédito San Juan Tecnología (gestiona en sucursal)";
    case "seller":
    case "agree": return "Acuerda con el vendedor";
    case "": return "";
    default: return method_code;
  }
}

module.exports = {
  listOrders,
  getOrderById,
  updateStatus,
};
