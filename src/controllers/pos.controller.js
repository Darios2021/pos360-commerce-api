// ✅ COPY-PASTE FINAL
// src/controllers/pos.controller.js
// (solo cambia createSale: ahora guarda customer_phone + customer_doc y soporta body.extra.customer)

const { literal } = require("sequelize");
const {
  sequelize,
  Sale,
  SaleItem,
  Payment,
  Product,
  StockBalance,
  StockMovement,
  StockMovementItem,
  Warehouse,
} = require("../models");

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toInt(v, def = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : def;
}

function normalizeRoles(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((r) => String(r || "").toLowerCase()).filter(Boolean);
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeBranchIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => toInt(x, 0)).filter(Boolean);
  return String(raw || "")
    .split(",")
    .map((s) => toInt(s.trim(), 0))
    .filter(Boolean);
}

/**
 * ✅ Admin robusto:
 * - roles: ["admin"] / ["super_admin"] / ["superadmin"]
 * - role/user_role: "admin" / "super_admin" / "superadmin"
 * - is_admin: true
 */
function isAdminReq(req) {
  const u = req?.user || {};
  const roles = normalizeRoles(u.roles);

  if (roles.includes("admin") || roles.includes("superadmin") || roles.includes("super_admin")) return true;

  const role = String(u.role || u.user_role || "").toLowerCase();
  if (role === "admin" || role === "superadmin" || role === "super_admin") return true;

  if (u.is_admin === true) return true;

  return false;
}

