const { Op } = require("sequelize");
const { Product, Category } = require("../models");

function toInt(v, d) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toNum(v, d = 0) {
  const n = Number(v);
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
      { code: { [Op.like]: `%${q}%` } },
      { name: { [Op.like]: `%${q}%` } },
      { sku: { [Op.like]: `%${q}%` } },
      { barcode: { [Op.like]: `%${q}%` } },
      { brand: { [Op.like]: `%${q}%` } },
      { model: { [Op.like]: `%${q}%` } },
    ];
  }

  const { rows, count } = await Product.findAndCountAll({
    where,
    include: [
      { model: Category, as: "category", attributes: ["id", "name"] },
      { model: Category, as: "subcategory", attributes: ["id", "name", "parent_id"] },
    ],
    order: [["id", "DESC"]],
    limit,
    offset,
  });

  res.json({ ok: true, page, limit, total: count, items: rows });
};

exports.getOne = async (req, res) => {
  const item = await Product.findByPk(req.params.id, {
    include: [
      { model: Category, as: "category", attributes: ["id", "name"] },
      { model: Category, as: "subcategory", attributes: ["id", "name", "parent_id"] },
    ],
  });
  if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });
  res.json({ ok: true, item });
};

exports.create = async (req, res) => {
  const body = req.body || {};
  if (!body.sku || !body.name) {
    return res
      .status(400)
      .json({ ok: false, code: "VALIDATION", message: "sku y name son obligatorios" });
  }

  // compat: si te mandan price, lo usamos como list_price y viceversa
  const list_price = body.list_price ?? body.price ?? 0;
  const price = body.price ?? body.list_price ?? 0;

  const item = await Product.create({
    // base
    code: body.code || null,
    sku: body.sku,
    barcode: body.barcode || null,
    name: body.name,
    description: body.description || null,

    // rubro/subrubro
    category_id: body.category_id || null,
    subcategory_id: body.subcategory_id || null,

    brand: body.brand || null,
    model: body.model || null,
    warranty_months: body.warranty_months ?? 0,

    track_stock: body.track_stock ?? 1,
    is_active: body.is_active ?? 1,

    // flags + precios planilla
    is_new: body.is_new ?? 0,
    is_promo: body.is_promo ?? 0,

    list_price: toNum(list_price, 0),
    cash_price: toNum(body.cash_price ?? 0, 0),
    reseller_price: toNum(body.reseller_price ?? 0, 0),
    promo_price: body.promo_price === "" ? null : (body.promo_price ?? null),

    // existentes
    cost: toNum(body.cost ?? 0, 0),
    price: toNum(price, 0),
    tax_rate: body.tax_rate ?? 21,
  });

  res.status(201).json({ ok: true, item });
};

exports.update = async (req, res) => {
  const item = await Product.findByPk(req.params.id);
  if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

  const body = req.body || {};

  const nextList = body.list_price ?? body.price ?? item.list_price ?? item.price ?? 0;
  const nextPrice = body.price ?? body.list_price ?? item.price ?? item.list_price ?? 0;

  await item.update({
    code: body.code ?? item.code,
    sku: body.sku ?? item.sku,
    barcode: body.barcode ?? item.barcode,
    name: body.name ?? item.name,
    description: body.description ?? item.description,

    category_id: body.category_id ?? item.category_id,
    subcategory_id: body.subcategory_id ?? item.subcategory_id,

    brand: body.brand ?? item.brand,
    model: body.model ?? item.model,

    warranty_months: body.warranty_months ?? item.warranty_months,
    track_stock: body.track_stock ?? item.track_stock,
    is_active: body.is_active ?? item.is_active,

    is_new: body.is_new ?? item.is_new,
    is_promo: body.is_promo ?? item.is_promo,

    list_price: toNum(nextList, 0),
    cash_price: toNum(body.cash_price ?? item.cash_price ?? 0, 0),
    reseller_price: toNum(body.reseller_price ?? item.reseller_price ?? 0, 0),
    promo_price: body.promo_price === "" ? null : (body.promo_price ?? item.promo_price ?? null),

    cost: toNum(body.cost ?? item.cost ?? 0, 0),
    price: toNum(nextPrice, 0),
    tax_rate: body.tax_rate ?? item.tax_rate,
  });

  res.json({ ok: true, item });
};
