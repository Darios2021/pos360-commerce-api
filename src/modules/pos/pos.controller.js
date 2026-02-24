// ✅ COPY-PASTE FINAL COMPLETO (AJUSTADO)
// src/modules/pos/pos.controller.js
const { Op, QueryTypes } = require("sequelize");
const { sequelize, Sale, SaleItem, Payment, Product, ProductImage, Category } = require("../../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function round2(n) {
  return Math.round((toNum(n, 0) + Number.EPSILON) * 100) / 100;
}

function parseDateTime(v) {
  if (!v) return null;
  const s = String(v).trim();
  const dt = s.length === 10 ? `${s} 00:00:00` : s;
  const d = new Date(dt.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

function includeFullProduct() {
  return [
    {
      model: Product,
      as: "product",
      required: false,
      include: [
        { model: Category, as: "category", required: false, attributes: ["id", "name", "parent_id"] },
        { model: ProductImage, as: "images", required: false },
      ],
    },
  ];
}

// ✅ helper: obtener caja OPEN de branch
async function getOpenCashRegisterId(branchId, t) {
  const rows = await sequelize.query(
    `
    SELECT id
    FROM cash_registers
    WHERE branch_id = :branch_id
      AND status = 'OPEN'
    ORDER BY opened_at DESC
    LIMIT 1
    `,
    { type: QueryTypes.SELECT, replacements: { branch_id: branchId }, transaction: t }
  );
  return rows?.[0]?.id ?? null;
}

/**
 * GET /pos/sales
 */
async function listSales(req, res) {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim();
    const branchId = toInt(req.query.branch_id, 0) || null;

    const from = parseDateTime(req.query.from);
    const to = parseDateTime(req.query.to);

    const where = {};
    if (branchId) where.branch_id = branchId;
    if (status) where.status = status;

    if (from || to) {
      where.sold_at = {};
      if (from) where.sold_at[Op.gte] = from;
      if (to) where.sold_at[Op.lte] = to;
    }

    if (q) {
      where[Op.or] = [
        { customer_name: { [Op.like]: `%${q}%` } },
        { sale_number: { [Op.like]: `%${q}%` } },
        { id: toInt(q, -1) > 0 ? toInt(q, -1) : -999999999 },
      ];
    }

    const { rows, count } = await Sale.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
      include: [
        { model: Payment, as: "payments", required: false },
        { model: SaleItem, as: "items", required: false, include: includeFullProduct() },
      ],
    });

    const pages = Math.max(1, Math.ceil(count / limit));

    res.json({ ok: true, data: rows, meta: { page, limit, total: count, pages } });
  } catch (e) {
    console.error("[POS listSales ERROR]", e);
    res.status(500).json({ ok: false, message: e.message });
  }
}

/**
 * GET /pos/sales/:id
 */
async function getSale(req, res) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const sale = await Sale.findByPk(id, {
      include: [
        { model: Payment, as: "payments", required: false },
        { model: SaleItem, as: "items", required: false, include: includeFullProduct() },
      ],
    });

    if (!sale) return res.status(404).json({ ok: false, code: "NOT_FOUND" });
    res.json({ ok: true, data: sale });
  } catch (e) {
    console.error("[POS getSale ERROR]", e);
    res.status(500).json({ ok: false, message: e.message });
  }
}

/**
 * POST /pos/sales
 * ✅ FIX: cash_register_id SIEMPRE (requiere caja OPEN)
 */
