// src/controllers/posSales.controller.js
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
 * (no desde body/query)
 */
function getAuthBranchId(req) {
  return (
    // soportar branchContext.middleware.js
    toInt(req?.ctx?.branchId, 0) ||
    toInt(req?.ctx?.branch_id, 0) ||

    // si algún día lo agregás al token o a req.user
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
  return roleNames.map(norm).some((x) =>
    ["admin", "super_admin", "superadmin", "root", "owner"].includes(x)
  );
}

/**
 * 🏬 Resolver warehouse_id obligatorio:
 * 1) item.warehouse_id
 * 2) req.ctx / req.warehouse / req.warehouseId / req.branchContext.*
 * 3) primer depósito de la sucursal en DB
 */
async function resolveWarehouseId(req, branch_id, itemWarehouseId, tx) {
  const direct = toInt(itemWarehouseId, 0);
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
    transaction: tx,
  });

  return toInt(wh?.id, 0);
}

/**
 * ✅ Validar que un warehouse pertenezca a la sucursal
 */
async function assertWarehouseInBranch(warehouse_id, branch_id, tx) {
  const wh = await Warehouse.findByPk(warehouse_id, { transaction: tx });
  if (!wh) {
    return { ok: false, code: "WAREHOUSE_NOT_FOUND", message: "Depósito inexistente." };
  }
  if (toInt(wh.branch_id, 0) !== toInt(branch_id, 0)) {
    return {
      ok: false,
      code: "CROSS_BRANCH_WAREHOUSE",
      message: "El depósito no pertenece a la sucursal del usuario.",
    };
  }
  return { ok: true, warehouse: wh };
}

/**
 * ✅ Elegir atributos válidos del User (evita pedir user.name si no existe)
 */
function pickUserAttributes() {
  const attrs = [];
  const has = (k) => !!User?.rawAttributes?.[k];

  // id siempre
  attrs.push("id");

  // opciones comunes
  if (has("name")) attrs.push("name");
  if (has("full_name")) attrs.push("full_name");
  if (has("username")) attrs.push("username");
  if (has("email")) attrs.push("email");
  if (has("identifier")) attrs.push("identifier");
  if (has("first_name")) attrs.push("first_name");
  if (has("last_name")) attrs.push("last_name");

  // si solo quedó id, igual sirve (no rompe)
  return Array.from(new Set(attrs));
}

/**
 * ✅ Elegir atributos válidos del Branch
 */
function pickBranchAttributes() {
  const attrs = [];
  const has = (k) => !!Branch?.rawAttributes?.[k];
  attrs.push("id");
  if (has("name")) attrs.push("name");
  if (has("title")) attrs.push("title");
  if (has("label")) attrs.push("label");
  return Array.from(new Set(attrs));
}

/**
 * ✅ (NUEVO) Construye "where" EXACTAMENTE con la misma lógica que listSales
 * para reutilizarlo en /stats sin tocar lo que ya funciona.
 */
function buildWhereFromQuery(req) {
  const admin = isAdminReq(req);

  const q = String(req.query.q || "").trim();
  const status = String(req.query.status || "").trim().toUpperCase();

  const from = parseDateTime(req.query.from);
  const to = parseDateTime(req.query.to);

  const where = {};

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

  if (status) where.status = status;

  if (from && to) where.sold_at = { [Op.between]: [from, to] };
  else if (from) where.sold_at = { [Op.gte]: from };
  else if (to) where.sold_at = { [Op.lte]: to };

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
    }
  }

  return { ok: true, where };
}

// ============================
// GET /api/v1/pos/sales
// ============================
async function listSales(req, res, next) {
  try {
    const admin = isAdminReq(req);

    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim().toUpperCase();

    const from = parseDateTime(req.query.from);
    const to = parseDateTime(req.query.to);

    // ✅ Branch filter:
    // - admin: si manda branch_id => filtra, si no => trae todas
    // - no-admin: siempre su branch del contexto
    const where = {};

    if (admin) {
      const requested = toInt(req.query.branch_id ?? req.query.branchId, 0);
      if (requested > 0) where.branch_id = requested;
    } else {
      const branch_id = getAuthBranchId(req);
      if (!branch_id) {
        return res.status(400).json({
          ok: false,
          code: "BRANCH_REQUIRED",
          message: "No se pudo determinar la sucursal del usuario (branch_id).",
        });
      }
      where.branch_id = branch_id;
    }

    if (status) where.status = status;

    if (from && to) where.sold_at = { [Op.between]: [from, to] };
    else if (from) where.sold_at = { [Op.gte]: from };
    else if (to) where.sold_at = { [Op.lte]: to };

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
      }
    }

    const { count, rows } = await Sale.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
      include: [
        { model: Payment, as: "payments", required: false },

        // ✅ Sucursal (para mostrar nombre)
        Branch
          ? { model: Branch, as: "branch", required: false, attributes: pickBranchAttributes() }
          : null,

        // ✅ Usuario (para mostrar nombre/email)
        User
          ? { model: User, as: "user", required: false, attributes: pickUserAttributes() }
          : null,
      ].filter(Boolean),
    });

    const pages = Math.max(1, Math.ceil(count / limit));

    return res.json({
      ok: true,
      data: rows,
      meta: { page, limit, total: count, pages },
    });
  } catch (e) {
    next(e);
  }
}

