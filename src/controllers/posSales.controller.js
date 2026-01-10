// src/controllers/posSales.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (RESPETA TU BD REAL)
// NOTA: sale_refunds es VIEW => SOLO LECTURA
const { Op, fn, col, literal } = require("sequelize");
const {
  sequelize,
  Sale,
  Payment,
  SaleItem,
  Product,
  Category,
  ProductImage,
  Warehouse,
  Branch,
  User,
  UserBranch,
  SaleRefund, // VIEW (solo lectura)
  SaleExchange,
} = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toFloat(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}
function parseDateTime(v) {
  if (!v) return null;
  const s = String(v).trim();
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}
function nowDate() {
  return new Date();
}
function upper(v) {
  return String(v || "").trim().toUpperCase();
}

/**
 * 🔐 Obtiene user_id desde middleware o JWT (fallback)
 * NO valida token (eso ya lo hace requireAuth)
 */
function getAuthUserId(req) {
  const candidates = [
    req?.user?.id,
    req?.user?.user_id,
    req?.user?.sub,
    req?.auth?.id,
    req?.auth?.userId,
    req?.auth?.user_id,
    req?.jwt?.id,
    req?.jwt?.userId,
    req?.jwt?.sub,
    req?.tokenPayload?.id,
    req?.tokenPayload?.userId,
    req?.tokenPayload?.sub,
    req?.session?.user?.id,
    req?.session?.userId,
    req?.userId,
  ];

  for (const v of candidates) {
    const n = toInt(v, 0);
    if (n > 0) return n;
  }

  // Fallback: decodificar payload del JWT (ya validado por requireAuth)
  try {
    const h = String(req.headers?.authorization || "");
    const m = h.match(/^Bearer\s+(.+)$/i);
    const token = m?.[1];
    if (!token) return 0;

    const parts = token.split(".");
    if (parts.length !== 3) return 0;

    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payloadJson = Buffer.from(payloadB64, "base64").toString("utf8");
    const payload = JSON.parse(payloadJson);

    return (
      toInt(payload?.id, 0) ||
      toInt(payload?.userId, 0) ||
      toInt(payload?.user_id, 0) ||
      toInt(payload?.sub, 0) ||
      0
    );
  } catch {
    return 0;
  }
}

/**
 * ✅ branch_id SIEMPRE desde el usuario/contexto
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
 * ✅ Admin detector (robusto)
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
 * ✅ Detecta alias real de asociación entre modelos (evita 500 por "as" incorrecto)
 */
function findAssocAlias(sourceModel, targetModel) {
  try {
    const assocs = sourceModel?.associations || {};
    for (const [alias, a] of Object.entries(assocs)) {
      if (!a) continue;
      if (a.target === targetModel) return alias;
    }
    return null;
  } catch {
    return null;
  }
}

function pickUserAttributes() {
  const attrs = [];
  const has = (k) => !!User?.rawAttributes?.[k];
  attrs.push("id");
  if (has("name")) attrs.push("name");
  if (has("full_name")) attrs.push("full_name");
  if (has("username")) attrs.push("username");
  if (has("email")) attrs.push("email");
  if (has("identifier")) attrs.push("identifier");
  if (has("first_name")) attrs.push("first_name");
  if (has("last_name")) attrs.push("last_name");
  return Array.from(new Set(attrs));
}

function pickBranchAttributes() {
  const attrs = [];
  const has = (k) => !!Branch?.rawAttributes?.[k];
  attrs.push("id");
  if (has("name")) attrs.push("name");
  if (has("title")) attrs.push("title");
  if (has("label")) attrs.push("label");
  return Array.from(new Set(attrs));
}

