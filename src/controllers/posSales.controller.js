// src/controllers/posSales.controller.js
const { Op } = require("sequelize");
const {
  sequelize,
  Sale,
  Payment,
  SaleItem,
  Product,
  Category,
  ProductImage,
  Warehouse,
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
 * 🔐 Obtiene el user_id desde cualquier middleware / JWT conocido
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

// ============================
// GET /api/v1/pos/sales
// ============================
async function listSales(req, res, next) {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim().toUpperCase();
    const branchId = toInt(req.query.branch_id, 0);

    const from = parseDateTime(req.query.from);
    const to = parseDateTime(req.query.to);

    const where = {};

    if (branchId > 0) where.branch_id = branchId;
    if (status) where.status = status;

    if (from && to) where.sold_at = { [Op.between]: [from, to] };
    else if (from) where.sold_at = { [Op.gte]: from };
    else if (to) where.sold_at = { [Op.lte]: to };

    if (q) {
      const qNum = toFloat(q, NaN);
      where[Op.or] = [
        { customer_name: { [Op.like]: `%${q}%` } },
        { sale_number: { [Op.like]: `%${q}%` } },
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
      include: [{ model: Payment, as: "payments", required: false }],
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
// GET /api/v1/pos/sales/:id
// ============================
async function getSaleById(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const sale = await Sale.findByPk(id, {
      include: [
        { model: Payment, as: "payments", required: false },
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
      ],
    });

    if (!sale) return res.status(404).json({ ok: false, message: "Venta no encontrada" });

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
    // 🔐 user_id OBLIGATORIO (resuelto de forma robusta)
    const user_id = getAuthUserId(req);

    if (!user_id) {
      await t.rollback();
      return res.status(401).json({
        ok: false,
        code: "NO_USER",
        message: "No se pudo determinar el usuario autenticado (user_id).",
      });
    }

    const branch_id =
      toInt(req.body?.branch_id, 0) ||
      toInt(req.query?.branch_id, 0) ||
      toInt(req.branch?.id, 0) ||
      toInt(req.branchId, 0);

    if (!branch_id) {
      await t.rollback();
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "branch_id requerido",
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

    const normItems = items.map((it) => {
      const product_id = toInt(it?.product_id || it?.productId, 0);
      const warehouse_id = toInt(it?.warehouse_id || it?.warehouseId, 0) || null;
      const quantity = toFloat(it?.quantity, 0);
      const unit_price = toFloat(it?.unit_price ?? it?.unitPrice ?? it?.price, 0);

      return {
        product_id,
        warehouse_id,
        quantity,
        unit_price,
        line_total: quantity * unit_price,
      };
    });

    for (const it of normItems) {
      if (!it.product_id || it.quantity <= 0 || it.unit_price < 0) {
        await t.rollback();
        return res.status(400).json({
          ok: false,
          code: "BAD_REQUEST",
          message: "Item inválido: product_id requerido, quantity>0, unit_price>=0",
        });
      }
    }

    const subtotal = normItems.reduce((a, it) => a + it.line_total, 0);
    const discount_total = toFloat(req.body?.discount_total, 0);
    const tax_total = toFloat(req.body?.tax_total, 0);
    const total = Math.max(0, subtotal - discount_total + tax_total);

    const paid_total = payments.reduce((a, p) => a + toFloat(p?.amount, 0), 0);
    const change_total = Math.max(0, paid_total - total);

    const sale = await Sale.create(
      {
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
      },
      { transaction: t }
    );

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

    return res.status(201).json({
      ok: true,
      message: "Venta creada",
      data: created,
    });
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
  getSaleById,
  createSale,
  deleteSale,
};