// ============================
// ✅ (NUEVO) GET /api/v1/pos/sales/stats
// - Count total con filtros
// - Suma total con filtros
// - Método principal (por monto)
// NO afecta listSales, solo agrega endpoint.
// ============================
async function statsSales(req, res, next) {
  try {
    const built = buildWhereFromQuery(req);
    if (!built.ok) {
      return res.status(400).json({ ok: false, code: built.code, message: built.message });
    }
    const { where } = built;

    // 1) Count + Sum
    const agg = await Sale.findOne({
      where,
      attributes: [
        [fn("COUNT", col("Sale.id")), "sales_count"],
        [fn("COALESCE", fn("SUM", col("Sale.total")), 0), "total_sum"],
      ],
      raw: true,
    });

    const sales_count = toInt(agg?.sales_count, 0);
    const total_sum = Number(agg?.total_sum || 0);

    // 2) Método principal (por suma de pagos)
    // ⚠️ Usamos "include Sale as 'sale'" SOLO si existe la asociación.
    const payAssocOk = !!Payment?.associations?.sale;

    let main_method = null;

    if (payAssocOk) {
      const rows = await Payment.findAll({
        attributes: [
          "method",
          [fn("COALESCE", fn("SUM", col("Payment.amount")), 0), "amount_sum"],
        ],
        include: [
          {
            model: Sale,
            as: "sale",
            required: true,
            attributes: [],
            where,
          },
        ],
        group: ["Payment.method"],
        order: [[literal("amount_sum"), "DESC"]],
        raw: true,
      });

      main_method = rows?.[0]?.method || null;
    } else {
      // Fallback sin asociaciones (join manual)
      const [rows] = await sequelize.query(
        `
          SELECT p.method, COALESCE(SUM(p.amount),0) AS amount_sum
          FROM payments p
          INNER JOIN sales s ON s.id = p.sale_id
          WHERE 1=1
            ${where.branch_id ? "AND s.branch_id = :branch_id" : ""}
            ${where.status ? "AND s.status = :status" : ""}
            ${where.sold_at?.[Op.between] ? "AND s.sold_at BETWEEN :from AND :to" : ""}
            ${where.sold_at?.[Op.gte] ? "AND s.sold_at >= :from" : ""}
            ${where.sold_at?.[Op.lte] ? "AND s.sold_at <= :to" : ""}
          GROUP BY p.method
          ORDER BY amount_sum DESC
          LIMIT 1
        `,
        {
          replacements: {
            branch_id: where.branch_id ?? null,
            status: where.status ?? null,
            from: where.sold_at?.[Op.between]?.[0] ?? where.sold_at?.[Op.gte] ?? null,
            to: where.sold_at?.[Op.between]?.[1] ?? where.sold_at?.[Op.lte] ?? null,
          },
        }
      );

      main_method = rows?.[0]?.method || null;
    }

    return res.json({
      ok: true,
      data: {
        sales_count,
        total_sum,
        main_method,
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

    const sale = await Sale.findByPk(id, {
      include: [
        { model: Payment, as: "payments", required: false },

        Branch
          ? { model: Branch, as: "branch", required: false, attributes: pickBranchAttributes() }
          : null,

        User
          ? { model: User, as: "user", required: false, attributes: pickUserAttributes() }
          : null,

        {
          model: SaleItem,
          as: "items",
          required: false,
          include: [
            { model: Warehouse, as: "warehouse", required: false },
            {
              model: Product,
              as: "product",
              required: false,
              include: [
                {
                  model: Category,
                  as: "category",
                  required: false,
                  include: [{ model: Category, as: "parent", required: false }],
                },
                { model: ProductImage, as: "images", required: false },
              ],
            },
          ],
        },
      ].filter(Boolean),
    });

    if (!sale) return res.status(404).json({ ok: false, message: "Venta no encontrada" });

    // ✅ No-admin: no puede ver otra sucursal
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

    return res.json({ ok: true, data: sale });
  } catch (e) {
    next(e);
  }
}

// ============================
// POST /api/v1/pos/sales
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

      const warehouse_id = await resolveWarehouseId(
        req,
        branch_id,
        it?.warehouse_id || it?.warehouseId,
        t
      );

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
          message:
            "warehouse_id requerido (no vino en item y no se encontró depósito default para esta sucursal).",
        });
      }

      const whCheck = await assertWarehouseInBranch(it.warehouse_id, branch_id, t);
      if (!whCheck.ok) {
        await t.rollback();
        return res.status(403).json({ ok: false, code: whCheck.code, message: whCheck.message });
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

    const created = await Sale.findByPk(sale.id, {
      include: [{ model: Payment, as: "payments", required: false }],
    });

    return res.status(201).json({ ok: true, message: "Venta creada", data: created });
  } catch (e) {
    try {
      await t.rollback();
    } catch {}
    next(e);
  }
}

// ============================
// DELETE /api/v1/pos/sales/:id
// ============================
async function deleteSale(req, res, next) {
  const t = await sequelize.transaction();
  try {
    const admin = isAdminReq(req);

    const branch_id = getAuthBranchId(req);

    // ✅ No-admin: branch_id obligatorio
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

    // ✅ No-admin: no puede eliminar una venta de otra sucursal
    // ✅ Admin: puede cross-branch
    if (!admin && toInt(sale.branch_id, 0) !== toInt(branch_id, 0)) {
      await t.rollback();
      return res.status(403).json({
        ok: false,
        code: "CROSS_BRANCH_SALE",
        message: "No podés eliminar una venta de otra sucursal.",
      });
    }

    await Payment.destroy({ where: { sale_id: id }, transaction: t });
    await SaleItem.destroy({ where: { sale_id: id }, transaction: t });

    await sale.destroy({ transaction: t });

    await t.commit();
    return res.json({ ok: true, message: "Venta eliminada" });
  } catch (e) {
    try {
      await t.rollback();
    } catch {}
    next(e);
  }
}

module.exports = {
  listSales,
  statsSales, // ✅ NUEVO (no afecta lo demás)
  getSaleById,
  createSale,
  deleteSale,
};