function getTableName(model, fallback) {
  try {
    const t = model?.getTableName?.();
    if (!t) return fallback;
    if (typeof t === "string") return t;
    if (typeof t?.tableName === "string") return t.tableName;
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * ✅ Base where: branch/status/from/to/q
 * branch:
 *  - admin: permite branch_id query
 *  - no admin: branch_id desde token/contexto
 */
function buildWhereFromQuery(req) {
  const admin = isAdminReq(req);

  const q = String(req.query.q || "").trim();
  const status = String(req.query.status || "").trim().toUpperCase();

  const from = parseDateTime(req.query.from);
  const to = parseDateTime(req.query.to);

  const where = {};

  // ✅ branch
  if (admin) {
    const requested = toInt(req.query.branch_id ?? req.query.branchId, 0);
    if (requested > 0) where.branch_id = requested;
  } else {
    const branch_id = getAuthBranchId(req);
    if (!branch_id) {
      return {
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      };
    }
    where.branch_id = branch_id;
  }

  // ✅ status
  if (status) where.status = status;

  // ✅ dates
  if (from && to) where.sold_at = { [Op.between]: [from, to] };
  else if (from) where.sold_at = { [Op.gte]: from };
  else if (to) where.sold_at = { [Op.lte]: to };

  // ✅ seller/user filter (ARREGLA desplegable vendedor)
  const seller_id = toInt(req.query.seller_id ?? req.query.user_id ?? req.query.sellerId ?? req.query.seller, 0);
  if (seller_id > 0) where.user_id = seller_id;

  // ✅ customer_id filter (si existe en tu modelo Sale)
  const customer_id = toInt(req.query.customer_id ?? req.query.customerId, 0);
  if (customer_id > 0 && Sale?.rawAttributes?.customer_id) {
    where.customer_id = customer_id;
  }

  // ✅ q search (cliente / nro / doc / tel / números)
  if (q) {
    const qNum = toFloat(q, NaN);
    where[Op.or] = [
      { customer_name: { [Op.like]: `%${q}%` } },
      { sale_number: { [Op.like]: `%${q}%` } },
      { customer_phone: { [Op.like]: `%${q}%` } },
      { customer_doc: { [Op.like]: `%${q}%` } },
    ];

    if (Number.isFinite(qNum)) {
      where[Op.or].push({ id: toInt(qNum, 0) });
      where[Op.or].push({ total: qNum });
      where[Op.or].push({ paid_total: qNum });
    }
  }

  return { ok: true, where };
}


/**
 * ✅ List filters SIN duplicar por joins:
 * - pay_method: EXISTS payments
 * - product: EXISTS sale_items
 */
function injectExistsFiltersIntoWhere(where, req) {
  const pay_method = String(req.query.pay_method || req.query.method || "").trim().toUpperCase();
  const product = String(req.query.product || "").trim();

  const payTable = getTableName(Payment, "payments");
  const itemsTable = getTableName(SaleItem, "sale_items");

  const ands = [];

  if (pay_method) {
    ands.push(
      literal(`EXISTS (
        SELECT 1 FROM ${payTable} p
        WHERE p.sale_id = Sale.id AND UPPER(p.method) = ${sequelize.escape(pay_method)}
      )`)
    );
  }

  if (product) {
    const pNum = toInt(product, 0);
    if (pNum > 0) {
      ands.push(
        literal(`EXISTS (
          SELECT 1 FROM ${itemsTable} si
          WHERE si.sale_id = Sale.id AND si.product_id = ${sequelize.escape(pNum)}
        )`)
      );
    } else {
      const like = `%${product}%`;
      ands.push(
        literal(`EXISTS (
          SELECT 1 FROM ${itemsTable} si
          WHERE si.sale_id = Sale.id AND (
            si.product_name_snapshot LIKE ${sequelize.escape(like)} OR
            si.product_sku_snapshot LIKE ${sequelize.escape(like)} OR
            si.product_barcode_snapshot LIKE ${sequelize.escape(like)}
          )
        )`)
      );
    }
  }

  if (ands.length) {
    where[Op.and] = (where[Op.and] || []).concat(ands);
  }
}

// ============================
// GET /api/v1/pos/sales
// ============================
async function listSales(req, res, next) {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const base = buildWhereFromQuery(req);
    if (!base.ok) {
      return res.status(400).json({ ok: false, code: base.code, message: base.message });
    }

    const where = base.where;

    // filtros extra (sin duplicar)
    injectExistsFiltersIntoWhere(where, req);

    // includes “de display”
    const include = [];
    const saleBranchAs = findAssocAlias(Sale, Branch);
    const saleUserAs = findAssocAlias(Sale, User);

    if (Branch && saleBranchAs) include.push({ model: Branch, as: saleBranchAs, required: false, attributes: pickBranchAttributes() });
    if (User && saleUserAs) include.push({ model: User, as: saleUserAs, required: false, attributes: pickUserAttributes() });

    const total = await Sale.count({ where });

    const rows = await Sale.findAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
      include,
      subQuery: false,
    });

    const pages = Math.max(1, Math.ceil(total / limit));

    return res.json({
      ok: true,
      data: rows,
      meta: { page, limit, total, pages },
    });
  } catch (e) {
    console.error("[POS SALES] listSales error:", e?.message || e);
    next(e);
  }
}