async function createSale(req, res) {
  let t;
  try {
    const body = req.body || {};
    const branchId = toInt(body.branch_id, 0) || 0;
    const userId = toInt(body.user_id, 0) || (req.user?.id ?? 0);

    const customerName = body.customer_name || "Consumidor Final";
    const items = Array.isArray(body.items) ? body.items : [];
    const paymentsIn = Array.isArray(body.payments) ? body.payments : [];

    if (!branchId) return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED", message: "branch_id requerido" });
    if (!userId) return res.status(400).json({ ok: false, code: "USER_REQUIRED", message: "user_id requerido" });
    if (!items.length) return res.status(400).json({ ok: false, code: "ITEMS_REQUIRED", message: "Venta sin items." });

    t = await sequelize.transaction();

    // ✅ caja OPEN obligatoria
    const cashRegisterId = await getOpenCashRegisterId(branchId, t);
    if (!cashRegisterId) {
      await t.rollback();
      return res.status(409).json({
        ok: false,
        code: "CASH_REGISTER_REQUIRED",
        message: "Debe abrir caja antes de vender (no hay caja OPEN para la sucursal).",
      });
    }

    // calcular total
    let calculatedTotal = 0;
    const prepared = items.map((i) => {
      const qty = round2(i.quantity ?? i.qty ?? 0);
      const price = round2(i.unit_price ?? i.price ?? 0);
      const lineTotal = round2(qty * price);
      calculatedTotal = round2(calculatedTotal + lineTotal);

      return {
        product_id: toInt(i.product_id, 0),
        quantity: qty,
        unit_price: price,
        line_total: lineTotal,
        product_name_snapshot: i.product_name_snapshot || i.name || "Item",
        product_sku_snapshot: i.product_sku_snapshot || i.sku || null,
        product_barcode_snapshot: i.product_barcode_snapshot || i.barcode || null,
      };
    });

    // pagos: si no mandan, asumimos CASH exacto
    let payments = paymentsIn;
    if (!payments.length) payments = [{ method: "CASH", amount: calculatedTotal }];

    const paidTotal = round2(payments.reduce((a, p) => a + toNum(p.amount, 0), 0));
    const changeTotal = paidTotal > calculatedTotal ? round2(paidTotal - calculatedTotal) : 0;

    const sale = await Sale.create(
      {
        branch_id: branchId,
        cash_register_id: cashRegisterId, // ✅ CRÍTICO
        user_id: userId,
        customer_name: customerName,

        subtotal: calculatedTotal,
        tax_total: 0,
        discount_total: 0,
        total: calculatedTotal,

        paid_total: paidTotal,
        change_total: changeTotal,

        status: "PAID",
        sold_at: new Date(),
      },
      { transaction: t }
    );

    for (const item of prepared) {
      if (!item.product_id) {
        await t.rollback();
        return res.status(400).json({ ok: false, code: "ITEM_PRODUCT_REQUIRED", message: "Item sin product_id" });
      }

      await SaleItem.create(
        {
          sale_id: sale.id,
          ...item,
        },
        { transaction: t }
      );
    }

    for (const p of payments) {
      await Payment.create(
        {
          sale_id: sale.id,
          amount: round2(p.amount ?? 0),
          method: String(p.method ?? "CASH").toUpperCase(),
          paid_at: new Date(),
          reference: p.reference ?? null,
          note: p.note ?? null,
        },
        { transaction: t }
      );
    }

    await t.commit();

    const full = await Sale.findByPk(sale.id, {
      include: [
        { model: Payment, as: "payments", required: false },
        { model: SaleItem, as: "items", required: false, include: includeFullProduct() },
      ],
    });

    res.json({ ok: true, data: full });
  } catch (e) {
    if (t) await t.rollback();
    console.error("[POS createSale ERROR]", e);
    res.status(500).json({ ok: false, message: e.message });
  }
}

/**
 * DELETE /pos/sales/:id
 */
async function deleteSale(req, res) {
  let t;
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    t = await sequelize.transaction();

    const sale = await Sale.findByPk(id, { transaction: t });
    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "NOT_FOUND" });
    }

    await Payment.destroy({ where: { sale_id: id }, transaction: t });
    await SaleItem.destroy({ where: { sale_id: id }, transaction: t });
    await Sale.destroy({ where: { id }, transaction: t });

    await t.commit();
    res.json({ ok: true, message: `Venta #${id} eliminada.` });
  } catch (e) {
    if (t) await t.rollback();
    console.error("[POS deleteSale ERROR]", e);
    res.status(500).json({ ok: false, message: e.message });
  }
}

module.exports = {
  listSales,
  getSale,
  createSale,
  deleteSale,
};