function rid(req) {
  return (
    req?.headers?.["x-request-id"] ||
    req?.headers?.["x-correlation-id"] ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function logPos(req, level, msg, extra = {}) {
  const base = {
    rid: req._rid,
    path: req.originalUrl,
    method: req.method,
    user_id: req?.user?.id ?? null,
    user_email: req?.user?.email ?? null,
    user_branch_id: req?.user?.branch_id ?? null,
    user_role: req?.user?.role ?? req?.user?.user_role ?? null,
    user_roles: req?.user?.roles ?? null,
    user_branches: req?.user?.branches ?? null,
    ctx_branchId: req?.ctx?.branchId ?? null,
    ctx_warehouseId: req?.ctx?.warehouseId ?? null,
    q_branch_id: req?.query?.branch_id ?? req?.query?.branchId ?? null,
    q_warehouse_id: req?.query?.warehouse_id ?? req?.query?.warehouseId ?? null,
  };
  // eslint-disable-next-line no-console
  console[level](`[POS] ${msg}`, { ...base, ...extra });
}

/**
 * ✅ SOLO valores EXPLÍCITOS (query/body).
 */
function resolveExplicitPosContext(req) {
  const branchId =
    toInt(req?.body?.branch_id, 0) ||
    toInt(req?.query?.branch_id, 0) ||
    toInt(req?.query?.branchId, 0);

  const warehouseId =
    toInt(req?.body?.warehouse_id, 0) ||
    toInt(req?.query?.warehouse_id, 0) ||
    toInt(req?.query?.warehouseId, 0);

  return { branchId, warehouseId };
}

/**
 * ✅ Resuelve branchId/warehouseId de forma robusta (incluye ctx)
 */
function resolvePosContext(req) {
  const branchId =
    toInt(req?.body?.branch_id, 0) ||
    toInt(req?.query?.branch_id, 0) ||
    toInt(req?.query?.branchId, 0) ||
    toInt(req?.ctx?.branchId, 0);

  const warehouseId =
    toInt(req?.body?.warehouse_id, 0) ||
    toInt(req?.query?.warehouse_id, 0) ||
    toInt(req?.query?.warehouseId, 0) ||
    toInt(req?.ctx?.warehouseId, 0);

  return { branchId, warehouseId };
}

async function resolveWarehouseForBranch(branchId) {
  const bid = toInt(branchId, 0);
  if (!bid) return 0;

  const w = await Warehouse.findOne({
    where: { branch_id: bid },
    order: [["id", "ASC"]],
    attributes: ["id"],
  });

  return toInt(w?.id, 0);
}

async function assertWarehouseBelongsToBranch(warehouseId, branchId) {
  const wid = toInt(warehouseId, 0);
  const bid = toInt(branchId, 0);
  if (!wid || !bid) return true;

  const w = await Warehouse.findByPk(wid, { attributes: ["id", "branch_id"] });
  if (!w) return false;
  return toInt(w.branch_id, 0) === bid;
}

async function getContext(req, res) {
  req._rid = req._rid || rid(req);

  try {
    const admin = isAdminReq(req);
    const userBranchId = toInt(req?.user?.branch_id, 0);

    const explicit = resolveExplicitPosContext(req);
    const fallback = resolvePosContext(req);

    const resolvedBranchId = admin
      ? (toInt(explicit.branchId, 0) || userBranchId || toInt(fallback.branchId, 0) || 0)
      : userBranchId;

    let resolvedWarehouseId = admin ? toInt(explicit.warehouseId, 0) : toInt(fallback.warehouseId, 0);

    if (!admin && !resolvedWarehouseId && resolvedBranchId) {
      resolvedWarehouseId = await resolveWarehouseForBranch(resolvedBranchId);
    }

    logPos(req, "info", "getContext resolved", {
      admin,
      resolvedBranchId,
      resolvedWarehouseId,
      explicit,
      fallback,
    });

    let warehouseObj = null;
    if (resolvedWarehouseId) {
      const w = await Warehouse.findByPk(resolvedWarehouseId, {
        attributes: ["id", "branch_id", "name"],
      });
      if (w) warehouseObj = w.toJSON();
    }

    return res.json({
      ok: true,
      data: {
        user: req.user
          ? {
              id: req.user.id,
              email: req.user.email,
              username: req.user.username,
              branch_id: req.user.branch_id,
              roles: req.user.roles,
              role: req.user.role || req.user.user_role || null,
              is_admin: req.user.is_admin || false,
              branches: req.user.branches || null,
            }
          : null,
        branch: resolvedBranchId ? { id: resolvedBranchId } : null,
        warehouse: warehouseObj || (resolvedWarehouseId ? { id: resolvedWarehouseId } : null),
        branchId: resolvedBranchId || null,
        warehouseId: resolvedWarehouseId || null,
      },
    });
  } catch (e) {
    logPos(req, "error", "getContext error", { err: e.message });
    return res.status(500).json({ ok: false, code: "POS_CONTEXT_ERROR", message: e.message });
  }
}

/**
 * ✅ POS PRODUCTS
 * (sin cambios)
 */
async function listProductsForPos(req, res) {
  req._rid = req._rid || rid(req);

  try {
    const admin = isAdminReq(req);

    const { branchId, warehouseId } = admin ? resolveExplicitPosContext(req) : resolvePosContext(req);

    let resolvedWarehouseId = toInt(warehouseId, 0);
    const resolvedBranchId = toInt(branchId, 0);

    const allowedBranchIds = normalizeBranchIds(req?.user?.branches);
    const hasMultiBranches = !admin && allowedBranchIds.length > 1;

    const explicit = resolveExplicitPosContext(req);
    const cameWarehouseExplicit = toInt(explicit.warehouseId, 0) > 0;

    if (!admin && !resolvedWarehouseId && resolvedBranchId) {
      if (!hasMultiBranches || cameWarehouseExplicit) {
        resolvedWarehouseId = await resolveWarehouseForBranch(resolvedBranchId);
      } else {
        logPos(req, "info", "skip auto-warehouse (multi-branch user)", {
          resolvedBranchId,
          allowedBranchIds,
          explicit,
        });
      }
    }

    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || "24", 10), 1), 5000);
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const offset = (page - 1) * limit;

    const inStock = String(req.query.in_stock ?? "1") === "1";
    const sellable = String(req.query.sellable ?? "1") === "1";
    const priceMode = String(req.query.price_mode || "LIST").trim().toUpperCase();
    const includeImages = String(req.query.include_images ?? "0") === "1";

    const like = `%${q}%`;

    const whereQ = q
      ? `AND (
          p.name LIKE :like OR p.sku LIKE :like OR p.barcode LIKE :like OR p.code LIKE :like
          OR p.brand LIKE :like OR p.model LIKE :like
        )`
      : "";

    const priceExpr =
      priceMode === "BASE"
        ? `COALESCE(p.price, 0)`
        : priceMode === "DISCOUNT"
        ? `COALESCE(NULLIF(p.price_discount,0), NULLIF(p.price_list,0), p.price, 0)`
        : priceMode === "RESELLER"
        ? `COALESCE(NULLIF(p.price_reseller,0), NULLIF(p.price_list,0), p.price, 0)`
        : `COALESCE(NULLIF(p.price_list,0), p.price, 0)`;

    const whereSellable = sellable ? `AND (${priceExpr}) > 0` : "";

    const imgSelect = includeImages
      ? `,
        (
          SELECT pi.url
          FROM product_images pi
          WHERE pi.product_id = p.id
          ORDER BY pi.sort_order ASC, pi.id ASC
          LIMIT 1
        ) AS main_image_url
      `
      : "";

    if (resolvedWarehouseId) {
      if (resolvedBranchId) {
        const ok = await assertWarehouseBelongsToBranch(resolvedWarehouseId, resolvedBranchId);
        if (!ok) {
          return res.status(400).json({
            ok: false,
            code: "WAREHOUSE_BRANCH_MISMATCH",
            message: `El depósito ${resolvedWarehouseId} no pertenece a la sucursal ${resolvedBranchId}.`,
          });
        }
      }

      const whereStock = inStock ? `AND COALESCE(sb.qty, 0) > 0` : "";

      const [rows] = await sequelize.query(
        `
        SELECT
          p.id,
          p.branch_id,
          p.code,
          p.sku,
          p.barcode,
          p.name,
          p.brand,
          p.model,
          p.category_id,
          p.subcategory_id,
          p.is_new,
          p.is_promo,
          p.is_active,
          p.price,
          p.price_list,
          p.price_discount,
          p.price_reseller,
          (${priceExpr}) AS effective_price,
          COALESCE(sb.qty, 0) AS qty
          ${imgSelect}
        FROM products p
        LEFT JOIN stock_balances sb
          ON sb.product_id = p.id AND sb.warehouse_id = :warehouseId
        WHERE p.is_active = 1
        ${whereQ}
        ${whereStock}
        ${whereSellable}
        ORDER BY p.name ASC
        LIMIT :limit OFFSET :offset
        `,
        { replacements: { warehouseId: resolvedWarehouseId, like, limit, offset } }
      );

      const [[countRow]] = await sequelize.query(
        `
        SELECT COUNT(*) AS total
        FROM products p
        LEFT JOIN stock_balances sb
          ON sb.product_id = p.id AND sb.warehouse_id = :warehouseId
        WHERE p.is_active = 1
        ${whereQ}
        ${whereStock}
        ${whereSellable}
        `,
        { replacements: { warehouseId: resolvedWarehouseId, like } }
      );

      return res.json({
        ok: true,
        data: rows,
        meta: { page, limit, total: Number(countRow?.total || 0), warehouse_id: resolvedWarehouseId },
      });
    }

    if (admin) {
      const joinWarehouses = resolvedBranchId
        ? `INNER JOIN warehouses w ON w.id = sb.warehouse_id AND w.branch_id = :branchId`
        : `INNER JOIN warehouses w ON w.id = sb.warehouse_id`;

      const whereStockTotal = inStock ? `HAVING COALESCE(SUM(sb.qty), 0) > 0` : "";

      const [rows] = await sequelize.query(
        `
        SELECT
          p.id,
          p.branch_id,
          p.code,
          p.sku,
          p.barcode,
          p.name,
          p.brand,
          p.model,
          p.category_id,
          p.subcategory_id,
          p.is_new,
          p.is_promo,
          p.is_active,
          p.price,
          p.price_list,
          p.price_discount,
          p.price_reseller,
          (${priceExpr}) AS effective_price,
          COALESCE(SUM(sb.qty), 0) AS qty
          ${imgSelect}
        FROM products p
        LEFT JOIN stock_balances sb ON sb.product_id = p.id
        ${joinWarehouses}
        WHERE p.is_active = 1
        ${whereQ}
        ${whereSellable}
        GROUP BY p.id
        ${whereStockTotal}
        ORDER BY p.name ASC
        LIMIT :limit OFFSET :offset
        `,
        { replacements: { like, limit, offset, branchId: resolvedBranchId || undefined } }
      );

      const [[countRow]] = await sequelize.query(
        `
        SELECT COUNT(DISTINCT p.id) AS total
        FROM products p
        LEFT JOIN stock_balances sb ON sb.product_id = p.id
        ${joinWarehouses}
        WHERE p.is_active = 1
        ${whereQ}
        ${whereSellable}
        `,
        { replacements: { like, branchId: resolvedBranchId || undefined } }
      );

      return res.json({
        ok: true,
        data: rows,
        meta: {
          page,
          limit,
          total: Number(countRow?.total || 0),
          scope: "ADMIN_ALL",
          branch_id: resolvedBranchId || null,
        },
      });
    }

    if (!admin && allowedBranchIds.length) {
      if (resolvedBranchId && !allowedBranchIds.includes(resolvedBranchId)) {
        return res.status(403).json({
          ok: false,
          code: "BRANCH_NOT_ALLOWED",
          message: `No tenés permisos para operar/ver la sucursal ${resolvedBranchId}.`,
        });
      }

      const scopeBranchIds = resolvedBranchId ? [resolvedBranchId] : allowedBranchIds;
      const whereStockTotal = inStock ? `HAVING COALESCE(SUM(sb.qty), 0) > 0` : "";

      const [rows] = await sequelize.query(
        `
        SELECT
          p.id,
          p.branch_id,
          p.code,
          p.sku,
          p.barcode,
          p.name,
          p.brand,
          p.model,
          p.category_id,
          p.subcategory_id,
          p.is_new,
          p.is_promo,
          p.is_active,
          p.price,
          p.price_list,
          p.price_discount,
          p.price_reseller,
          (${priceExpr}) AS effective_price,
          COALESCE(SUM(sb.qty), 0) AS qty
          ${imgSelect}
        FROM products p
        LEFT JOIN stock_balances sb ON sb.product_id = p.id
        INNER JOIN warehouses w ON w.id = sb.warehouse_id AND w.branch_id IN (:branchIds)
        WHERE p.is_active = 1
        ${whereQ}
        ${whereSellable}
        GROUP BY p.id
        ${whereStockTotal}
        ORDER BY p.name ASC
        LIMIT :limit OFFSET :offset
        `,
        { replacements: { like, limit, offset, branchIds: scopeBranchIds } }
      );

      const [[countRow]] = await sequelize.query(
        `
        SELECT COUNT(DISTINCT p.id) AS total
        FROM products p
        LEFT JOIN stock_balances sb ON sb.product_id = p.id
        INNER JOIN warehouses w ON w.id = sb.warehouse_id AND w.branch_id IN (:branchIds)
        WHERE p.is_active = 1
        ${whereQ}
        ${whereSellable}
        `,
        { replacements: { like, branchIds: scopeBranchIds } }
      );

      return res.json({
        ok: true,
        data: rows,
        meta: {
          page,
          limit,
          total: Number(countRow?.total || 0),
          scope: "USER_SCOPE_ALL",
          branch_id: resolvedBranchId || null,
          branch_ids: scopeBranchIds,
        },
      });
    }

    return res.status(400).json({
      ok: false,
      code: "WAREHOUSE_REQUIRED",
      message:
        "Falta warehouse_id (depósito). Enviá warehouse_id o branch_id para resolver el depósito automáticamente. " +
        "Si el usuario tiene múltiples sucursales, asegurá que el token incluya user.branches=[...].",
    });
  } catch (e) {
    logPos(req, "error", "listProductsForPos error", { err: e.message });
    return res.status(500).json({ ok: false, code: "POS_PRODUCTS_ERROR", message: e.message });
  }
}