/**
 * ✅ Stats NETO:
 * - total vendido NETO (SUM(total) - SUM(refunds))
 * - total cobrado NETO (SUM(paid_total) - SUM(refunds))
 * - breakdown pagos BRUTO por método (CASH/TRANSFER/CARD/QR/OTHER)
 */
async function statsSales(req, res, next) {
  try {
    const base = buildWhereFromQuery(req);
    if (!base.ok) {
      return res.status(400).json({ ok: false, code: base.code, message: base.message });
    }

    const where = base.where;
    const salesTable = getTableName(Sale, "sales");
    const payTable = getTableName(Payment, "payments");
    const refundsTable = getTableName(SaleRefund, "sale_refunds"); // VIEW

    // Reutilizamos mismos filtros EXISTS para stats (en SQL)
    const conds = [];
    const repl = {};

    if (where.branch_id) { conds.push("s.branch_id = :branch_id"); repl.branch_id = where.branch_id; }
    if (where.status) { conds.push("s.status = :status"); repl.status = where.status; }

    if (where.sold_at?.[Op.between]) {
      conds.push("s.sold_at BETWEEN :from AND :to");
      repl.from = where.sold_at[Op.between][0];
      repl.to = where.sold_at[Op.between][1];
    } else if (where.sold_at?.[Op.gte]) {
      conds.push("s.sold_at >= :from");
      repl.from = where.sold_at[Op.gte];
    } else if (where.sold_at?.[Op.lte]) {
      conds.push("s.sold_at <= :to");
      repl.to = where.sold_at[Op.lte];
    }

    const q = String(req.query.q || "").trim();
    if (q) {
      repl.qLike = `%${q}%`;
      conds.push("(s.customer_name LIKE :qLike OR s.sale_number LIKE :qLike OR s.customer_phone LIKE :qLike OR s.customer_doc LIKE :qLike)");
    }

    const seller_id = toInt(req.query.seller_id ?? req.query.user_id ?? req.query.sellerId ?? req.query.seller, 0);
    if (seller_id > 0) { conds.push("s.user_id = :seller_id"); repl.seller_id = seller_id; }

    const pay_method = String(req.query.pay_method || req.query.method || "").trim().toUpperCase();
    if (pay_method) {
      conds.push(`EXISTS (SELECT 1 FROM ${payTable} p WHERE p.sale_id = s.id AND UPPER(p.method) = :pay_method)`);
      repl.pay_method = pay_method;
    }

    const product = String(req.query.product || "").trim();
    const itemsTable = getTableName(SaleItem, "sale_items");
    if (product) {
      const pNum = toInt(product, 0);
      if (pNum > 0) {
        conds.push(`EXISTS (SELECT 1 FROM ${itemsTable} si WHERE si.sale_id = s.id AND si.product_id = :product_id)`);
        repl.product_id = pNum;
      } else {
        conds.push(`EXISTS (
          SELECT 1 FROM ${itemsTable} si
          WHERE si.sale_id = s.id AND (
            si.product_name_snapshot LIKE :pLike OR
            si.product_sku_snapshot LIKE :pLike OR
            si.product_barcode_snapshot LIKE :pLike
          )
        )`);
        repl.pLike = `%${product}%`;
      }
    }

    const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const refundsJoin = `
      LEFT JOIN (
        SELECT r.sale_id, COALESCE(SUM(r.amount),0) AS refunds_sum
        FROM ${refundsTable} r
        GROUP BY r.sale_id
      ) rr ON rr.sale_id = s.id
    `;

    const sqlTotals = `
      SELECT
        COUNT(*) AS sales_count,
        COALESCE(SUM(s.total),0) AS gross_total_sum,
        COALESCE(SUM(s.paid_total),0) AS gross_paid_sum,
        COALESCE(SUM(rr.refunds_sum),0) AS refunds_sum,
        (COALESCE(SUM(s.total),0) - COALESCE(SUM(rr.refunds_sum),0)) AS total_sum,
        (COALESCE(SUM(s.paid_total),0) - COALESCE(SUM(rr.refunds_sum),0)) AS paid_sum
      FROM ${salesTable} s
      ${refundsJoin}
      ${whereSql}
    `;

    const sqlPayments = `
      SELECT
        UPPER(p.method) AS method,
        COALESCE(SUM(p.amount),0) AS amount_sum
      FROM ${payTable} p
      INNER JOIN ${salesTable} s ON s.id = p.sale_id
      ${whereSql}
      GROUP BY UPPER(p.method)
      ORDER BY UPPER(p.method) ASC
    `;

    const [rowsTotals] = await sequelize.query(sqlTotals, { replacements: repl });
    const [rowsPay] = await sequelize.query(sqlPayments, { replacements: repl });

    const t = rowsTotals?.[0] || {};

    const byMethod = {};
    for (const r of rowsPay || []) {
      const k = String(r.method || "").trim().toUpperCase() || "OTHER";
      byMethod[k] = Number(r.amount_sum || 0);
    }

    return res.json({
      ok: true,
      data: {
        sales_count: toInt(t.sales_count, 0),

        // ✅ NETO
        total_sum: Number(t.total_sum || 0),
        paid_sum: Number(t.paid_sum || 0),

        // ✅ auditoría
        refunds_sum: Number(t.refunds_sum || 0),
        gross_total_sum: Number(t.gross_total_sum || 0),
        gross_paid_sum: Number(t.gross_paid_sum || 0),

        payments: {
          cash: byMethod.CASH || 0,
          transfer: byMethod.TRANSFER || 0,
          card: byMethod.CARD || 0,
          qr: byMethod.QR || 0,
          other: byMethod.OTHER || 0,
          raw_by_method: byMethod,
        },
      },
    });
  } catch (e) {
    next(e);
  }
}

