// src/controllers/posSales.controller.js
const { Op } = require("sequelize");
const { Sale, Payment, SaleItem, Product, Category, ProductImage, Warehouse } = require("../models");

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

// ============================
// GET /api/v1/pos/sales
// Query: page, limit, q, status, from, to, branch_id
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
// DELETE /api/v1/pos/sales/:id
// ============================
async function deleteSale(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const sale = await Sale.findByPk(id);
    if (!sale) return res.status(404).json({ ok: false, message: "Venta no encontrada" });

    await sale.destroy();

    return res.json({ ok: true, message: "Venta eliminada" });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listSales,
  getSaleById,
  deleteSale,
};
