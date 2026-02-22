// ✅ COPY-PASTE FINAL
// src/controllers/pos.controller.js
// (NO se altera lo que ya funciona: getContext, listProductsForPos, createSale quedan IGUAL en comportamiento)
// ✅ FIX REAL (POS LIST):
// - ADMIN_ALL + USER_SCOPE_ALL: cuando in_stock=0 NO debe “perder” productos por INNER JOIN warehouses
// - Se usa LEFT JOIN + SUM(CASE WHEN ...) para:
//    - qty = 0 cuando no hay stock_balance
//    - filtrar stock SOLO si in_stock=1
// ✅ Se mantienen: createSaleReturn (devoluciones) + createSaleExchange (cambios)

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
 * ✅ FIX: ADMIN_ALL + USER_SCOPE_ALL no “pierden” productos cuando in_stock=0
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

    // ======================================================
    // 1) Si hay warehouse_id => comportamiento actual OK
    // ======================================================
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

    // ======================================================
    // 2) ADMIN sin warehouse => FIX (no perder productos cuando in_stock=0)
    //    - branch_id opcional filtra el scope
    // ======================================================
    if (admin) {
      const scopeBranchId = resolvedBranchId || 0;

      // qty: suma stock solo si branch coincide cuando hay filtro, si no suma todo
      const qtyExpr = scopeBranchId
        ? `COALESCE(SUM(CASE WHEN w.branch_id = :branchId THEN sb.qty ELSE 0 END), 0)`
        : `COALESCE(SUM(sb.qty), 0)`;

      const havingStock = inStock ? `HAVING ${qtyExpr} > 0` : "";

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
          ${qtyExpr} AS qty
          ${imgSelect}
        FROM products p
        LEFT JOIN stock_balances sb ON sb.product_id = p.id
        LEFT JOIN warehouses w ON w.id = sb.warehouse_id
        WHERE p.is_active = 1
        ${whereQ}
        ${whereSellable}
        GROUP BY p.id
        ${havingStock}
        ORDER BY p.name ASC
        LIMIT :limit OFFSET :offset
        `,
        { replacements: { like, limit, offset, branchId: scopeBranchId || undefined } }
      );

      const [[countRow]] = await sequelize.query(
        `
        SELECT COUNT(*) AS total
        FROM (
          SELECT p.id
          FROM products p
          LEFT JOIN stock_balances sb ON sb.product_id = p.id
          LEFT JOIN warehouses w ON w.id = sb.warehouse_id
          WHERE p.is_active = 1
          ${whereQ}
          ${whereSellable}
          GROUP BY p.id
          ${havingStock}
        ) x
        `,
        { replacements: { like, branchId: scopeBranchId || undefined } }
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

    // ======================================================
    // 3) USER multi-scope sin warehouse => FIX (no perder productos cuando in_stock=0)
    // ======================================================
    if (!admin && allowedBranchIds.length) {
      if (resolvedBranchId && !allowedBranchIds.includes(resolvedBranchId)) {
        return res.status(403).json({
          ok: false,
          code: "BRANCH_NOT_ALLOWED",
          message: `No tenés permisos para operar/ver la sucursal ${resolvedBranchId}.`,
        });
      }

      const scopeBranchIds = resolvedBranchId ? [resolvedBranchId] : allowedBranchIds;

      const qtyExpr = `COALESCE(SUM(CASE WHEN w.branch_id IN (:branchIds) THEN sb.qty ELSE 0 END), 0)`;
      const havingStock = inStock ? `HAVING ${qtyExpr} > 0` : "";

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
          ${qtyExpr} AS qty
          ${imgSelect}
        FROM products p
        LEFT JOIN stock_balances sb ON sb.product_id = p.id
        LEFT JOIN warehouses w ON w.id = sb.warehouse_id
        WHERE p.is_active = 1
        ${whereQ}
        ${whereSellable}
        GROUP BY p.id
        ${havingStock}
        ORDER BY p.name ASC
        LIMIT :limit OFFSET :offset
        `,
        { replacements: { like, limit, offset, branchIds: scopeBranchIds } }
      );

      const [[countRow]] = await sequelize.query(
        `
        SELECT COUNT(*) AS total
        FROM (
          SELECT p.id
          FROM products p
          LEFT JOIN stock_balances sb ON sb.product_id = p.id
          LEFT JOIN warehouses w ON w.id = sb.warehouse_id
          WHERE p.is_active = 1
          ${whereQ}
          ${whereSellable}
          GROUP BY p.id
          ${havingStock}
        ) x
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

/* ======================================================================
   ✅ NUEVO: DEVOLUCIONES + CAMBIOS (sin tocar lo existente)
   ====================================================================== */

/**
 * Mapea métodos del frontend a enum real en DB:
 * payments.method enum: CASH, TRANSFER, CARD, QR, OTHER
 */
function mapPayMethod(raw) {
  const m = String(raw || "").trim().toUpperCase();
  if (m === "CASH") return "CASH";
  if (m === "TRANSFER" || m === "TRANSFERENCIA") return "TRANSFER";
  if (m === "QR") return "QR";
  if (m === "CARD" || m === "DEBIT" || m === "CREDIT" || m === "TARJETA") return "CARD";
  return "OTHER";
}

/**
 * Verifica que existan las tablas de devoluciones/cambios.
 * (Si no existen, devolvemos error claro sin romper nada.)
 */
async function assertReturnsTablesExist() {
  const [[r1]] = await sequelize.query(`SHOW TABLES LIKE 'sale_returns'`);
  const [[r2]] = await sequelize.query(`SHOW TABLES LIKE 'sale_return_items'`);
  const [[r3]] = await sequelize.query(`SHOW TABLES LIKE 'sale_return_payments'`);
  if (!r1 || !r2 || !r3) {
    const err = new Error(
      "Faltan tablas de devoluciones (sale_returns / sale_return_items / sale_return_payments). Ejecutá el SQL primero."
    );
    err.httpStatus = 400;
    err.code = "RETURNS_TABLES_MISSING";
    throw err;
  }
}

async function assertExchangesTableExist() {
  const [[r]] = await sequelize.query(`SHOW TABLES LIKE 'sale_exchanges'`);
  if (!r) {
    const err = new Error("Falta tabla de cambios (sale_exchanges). Ejecutá el SQL primero.");
    err.httpStatus = 400;
    err.code = "EXCHANGES_TABLE_MISSING";
    throw err;
  }
}

/**
 * Calcula total devuelto según items (qty * unit_price)
 */
function calcReturnTotal(items) {
  let total = 0;
  for (const it of items || []) {
    total += toNum(it.qty) * toNum(it.unit_price);
  }
  return Number(total || 0);
}

/**
 * ✅ POST /api/v1/pos/returns
 * Body:
 * {
 *   sale_id,
 *   restock: 1|0,
 *   reason,
 *   note,
 *   items: [{ product_id, warehouse_id, qty, unit_price }],
 *   payments: [{ method, amount, reference?, note? }]
 * }
 *
 * Reglas:
 * - No admin: solo su misma branch
 * - amount(payments) debe coincidir con total devuelto
 * - total devuelto no puede superar paid_total de la venta (por ahora, simple y seguro)
 * - si restock=1: reingresa stock (movement type=in) y suma qty a stock_balances
 * - si total devuelto == paid_total => status REFUNDED
 */
async function createSaleReturn(req, res) {
  req._rid = req._rid || rid(req);

  let t;
  try {
    await assertReturnsTablesExist();

    if (!req.user?.id) {
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "No autenticado" });
    }

    const admin = isAdminReq(req);
    const userId = toInt(req.user.id, 0);
    const userBranchId = toInt(req.user.branch_id, 0);

    const body = req.body || {};
    const saleId = toInt(body.sale_id || body.id || req.params?.id, 0);
    const restock = String(body.restock ?? "1") === "1" || body.restock === true;
    const reason = body.reason ? String(body.reason).slice(0, 255) : null;
    const note = body.note ? String(body.note).slice(0, 255) : null;

    const items = Array.isArray(body.items) ? body.items : [];
    const payments = Array.isArray(body.payments) ? body.payments : [];

    if (!saleId) return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "sale_id requerido" });
    if (!items.length) return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "items requerido (array no vacío)" });
    if (!payments.length) return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "payments requerido (array no vacío)" });

    t = await sequelize.transaction();

    const sale = await Sale.findByPk(saleId, {
      include: [{ model: SaleItem }, { model: Payment }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "SALE_NOT_FOUND", message: "Venta no encontrada" });
    }

    if (!admin) {
      if (!userBranchId) {
        await t.rollback();
        return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED", message: "El usuario no tiene sucursal asignada" });
      }
      if (toInt(sale.branch_id, 0) !== userBranchId) {
        await t.rollback();
        return res.status(403).json({ ok: false, code: "CROSS_BRANCH_SALE", message: "No podés operar una venta de otra sucursal" });
      }
    }

    const normalizedItems = items.map((it) => ({
      product_id: toInt(it.product_id, 0),
      warehouse_id: toInt(it.warehouse_id, 0),
      qty: toNum(it.qty),
      unit_price: toNum(it.unit_price),
    }));

    for (const it of normalizedItems) {
      if (!it.product_id || !it.warehouse_id) {
        const e = new Error("Item devolución inválido: product_id y warehouse_id requeridos");
        e.httpStatus = 400;
        e.code = "INVALID_RETURN_ITEM";
        throw e;
      }
      if (!Number.isFinite(it.qty) || it.qty <= 0) {
        const e = new Error(`Item devolución inválido: qty=${it.qty}`);
        e.httpStatus = 400;
        e.code = "INVALID_RETURN_ITEM";
        throw e;
      }
      if (!Number.isFinite(it.unit_price) || it.unit_price < 0) {
        const e = new Error(`Item devolución inválido: unit_price=${it.unit_price}`);
        e.httpStatus = 400;
        e.code = "INVALID_RETURN_ITEM";
        throw e;
      }
    }

    const totalReturn = calcReturnTotal(normalizedItems);

    const paidTotal = Number(sale.paid_total || 0);
    if (!(totalReturn > 0) || totalReturn - paidTotal > 0.00001) {
      const e = new Error("Monto de devolución inválido (supera lo pagado o es 0)");
      e.httpStatus = 400;
      e.code = "INVALID_RETURN_AMOUNT";
      throw e;
    }

    const paySum = payments.reduce((a, p) => a + toNum(p.amount), 0);
    if (Math.abs(paySum - totalReturn) > 0.01) {
      const e = new Error("Los pagos de devolución no coinciden con el monto a devolver");
      e.httpStatus = 400;
      e.code = "RETURN_PAYMENTS_MISMATCH";
      throw e;
    }

    // 1) registrar sale_returns
    const [insRet] = await sequelize.query(
      `
      INSERT INTO sale_returns
        (sale_id, amount, restock, reason, note, created_by, created_at)
      VALUES
        (:sale_id, :amount, :restock, :reason, :note, :created_by, NOW())
      `,
      {
        transaction: t,
        replacements: {
          sale_id: saleId,
          amount: totalReturn,
          restock: restock ? 1 : 0,
          reason,
          note,
          created_by: userId || null,
        },
      }
    );

    const returnId = toInt(insRet?.insertId, 0);
    if (!returnId) {
      const e = new Error("No se pudo crear sale_returns (insertId vacío)");
      e.httpStatus = 500;
      e.code = "RETURN_INSERT_FAILED";
      throw e;
    }

    // 2) items + stock (si restock)
    for (const it of normalizedItems) {
      await sequelize.query(
        `
        INSERT INTO sale_return_items
          (return_id, product_id, warehouse_id, qty, unit_price, line_total, created_at)
        VALUES
          (:return_id, :product_id, :warehouse_id, :qty, :unit_price, :line_total, NOW())
        `,
        {
          transaction: t,
          replacements: {
            return_id: returnId,
            product_id: it.product_id,
            warehouse_id: it.warehouse_id,
            qty: it.qty,
            unit_price: it.unit_price,
            line_total: it.qty * it.unit_price,
          },
        }
      );

      if (restock) {
        // stock movement IN
        const mv = await StockMovement.create(
          {
            type: "in",
            warehouse_id: it.warehouse_id,
            ref_type: "sale_return",
            ref_id: String(returnId),
            note: `Devolución de venta #${saleId}`,
            created_by: userId,
          },
          { transaction: t }
        );

        // costo: tomamos cost del producto (si existe)
        const p = await Product.findByPk(it.product_id, { transaction: t });
        await StockMovementItem.create(
          {
            movement_id: mv.id,
            product_id: it.product_id,
            qty: it.qty,
            unit_cost: p?.cost ?? null,
          },
          { transaction: t }
        );

        // stock_balance: sumamos qty (si no existe registro, lo creamos)
        const sb = await StockBalance.findOne({
          where: { warehouse_id: it.warehouse_id, product_id: it.product_id },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (sb) {
          await sb.update({ qty: literal(`qty + ${it.qty}`) }, { transaction: t });
        } else {
          await StockBalance.create(
            { warehouse_id: it.warehouse_id, product_id: it.product_id, qty: it.qty },
            { transaction: t }
          );
        }
      }
    }

    // 3) payments
    for (const p of payments) {
      const method = mapPayMethod(p.method);
      const amount = toNum(p.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        const e = new Error(`Pago devolución inválido: amount=${p.amount}`);
        e.httpStatus = 400;
        e.code = "INVALID_RETURN_PAYMENT";
        throw e;
      }

      await sequelize.query(
        `
        INSERT INTO sale_return_payments
          (return_id, method, amount, reference, note, created_at)
        VALUES
          (:return_id, :method, :amount, :reference, :note, NOW())
        `,
        {
          transaction: t,
          replacements: {
            return_id: returnId,
            method,
            amount,
            reference: p.reference ? String(p.reference).slice(0, 120) : null,
            note: p.note ? String(p.note).slice(0, 255) : null,
          },
        }
      );
    }

    // 4) estado venta si fue total
    if (Math.abs(totalReturn - paidTotal) <= 0.01) {
      await sale.update({ status: "REFUNDED" }, { transaction: t });
    }

    await t.commit();

    return res.json({
      ok: true,
      data: {
        return_id: returnId,
        sale_id: saleId,
        amount: totalReturn,
        restock: restock ? 1 : 0,
        status_after: Math.abs(totalReturn - paidTotal) <= 0.01 ? "REFUNDED" : sale.status,
      },
      message: "Devolución registrada",
    });
  } catch (e) {
    if (t) await t.rollback();
    const status = e.httpStatus || 500;
    const code = e.code || "POS_RETURN_ERROR";
    logPos(req, "error", "createSaleReturn error", { code, err: e.message });
    return res.status(status).json({ ok: false, code, message: e.message });
  }
}