// ============================
// GET /api/v1/pos/sales/:id
// ============================
async function getSaleById(req, res, next) {
  try {
    const admin = isAdminReq(req);

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const salePaymentsAs = findAssocAlias(Sale, Payment);
    const saleItemsAs = findAssocAlias(Sale, SaleItem);
    const saleBranchAs = findAssocAlias(Sale, Branch);
    const saleUserAs = findAssocAlias(Sale, User);

    const itemWarehouseAs = findAssocAlias(SaleItem, Warehouse);
    const itemProductAs = findAssocAlias(SaleItem, Product);

    const productCategoryAs = findAssocAlias(Product, Category);
    const productImagesAs = findAssocAlias(Product, ProductImage);
    const catParentAs = findAssocAlias(Category, Category);

    const include = [];

    if (Payment && salePaymentsAs) include.push({ model: Payment, as: salePaymentsAs, required: false });
    if (Branch && saleBranchAs) include.push({ model: Branch, as: saleBranchAs, required: false, attributes: pickBranchAttributes() });
    if (User && saleUserAs) include.push({ model: User, as: saleUserAs, required: false, attributes: pickUserAttributes() });

    if (SaleItem && saleItemsAs) {
      const itemInclude = [];

      if (Warehouse && itemWarehouseAs) itemInclude.push({ model: Warehouse, as: itemWarehouseAs, required: false });

      if (Product && itemProductAs) {
        const prodInclude = [];

        if (Category && productCategoryAs) {
          const catInclude = [];
          if (catParentAs) catInclude.push({ model: Category, as: catParentAs, required: false });
          prodInclude.push({ model: Category, as: productCategoryAs, required: false, include: catInclude });
        }

        if (ProductImage && productImagesAs) {
          prodInclude.push({ model: ProductImage, as: productImagesAs, required: false });
        }

        itemInclude.push({ model: Product, as: itemProductAs, required: false, include: prodInclude });
      }

      include.push({ model: SaleItem, as: saleItemsAs, required: false, include: itemInclude });
    }

    const order = [];
    if (salePaymentsAs) order.push([{ model: Payment, as: salePaymentsAs }, "id", "ASC"]);
    if (saleItemsAs) order.push([{ model: SaleItem, as: saleItemsAs }, "id", "ASC"]);

    const sale = await Sale.findByPk(id, {
      include,
      order: order.length ? order : undefined,
    });

    if (!sale) return res.status(404).json({ ok: false, message: "Venta no encontrada" });

    if (!admin) {
      const branch_id = getAuthBranchId(req);
      if (!branch_id) {
        return res.status(400).json({
          ok: false,
          code: "BRANCH_REQUIRED",
          message: "No se pudo determinar la sucursal del usuario (branch_id).",
        });
      }
      if (toInt(sale.branch_id, 0) !== toInt(branch_id, 0)) {
        return res.status(403).json({
          ok: false,
          code: "CROSS_BRANCH_SALE",
          message: "No podés ver una venta de otra sucursal.",
        });
      }
    }

    // ✅ Refunds desde VIEW (solo lectura)
    let refunds = [];
    if (SaleRefund) {
      refunds = await SaleRefund.findAll({
        where: { sale_id: id },
        order: [["created_at", "DESC"]],
      });
    }

    // ✅ Exchanges (si lo usás)
    let exchanges = [];
    if (SaleExchange) {
      exchanges = await SaleExchange.findAll({
        where: { [Op.or]: [{ original_sale_id: id }, { new_sale_id: id }] },
        order: [["created_at", "DESC"]],
      });
    }

    return res.json({ ok: true, data: { sale, refunds, exchanges } });
  } catch (e) {
    next(e);
  }
}