/**
 * ✅ POS CREATE SALE (admin no vende)
 * ✅ FIX: guarda customer_phone + customer_doc
 * ✅ FIX: soporta body.extra.customer (frontend nuevo)
 */

/**
 * ✅ POS CREATE SALE (admin no vende)
 * ✅ FIX: guarda customer_phone/customer_doc (soporta body.customer_* y body.extra.customer)
 */
async function createSale(req, res) {
  req._rid = req._rid || rid(req);

  let t;
  try {
    const admin = isAdminReq(req);
    if (admin) {
      logPos(req, "warn", "createSale blocked: admin cannot sell");
      return res.status(403).json({
        ok: false,
        code: "ADMIN_CANNOT_SELL",
        message: "El usuario admin no puede registrar ventas desde POS (solo vista).",
      });
    }

    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const payments = Array.isArray(body.payments) ? body.payments : [];

    // ======================================================
    // ✅ Cliente: soportar dos formatos
    // 1) body.customer_name / customer_doc / customer_phone (legacy)
    // 2) body.extra.customer = { first_name,last_name,phone,doc,dni,cuit,name }
    // ======================================================
    const extra = body.extra && typeof body.extra === "object" ? body.extra : {};
    const c = extra.customer && typeof extra.customer === "object" ? extra.customer : (body.customer || {});

    const first = String(c.first_name || "").trim();
    const last = String(c.last_name || "").trim();
    const fullName = String(`${first} ${last}`.trim());

    const customer_name =
      String(body.customer_name || "").trim() ||
      fullName ||
      String(c.name || "").trim() ||
      "Consumidor Final";

    const customer_phone =
      String(body.customer_phone || "").trim() ||
      String(c.phone || "").trim() ||
      String(c.whatsapp || "").trim() ||
      null;

    const customer_doc =
      String(body.customer_doc || "").trim() ||
      String(c.doc || "").trim() ||
      String(c.dni || "").trim() ||
      String(c.cuit || "").trim() ||
      null;

    const note = body.note || null;

    if (!req.user?.id) {
      logPos(req, "warn", "createSale blocked: unauthorized");
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "No autenticado" });
    }

    const userId = toInt(req.user.id, 0);

    const userBranchId = toInt(req.user.branch_id, 0);
    const { warehouseId: ctxWarehouseId } = resolvePosContext(req);

    const resolvedBranchId = userBranchId;

    if (!resolvedBranchId) {
      logPos(req, "warn", "createSale blocked: missing branch", { userBranchId });
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "Falta branch_id (sucursal). El usuario no tiene sucursal asignada.",
      });
    }

    let resolvedWarehouseId = toInt(ctxWarehouseId, 0);
    if (!resolvedWarehouseId) {
      resolvedWarehouseId = await resolveWarehouseForBranch(resolvedBranchId);
    }

    if (!resolvedWarehouseId) {
      logPos(req, "warn", "createSale blocked: missing warehouse", {
        resolvedBranchId,
        ctxWarehouseId,
      });
      return res.status(400).json({
        ok: false,
        code: "WAREHOUSE_REQUIRED",
        message:
          "Falta warehouse_id (depósito). Enviá warehouse_id o asegurate de tener al menos 1 depósito creado para la sucursal.",
      });
    }

    if (items.length === 0) {
      logPos(req, "warn", "createSale blocked: empty items");
      return res.status(400).json({ ok: false, code: "EMPTY_ITEMS", message: "Venta sin items" });
    }

    const normalizedItems = items.map((i) => ({
      product_id: toNum(i.product_id),
      quantity: toNum(i.quantity),
      unit_price: toNum(i.unit_price),
    }));

    for (const it of normalizedItems) {
      if (!it.product_id)
        throw Object.assign(new Error("Item inválido: falta product_id"), {
          httpStatus: 400,
          code: "INVALID_ITEM",
        });
      if (!Number.isFinite(it.quantity) || it.quantity <= 0)
        throw Object.assign(new Error(`Item inválido: quantity=${it.quantity}`), {
          httpStatus: 400,
          code: "INVALID_ITEM",
        });
      if (!Number.isFinite(it.unit_price) || it.unit_price <= 0)
        throw Object.assign(new Error(`Item inválido: unit_price=${it.unit_price}`), {
          httpStatus: 400,
          code: "INVALID_ITEM",
        });
    }

    let subtotal = 0;
    for (const it of normalizedItems) subtotal += it.quantity * it.unit_price;

    logPos(req, "info", "createSale start", {
      resolvedBranchId,
      resolvedWarehouseId,
      items: normalizedItems.length,
      payments: payments.length,
      subtotal,
      customer_name,
      customer_phone,
      customer_doc,
    });

    t = await sequelize.transaction();

    const sale = await Sale.create(
      {
        branch_id: resolvedBranchId,
        user_id: userId,
        status: "PAID",
        sale_number: null,

        // ✅ GUARDA CLIENTE
        customer_name,
        customer_phone,
        customer_doc,

        subtotal,
        discount_total: 0,
        tax_total: 0,
        total: subtotal,
        paid_total: 0,
        change_total: 0,
        note,
        sold_at: new Date(),
      },
      { transaction: t }
    );

    const movement = await StockMovement.create(
      {
        type: "out",
        warehouse_id: resolvedWarehouseId,
        ref_type: "sale",
        ref_id: String(sale.id),
        note: `Venta POS #${sale.id}`,
        created_by: userId,
      },
      { transaction: t }
    );

    for (const it of normalizedItems) {
      const p = await Product.findByPk(it.product_id, { transaction: t });
      if (!p) {
        throw Object.assign(new Error(`Producto no existe: id=${it.product_id}`), {
          httpStatus: 400,
          code: "PRODUCT_NOT_FOUND",
        });
      }

      const sb = await StockBalance.findOne({
        where: { warehouse_id: resolvedWarehouseId, product_id: it.product_id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!sb) {
        throw Object.assign(
          new Error(
            `No existe stock_balance para producto ${p.sku || p.id} en depósito ${resolvedWarehouseId}`
          ),
          { httpStatus: 409, code: "STOCK_BALANCE_MISSING" }
        );
      }

      if (Number(sb.qty) < it.quantity) {
        throw Object.assign(
          new Error(
            `Stock insuficiente (depósito ${resolvedWarehouseId}) para producto ${p.sku || p.id}`
          ),
          { httpStatus: 409, code: "STOCK_INSUFFICIENT" }
        );
      }

      await sb.update({ qty: literal(`qty - ${it.quantity}`) }, { transaction: t });

      const lineTotal = it.quantity * it.unit_price;

      await SaleItem.create(
        {
          sale_id: sale.id,
          product_id: it.product_id,
          warehouse_id: resolvedWarehouseId,
          quantity: it.quantity,
          unit_price: it.unit_price,
          discount_amount: 0,
          tax_amount: 0,
          line_total: lineTotal,
          product_name_snapshot: p.name,
          product_sku_snapshot: p.sku,
          product_barcode_snapshot: p.barcode,
        },
        { transaction: t }
      );

      await StockMovementItem.create(
        {
          movement_id: movement.id,
          product_id: it.product_id,
          qty: it.quantity,
          unit_cost: p.cost || null,
        },
        { transaction: t }
      );
    }

    let totalPaid = 0;

    for (const pay of payments) {
      const amount = toNum(pay.amount);
      const method = String(pay.method || "CASH").toUpperCase();

      if (!Number.isFinite(amount) || amount <= 0) {
        throw Object.assign(new Error(`Pago inválido: amount=${pay.amount}`), {
          httpStatus: 400,
          code: "INVALID_PAYMENT",
        });
      }

      if (!["CASH", "TRANSFER", "CARD", "QR", "OTHER"].includes(method)) {
        throw Object.assign(new Error(`Pago inválido: method=${method}`), {
          httpStatus: 400,
          code: "INVALID_PAYMENT_METHOD",
        });
      }

      totalPaid += amount;

      await Payment.create(
        {
          sale_id: sale.id,
          method,
          amount,
          reference: pay.reference || null,
          note: pay.note || null,
          paid_at: new Date(),
        },
        { transaction: t }
      );
    }

    if (payments.length === 0) totalPaid = subtotal;

    sale.paid_total = totalPaid;
    sale.change_total = totalPaid - subtotal;
    await sale.save({ transaction: t });

    await t.commit();

    logPos(req, "info", "createSale done", {
      sale_id: sale.id,
      resolvedBranchId,
      resolvedWarehouseId,
      totalPaid,
      change: sale.change_total,
    });

    return res.json({
      ok: true,
      data: {
        sale_id: sale.id,
        branch_id: sale.branch_id,
        user_id: sale.user_id,
        warehouse_id: resolvedWarehouseId,

        // ✅ DEVOLVEMOS CLIENTE (para front)
        customer_name: sale.customer_name,
        customer_phone: sale.customer_phone,
        customer_doc: sale.customer_doc,

        subtotal: sale.subtotal,
        total: sale.total,
        paid_total: sale.paid_total,
        change_total: sale.change_total,
        status: sale.status,
        sold_at: sale.sold_at,
      },
    });
  } catch (e) {
    if (t) await t.rollback();

    const status = e.httpStatus || 500;
    const code = e.code || "POS_CREATE_SALE_ERROR";

    logPos(req, "error", "createSale error", { code, err: e.message });
    return res.status(status).json({ ok: false, code, message: e.message });
  }
}




module.exports = {
  getContext,
  listProductsForPos,
  createSale,
};