/**
 * ✅ POST /api/v1/pos/exchanges
 * Body:
 * {
 *   sale_id,
 *   note,
 *   return: { restock, reason, note, items[], payments[] },
 *   new_sale: { items[], payments[], note?, extra? customer? }  // mismo formato que createSale
 * }
 *
 * Reglas:
 * - admin NO (mismo criterio que createSale: admin no vende, por ende no hace cambios)
 * - se registra: devolución + venta nueva + fila en sale_exchanges
 */
async function createSaleExchange(req, res) {
  req._rid = req._rid || rid(req);

  let t;
  try {
    await assertReturnsTablesExist();
    await assertExchangesTableExist();

    if (!req.user?.id) {
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "No autenticado" });
    }

    const admin = isAdminReq(req);
    if (admin) {
      return res.status(403).json({
        ok: false,
        code: "ADMIN_CANNOT_EXCHANGE",
        message: "El usuario admin no puede registrar cambios desde POS (solo vista).",
      });
    }

    const userId = toInt(req.user.id, 0);
    const userBranchId = toInt(req.user.branch_id, 0);

    const body = req.body || {};
    const saleId = toInt(body.sale_id || body.id || req.params?.id, 0);
    if (!saleId) return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "sale_id requerido" });

    const returnPayload = body.return || body.returnData || {};
    const newSalePayload = body.new_sale || body.newSale || body.newSaleData || {};
    const exchangeNote = body.note ? String(body.note).slice(0, 255) : null;

    // Validaciones mínimas
    if (!Array.isArray(returnPayload.items) || !returnPayload.items.length) {
      return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "return.items requerido" });
    }
    if (!Array.isArray(returnPayload.payments) || !returnPayload.payments.length) {
      return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "return.payments requerido" });
    }
    if (!Array.isArray(newSalePayload.items) || !newSalePayload.items.length) {
      return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "new_sale.items requerido" });
    }

    t = await sequelize.transaction();

    // Bloqueamos venta original
    const sale = await Sale.findByPk(saleId, {
      include: [{ model: SaleItem }, { model: Payment }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "SALE_NOT_FOUND", message: "Venta no encontrada" });
    }

    if (!userBranchId) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED", message: "El usuario no tiene sucursal asignada" });
    }
    if (toInt(sale.branch_id, 0) !== userBranchId) {
      await t.rollback();
      return res.status(403).json({ ok: false, code: "CROSS_BRANCH_SALE", message: "No podés operar una venta de otra sucursal" });
    }

    // 1) Ejecutamos devolución dentro de la MISMA tx (reutilizando lógica pero sin abrir tx nueva)
    const restock = String(returnPayload.restock ?? "1") === "1" || returnPayload.restock === true;
    const reason = returnPayload.reason ? String(returnPayload.reason).slice(0, 255) : null;
    const note = returnPayload.note ? String(returnPayload.note).slice(0, 255) : null;

    const normalizedItems = returnPayload.items.map((it) => ({
      product_id: toInt(it.product_id, 0),
      warehouse_id: toInt(it.warehouse_id, 0),
      qty: toNum(it.qty),
      unit_price: toNum(it.unit_price),
    }));

    for (const it of normalizedItems) {
      if (!it.product_id || !it.warehouse_id) {
        const e = new Error("Item devolución inválido: product_id y warehouse_id requeridos");
        e.httpStatus = 400;
        e.code = "INVALID_RETURN_ITEM";
        throw e;
      }
      if (!Number.isFinite(it.qty) || it.qty <= 0) {
        const e = new Error(`Item devolución inválido: qty=${it.qty}`);
        e.httpStatus = 400;
        e.code = "INVALID_RETURN_ITEM";
        throw e;
      }
      if (!Number.isFinite(it.unit_price) || it.unit_price < 0) {
        const e = new Error(`Item devolución inválido: unit_price=${it.unit_price}`);
        e.httpStatus = 400;
        e.code = "INVALID_RETURN_ITEM";
        throw e;
      }
    }

    const totalReturn = calcReturnTotal(normalizedItems);
    const paidTotal = Number(sale.paid_total || 0);

    if (!(totalReturn > 0) || totalReturn - paidTotal > 0.00001) {
      const e = new Error("Monto de devolución inválido (supera lo pagado o es 0)");
      e.httpStatus = 400;
      e.code = "INVALID_RETURN_AMOUNT";
      throw e;
    }

    const paySum = (returnPayload.payments || []).reduce((a, p) => a + toNum(p.amount), 0);
    if (Math.abs(paySum - totalReturn) > 0.01) {
      const e = new Error("Los pagos de devolución no coinciden con el monto a devolver");
      e.httpStatus = 400;
      e.code = "RETURN_PAYMENTS_MISMATCH";
      throw e;
    }

    const [insRet] = await sequelize.query(
      `
      INSERT INTO sale_returns
        (sale_id, amount, restock, reason, note, created_by, created_at)
      VALUES
        (:sale_id, :amount, :restock, :reason, :note, :created_by, NOW())
      `,
      {
        transaction: t,
        replacements: {
          sale_id: saleId,
          amount: totalReturn,
          restock: restock ? 1 : 0,
          reason,
          note,
          created_by: userId || null,
        },
      }
    );

    const returnId = toInt(insRet?.insertId, 0);
    if (!returnId) {
      const e = new Error("No se pudo crear sale_returns (insertId vacío)");
      e.httpStatus = 500;
      e.code = "RETURN_INSERT_FAILED";
      throw e;
    }

    for (const it of normalizedItems) {
      await sequelize.query(
        `
        INSERT INTO sale_return_items
          (return_id, product_id, warehouse_id, qty, unit_price, line_total, created_at)
        VALUES
          (:return_id, :product_id, :warehouse_id, :qty, :unit_price, :line_total, NOW())
        `,
        {
          transaction: t,
          replacements: {
            return_id: returnId,
            product_id: it.product_id,
            warehouse_id: it.warehouse_id,
            qty: it.qty,
            unit_price: it.unit_price,
            line_total: it.qty * it.unit_price,
          },
        }
      );

      if (restock) {
        const mv = await StockMovement.create(
          {
            type: "in",
            warehouse_id: it.warehouse_id,
            ref_type: "sale_return",
            ref_id: String(returnId),
            note: `Devolución (cambio) de venta #${saleId}`,
            created_by: userId,
          },
          { transaction: t }
        );

        const p = await Product.findByPk(it.product_id, { transaction: t });
        await StockMovementItem.create(
          {
            movement_id: mv.id,
            product_id: it.product_id,
            qty: it.qty,
            unit_cost: p?.cost ?? null,
          },
          { transaction: t }
        );

        const sb = await StockBalance.findOne({
          where: { warehouse_id: it.warehouse_id, product_id: it.product_id },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (sb) {
          await sb.update({ qty: literal(`qty + ${it.qty}`) }, { transaction: t });
        } else {
          await StockBalance.create(
            { warehouse_id: it.warehouse_id, product_id: it.product_id, qty: it.qty },
            { transaction: t }
          );
        }
      }
    }

    for (const p of returnPayload.payments || []) {
      const method = mapPayMethod(p.method);
      const amount = toNum(p.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        const e = new Error(`Pago devolución inválido: amount=${p.amount}`);
        e.httpStatus = 400;
        e.code = "INVALID_RETURN_PAYMENT";
        throw e;
      }

      await sequelize.query(
        `
        INSERT INTO sale_return_payments
          (return_id, method, amount, reference, note, created_at)
        VALUES
          (:return_id, :method, :amount, :reference, :note, NOW())
        `,
        {
          transaction: t,
          replacements: {
            return_id: returnId,
            method,
            amount,
            reference: p.reference ? String(p.reference).slice(0, 120) : null,
            note: p.note ? String(p.note).slice(0, 255) : null,
          },
        }
      );
    }

    if (Math.abs(totalReturn - paidTotal) <= 0.01) {
      await sale.update({ status: "REFUNDED" }, { transaction: t });
    }

    // 2) Creamos NUEVA venta (misma lógica que createSale, pero dentro de esta tx)
    const items2 = Array.isArray(newSalePayload.items) ? newSalePayload.items : [];
    const pays2 = Array.isArray(newSalePayload.payments) ? newSalePayload.payments : [];

    const extra2 = newSalePayload.extra && typeof newSalePayload.extra === "object" ? newSalePayload.extra : {};
    const c2 = extra2.customer && typeof extra2.customer === "object" ? extra2.customer : (newSalePayload.customer || {});

    const first2 = String(c2.first_name || "").trim();
    const last2 = String(c2.last_name || "").trim();
    const fullName2 = String(`${first2} ${last2}`.trim());

    const customer_name2 =
      String(newSalePayload.customer_name || "").trim() ||
      fullName2 ||
      String(c2.name || "").trim() ||
      "Consumidor Final";

    const customer_phone2 =
      String(newSalePayload.customer_phone || "").trim() ||
      String(c2.phone || "").trim() ||
      String(c2.whatsapp || "").trim() ||
      null;

    const customer_doc2 =
      String(newSalePayload.customer_doc || "").trim() ||
      String(c2.doc || "").trim() ||
      String(c2.dni || "").trim() ||
      String(c2.cuit || "").trim() ||
      null;

    const note2 = newSalePayload.note || null;

    const normalizedItems2 = items2.map((i) => ({
      product_id: toNum(i.product_id),
      quantity: toNum(i.quantity),
      unit_price: toNum(i.unit_price),
    }));

    for (const it of normalizedItems2) {
      if (!it.product_id) {
        const e = new Error("Item inválido (cambio): falta product_id");
        e.httpStatus = 400;
        e.code = "INVALID_ITEM";
        throw e;
      }
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
        const e = new Error(`Item inválido (cambio): quantity=${it.quantity}`);
        e.httpStatus = 400;
        e.code = "INVALID_ITEM";
        throw e;
      }
      if (!Number.isFinite(it.unit_price) || it.unit_price <= 0) {
        const e = new Error(`Item inválido (cambio): unit_price=${it.unit_price}`);
        e.httpStatus = 400;
        e.code = "INVALID_ITEM";
        throw e;
      }
    }

    // warehouse para la nueva venta: mismo criterio que createSale (ctx o default)
    const { warehouseId: ctxWh2 } = resolvePosContext(req);
    let resolvedWarehouseId2 = toInt(ctxWh2, 0);
    if (!resolvedWarehouseId2) resolvedWarehouseId2 = await resolveWarehouseForBranch(userBranchId);
    if (!resolvedWarehouseId2) {
      const e = new Error("Falta warehouse_id para nueva venta (cambio).");
      e.httpStatus = 400;
      e.code = "WAREHOUSE_REQUIRED";
      throw e;
    }

    let subtotal2 = 0;
    for (const it of normalizedItems2) subtotal2 += it.quantity * it.unit_price;

    const newSale = await Sale.create(
      {
        branch_id: userBranchId,
        user_id: userId,
        status: "PAID",
        sale_number: null,

        customer_name: customer_name2,
        customer_phone: customer_phone2,
        customer_doc: customer_doc2,

        subtotal: subtotal2,
        discount_total: 0,
        tax_total: 0,
        total: subtotal2,
        paid_total: 0,
        change_total: 0,
        note: note2,
        sold_at: new Date(),
      },
      { transaction: t }
    );

    const mvOut = await StockMovement.create(
      {
        type: "out",
        warehouse_id: resolvedWarehouseId2,
        ref_type: "sale_exchange",
        ref_id: String(newSale.id),
        note: `Cambio: venta nueva #${newSale.id} (orig #${saleId})`,
        created_by: userId,
      },
      { transaction: t }
    );

    for (const it of normalizedItems2) {
      const p = await Product.findByPk(it.product_id, { transaction: t });
      if (!p) {
        const e = new Error(`Producto no existe (cambio): id=${it.product_id}`);
        e.httpStatus = 400;
        e.code = "PRODUCT_NOT_FOUND";
        throw e;
      }

      const sb = await StockBalance.findOne({
        where: { warehouse_id: resolvedWarehouseId2, product_id: it.product_id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!sb) {
        const e = new Error(
          `No existe stock_balance (cambio) para producto ${p.sku || p.id} en depósito ${resolvedWarehouseId2}`
        );
        e.httpStatus = 409;
        e.code = "STOCK_BALANCE_MISSING";
        throw e;
      }

      if (Number(sb.qty) < it.quantity) {
        const e = new Error(`Stock insuficiente (cambio) para producto ${p.sku || p.id}`);
        e.httpStatus = 409;
        e.code = "STOCK_INSUFFICIENT";
        throw e;
      }

      await sb.update({ qty: literal(`qty - ${it.quantity}`) }, { transaction: t });

      const lineTotal = it.quantity * it.unit_price;

      await SaleItem.create(
        {
          sale_id: newSale.id,
          product_id: it.product_id,
          warehouse_id: resolvedWarehouseId2,
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
          movement_id: mvOut.id,
          product_id: it.product_id,
          qty: it.quantity,
          unit_cost: p.cost || null,
        },
        { transaction: t }
      );
    }

    let totalPaid2 = 0;
    for (const pay of pays2) {
      const amount = toNum(pay.amount);
      const method = mapPayMethod(pay.method);

      if (!Number.isFinite(amount) || amount <= 0) {
        const e = new Error(`Pago inválido (cambio): amount=${pay.amount}`);
        e.httpStatus = 400;
        e.code = "INVALID_PAYMENT";
        throw e;
      }

      totalPaid2 += amount;

      await Payment.create(
        {
          sale_id: newSale.id,
          method,
          amount,
          reference: pay.reference || null,
          note: pay.note || null,
          paid_at: new Date(),
        },
        { transaction: t }
      );
    }

    if (!pays2.length) totalPaid2 = subtotal2;

    newSale.paid_total = totalPaid2;
    newSale.change_total = totalPaid2 - subtotal2;
    await newSale.save({ transaction: t });

    // 3) Registrar exchange en tabla sale_exchanges
    const diff = Number(newSale.total || 0) - Number(totalReturn || 0);

    await sequelize.query(
      `
      INSERT INTO sale_exchanges
        (original_sale_id, return_id, new_sale_id, original_total, returned_amount, new_total, diff, note, created_by, created_at)
      VALUES
        (:orig_sale, :return_id, :new_sale, :orig_total, :returned_amount, :new_total, :diff, :note, :created_by, NOW())
      `,
      {
        transaction: t,
        replacements: {
          orig_sale: saleId,
          return_id: returnId,
          new_sale: newSale.id,
          orig_total: Number(sale.total || 0),
          returned_amount: Number(totalReturn || 0),
          new_total: Number(newSale.total || 0),
          diff,
          note: exchangeNote,
          created_by: userId || null,
        },
      }
    );

    await t.commit();

    return res.json({
      ok: true,
      message: "Cambio registrado",
      data: {
        original_sale_id: saleId,
        return_id: returnId,
        new_sale_id: newSale.id,
        returned_amount: totalReturn,
        new_total: Number(newSale.total || 0),
        diff,
      },
    });
  } catch (e) {
    if (t) await t.rollback();
    const status = e.httpStatus || 500;
    const code = e.code || "POS_EXCHANGE_ERROR";
    logPos(req, "error", "createSaleExchange error", { code, err: e.message });
    return res.status(status).json({ ok: false, code, message: e.message });
  }
}

module.exports = {
  getContext,
  listProductsForPos,
  createSale,

  // ✅ NUEVO (sin tocar lo existente)
  createSaleReturn,
  createSaleExchange,
};