// ============================
// POST /api/v1/pos/sales
// (tu createSale lo dejo TAL CUAL lo tenías)
// ============================
async function createSale(req, res, next) {
  const t = await sequelize.transaction();
  try {
    const user_id = getAuthUserId(req);
    if (!user_id) {
      await t.rollback();
      return res.status(401).json({
        ok: false,
        code: "NO_USER",
        message: "No se pudo determinar el usuario autenticado (user_id).",
      });
    }

    const branch_id = getAuthBranchId(req);
    if (!branch_id) {
      await t.rollback();
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const customer_name = String(req.body?.customer_name || "").trim() || null;
    const status = upper(req.body?.status) || "PAID";
    const sold_at = parseDateTime(req.body?.sold_at) || nowDate();

    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    const payments = Array.isArray(req.body?.payments) ? req.body.payments : [];

    if (!items || items.length === 0) {
      await t.rollback();
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "items requerido (array no vacío)",
      });
    }

    const normItems = [];
    for (const it of items) {
      const product_id = toInt(it?.product_id || it?.productId, 0);
      const quantity = toFloat(it?.quantity, 0);
      const unit_price = toFloat(it?.unit_price ?? it?.unitPrice ?? it?.price, 0);

      const warehouse_id = await (async () => {
        const direct = toInt(it?.warehouse_id || it?.warehouseId, 0);
        if (direct > 0) return direct;

        const fromReq =
          toInt(req?.ctx?.warehouseId, 0) ||
          toInt(req?.ctx?.warehouse_id, 0) ||
          toInt(req?.warehouse?.id, 0) ||
          toInt(req?.warehouseId, 0) ||
          toInt(req?.branchContext?.warehouse_id, 0) ||
          toInt(req?.branchContext?.default_warehouse_id, 0) ||
          toInt(req?.branch?.warehouse_id, 0) ||
          toInt(req?.branch?.default_warehouse_id, 0) ||
          0;

        if (fromReq > 0) return fromReq;

        const wh = await Warehouse.findOne({
          where: { branch_id: toInt(branch_id, 0) },
          order: [["id", "ASC"]],
          transaction: t,
        });

        return toInt(wh?.id, 0);
      })();

      normItems.push({
        product_id,
        warehouse_id,
        quantity,
        unit_price,
        line_total: quantity * unit_price,
      });
    }

    for (const it of normItems) {
      if (!it.product_id || it.quantity <= 0 || it.unit_price < 0) {
        await t.rollback();
        return res.status(400).json({
          ok: false,
          code: "BAD_REQUEST",
          message: "Item inválido: product_id requerido, quantity>0, unit_price>=0",
        });
      }
      if (!it.warehouse_id) {
        await t.rollback();
        return res.status(400).json({
          ok: false,
          code: "WAREHOUSE_REQUIRED",
          message: "warehouse_id requerido (no vino en item y no se encontró depósito default para esta sucursal).",
        });
      }

      const wh = await Warehouse.findByPk(it.warehouse_id, { transaction: t });
      if (!wh) {
        await t.rollback();
        return res.status(404).json({ ok: false, code: "WAREHOUSE_NOT_FOUND", message: "Depósito inexistente." });
      }
      if (toInt(wh.branch_id, 0) !== toInt(branch_id, 0)) {
        await t.rollback();
        return res.status(403).json({
          ok: false,
          code: "CROSS_BRANCH_WAREHOUSE",
          message: "El depósito no pertenece a la sucursal del usuario.",
        });
      }
    }

    if (Product?.rawAttributes?.branch_id) {
      const ids = [...new Set(normItems.map((x) => x.product_id))];
      const prods = await Product.findAll({
        where: { id: ids },
        attributes: ["id", "branch_id"],
        transaction: t,
      });

      const map = new Map(prods.map((p) => [toInt(p.id, 0), toInt(p.branch_id, 0)]));
      for (const it of normItems) {
        const pb = map.get(toInt(it.product_id, 0));
        if (!pb) {
          await t.rollback();
          return res.status(400).json({
            ok: false,
            code: "PRODUCT_NOT_FOUND",
            message: `Producto no existe: product_id=${it.product_id}`,
          });
        }
        if (toInt(pb, 0) !== toInt(branch_id, 0)) {
          await t.rollback();
          return res.status(403).json({
            ok: false,
            code: "CROSS_BRANCH_PRODUCT",
            message: `Producto ${it.product_id} no pertenece a la sucursal del usuario.`,
          });
        }
      }
    }

    const subtotal = normItems.reduce((a, it) => a + it.line_total, 0);
    const discount_total = toFloat(req.body?.discount_total, 0);
    const tax_total = toFloat(req.body?.tax_total, 0);
    const total = Math.max(0, subtotal - discount_total + tax_total);

    const paid_total = payments.reduce((a, p) => a + toFloat(p?.amount, 0), 0);
    const change_total = Math.max(0, paid_total - total);

    const salePayload = {
      branch_id,
      user_id,
      customer_name,
      status,
      sold_at,
      subtotal,
      discount_total,
      tax_total,
      total,
      paid_total,
      change_total,
    };

    if (typeof req.body?.sale_number === "string" && req.body.sale_number.trim()) {
      salePayload.sale_number = req.body.sale_number.trim();
    }

    const sale = await Sale.create(salePayload, { transaction: t });

    await SaleItem.bulkCreate(
      normItems.map((it) => ({
        sale_id: sale.id,
        product_id: it.product_id,
        warehouse_id: it.warehouse_id,
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.line_total,
      })),
      { transaction: t }
    );

    if (payments.length) {
      await Payment.bulkCreate(
        payments.map((p) => ({
          sale_id: sale.id,
          method: upper(p?.method) || "OTHER",
          amount: toFloat(p?.amount, 0),
          paid_at: parseDateTime(p?.paid_at) || sold_at,
        })),
        { transaction: t }
      );
    }

    await t.commit();

    const payAs = findAssocAlias(Sale, Payment);
    const created = await Sale.findByPk(sale.id, {
      include: payAs ? [{ model: Payment, as: payAs, required: false }] : [],
    });

    return res.status(201).json({ ok: true, message: "Venta creada", data: created });
  } catch (e) {
    try { await t.rollback(); } catch {}
    next(e);
  }
}

