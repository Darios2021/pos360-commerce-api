const { Op } = require("sequelize");
const { Product, Category } = require("../models");

function toInt(v, d) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

exports.list = async (req, res) => {
  const q = (req.query.q || "").trim();
  const page = Math.max(1, toInt(req.query.page, 1));
  const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
  const offset = (page - 1) * limit;

  const where = {};
  if (q) {
    where[Op.or] = [
      { name: { [Op.like]: `%${q}%` } },
      { sku: { [Op.like]: `%${q}%` } },
      { barcode: { [Op.like]: `%${q}%` } },
      { brand: { [Op.like]: `%${q}%` } },
      { model: { [Op.like]: `%${q}%` } },
    ];
  }

  const { rows, count } = await Product.findAndCountAll({
    where,
    include: [{ model: Category, as: "category", attributes: ["id", "name"] }],
    order: [["id", "DESC"]],
    limit,
    offset,
  });

  res.json({ ok: true, page, limit, total: count, items: rows });
};

exports.getOne = async (req, res) => {
  const item = await Product.findByPk(req.params.id, {
    include: [{ model: Category, as: "category", attributes: ["id", "name"] }],
  });
  if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });
  res.json({ ok: true, item });
};

exports.create = async (req, res) => {
  const body = req.body || {};
  if (!body.sku || !body.name) {
    return res.status(400).json({ ok: false, code: "VALIDATION", message: "sku y name son obligatorios" });
  }

  const item = await Product.create({
    sku: body.sku,
    barcode: body.barcode || null,
    name: body.name,
    description: body.description || null,
    category_id: body.category_id || null,
    brand: body.brand || null,
    model: body.model || null,
    warranty_months: body.warranty_months ?? 0,
    track_stock: body.track_stock ?? 1,
    is_active: body.is_active ?? 1,
    cost: body.cost ?? 0,
    price: body.price ?? 0,
    tax_rate: body.tax_rate ?? 21,
  });

  res.status(201).json({ ok: true, item });
};

exports.update = async (req, res) => {
  const item = await Product.findByPk(req.params.id);
  if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

  const body = req.body || {};
  await item.update({
    sku: body.sku ?? item.sku,
    barcode: body.barcode ?? item.barcode,
    name: body.name ?? item.name,
    description: body.description ?? item.description,
    category_id: body.category_id ?? item.category_id,
    brand: body.brand ?? item.brand,
    model: body.model ?? item.model,
    warranty_months: body.warranty_months ?? item.warranty_months,
    track_stock: body.track_stock ?? item.track_stock,
    is_active: body.is_active ?? item.is_active,
    cost: body.cost ?? item.cost,
    price: body.price ?? item.price,
    tax_rate: body.tax_rate ?? item.tax_rate,
  });

  res.json({ ok: true, item });
};