// ============================
// POST /api/v1/pos/sales/:id/refunds
// ✅ CREA DEVOLUCIÓN REAL (ADMIN) -> sale_returns + sale_return_payments
// (sale_refunds es VIEW, NO se escribe ahí)
// ============================
async function createRefund(req, res, next) {
  const t = await sequelize.transaction();
  try {
    if (!isAdminReq(req)) {
      await t.rollback();
      return res.status(403).json({
        ok: false,
        code: "ADMIN_ONLY",
        message: "Solo administrador puede registrar devoluciones.",
      });
    }

    const sale_id = toInt(req.params.id, 0);
    if (!sale_id) {
      await t.rollback();
      return res.status(400).json({ ok: false, message: "ID inválido" });
    }

    const sale = await Sale.findByPk(sale_id, { transaction: t });
    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, message: "Venta no encontrada" });
    }

    const amount = toFloat(req.body?.amount, NaN);
    if (!Number.isFinite(amount) || amount <= 0) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "BAD_AMOUNT", message: "Monto inválido" });
    }

    const method = upper(req.body?.method || "CASH");
    const allowed = new Set(["CASH", "TRANSFER", "CARD", "QR", "OTHER"]);
    if (!allowed.has(method)) {
      await t.rollback();
      return res.status(400).json({
        ok: false,
        code: "BAD_METHOD",
        message: `method inválido. Usá: ${Array.from(allowed).join(", ")}`,
      });
    }

    const restock = req.body?.restock === false ? 0 : 1;
    const reason = String(req.body?.reason || "").trim() || null;
    const note = String(req.body?.note || "").trim() || null;
    const reference = String(req.body?.reference || "").trim() || null;

    // total ya devuelto (VIEW)
    const refundsTable = getTableName(SaleRefund, "sale_refunds");
    const [rf] = await sequelize.query(
      `SELECT COALESCE(SUM(r.amount),0) AS refunded_sum FROM ${refundsTable} r WHERE r.sale_id = :sale_id`,
      { replacements: { sale_id }, transaction: t }
    );
    const refundedSum = Number(rf?.[0]?.refunded_sum || 0);

    const paidTotal = Number(sale.paid_total || 0);
    const remaining = Math.max(0, paidTotal - refundedSum);

    if (amount > remaining + 0.00001) {
      await t.rollback();
      return res.status(400).json({
        ok: false,
        code: "AMOUNT_EXCEEDS_REMAINING",
        message: `El monto supera lo disponible para devolver. Disponible: ${remaining}`,
        data: { remaining, paid_total: paidTotal, refunded_sum: refundedSum },
      });
    }

    const created_by = getAuthUserId(req) || null;

    // 1) insert sale_returns
    const [insReturn] = await sequelize.query(
      `INSERT INTO sale_returns (sale_id, amount, restock, reason, note, created_by, created_at)
       VALUES (:sale_id, :amount, :restock, :reason, :note, :created_by, NOW())`,
      {
        replacements: { sale_id, amount, restock, reason, note, created_by },
        transaction: t,
      }
    );

    // mysql2: insertId suele venir en insReturn.insertId
    const return_id = toInt(insReturn?.insertId, 0);
    if (!return_id) {
      await t.rollback();
      return res.status(500).json({ ok: false, code: "RETURN_INSERT_FAILED", message: "No se pudo crear sale_returns" });
    }

    // 2) insert sale_return_payments
    await sequelize.query(
      `INSERT INTO sale_return_payments (return_id, method, amount, reference, note, created_at)
       VALUES (:return_id, :method, :amount, :reference, :pnote, NOW())`,
      {
        replacements: { return_id, method, amount, reference, pnote: note },
        transaction: t,
      }
    );

    // 3) si quedó totalmente devuelta -> status REFUNDED
    const newRefunded = refundedSum + amount;
    const fullyRefunded = newRefunded >= paidTotal - 0.00001;
    if (fullyRefunded && Sale?.rawAttributes?.status) {
      await sale.update({ status: "REFUNDED" }, { transaction: t });
    }

    await t.commit();

    // respuesta (la VIEW ya debería reflejarlo)
    const refundRow = SaleRefund
      ? await SaleRefund.findOne({ where: { sale_id, amount, created_at: { [Op.ne]: null } }, order: [["created_at", "DESC"]] })
      : null;

    return res.status(201).json({
      ok: true,
      message: "Devolución registrada",
      data: {
        sale_id,
        return_id,
        amount,
        method,
        refunded_sum: newRefunded,
        remaining: Math.max(0, paidTotal - newRefunded),
        status: fullyRefunded ? "REFUNDED" : sale.status,
        refund_view: refundRow,
      },
    });
  } catch (e) {
    try { await t.rollback(); } catch {}
    next(e);
  }
}

// ============================
// DELETE /api/v1/pos/sales/:id
// ✅ NO toca sale_refunds (VIEW)
// Si hay devoluciones/exchanges, por defecto BLOQUEA (a menos que force=1)
// ============================
async function deleteSale(req, res, next) {
  const t = await sequelize.transaction();
  try {
    const admin = isAdminReq(req);
    const branch_id = getAuthBranchId(req);

    if (!admin && !branch_id) {
      await t.rollback();
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const id = toInt(req.params.id, 0);
    if (!id) {
      await t.rollback();
      return res.status(400).json({ ok: false, message: "ID inválido" });
    }

    const sale = await Sale.findByPk(id, { transaction: t });
    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, message: "Venta no encontrada" });
    }

    if (!admin && toInt(sale.branch_id, 0) !== toInt(branch_id, 0)) {
      await t.rollback();
      return res.status(403).json({
        ok: false,
        code: "CROSS_BRANCH_SALE",
        message: "No podés eliminar una venta de otra sucursal.",
      });
    }

    const force = String(req.query.force || "0") === "1";

    // Si existen devoluciones, bloquear (salvo force=1)
    const [rr] = await sequelize.query(
      `SELECT COUNT(*) AS c FROM sale_returns WHERE sale_id = :sale_id`,
      { replacements: { sale_id: id }, transaction: t }
    );
    const returnsCount = toInt(rr?.[0]?.c, 0);

    if (returnsCount > 0 && !force) {
      await t.rollback();
      return res.status(409).json({
        ok: false,
        code: "SALE_HAS_RETURNS",
        message: "La venta tiene devoluciones. No se elimina por seguridad. Usá ?force=1 si realmente querés borrar todo.",
        data: { returnsCount },
      });
    }

    if (force && returnsCount > 0) {
      // borrar exchanges primero si referencian returns (por FK)
      await sequelize.query(
        `DELETE FROM sale_exchanges
         WHERE original_sale_id = :sale_id OR new_sale_id = :sale_id OR return_id IN (SELECT id FROM sale_returns WHERE sale_id = :sale_id)`,
        { replacements: { sale_id: id }, transaction: t }
      );

      // borrar returns (cascade debería borrar sale_return_payments/items)
      await sequelize.query(
        `DELETE FROM sale_returns WHERE sale_id = :sale_id`,
        { replacements: { sale_id: id }, transaction: t }
      );
    }

    await Payment.destroy({ where: { sale_id: id }, transaction: t });
    await SaleItem.destroy({ where: { sale_id: id }, transaction: t });
    await sale.destroy({ transaction: t });

    await t.commit();
    return res.json({ ok: true, message: "Venta eliminada" });
  } catch (e) {
    try { await t.rollback(); } catch {}
    next(e);
  }
}

module.exports = {
  listSales,
  statsSales,
  getSaleById,
  createSale,
  deleteSale,
  createRefund,
};
