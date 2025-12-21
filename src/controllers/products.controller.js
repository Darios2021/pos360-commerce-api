const { Op } = require("sequelize");
const { Product, Category, ProductImage } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toDec(v, d = 0) {
  if (v === null || v === undefined || v === "") return d;
  const s = String(v).replace(",", ".").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : d;
}

/**
 * Helper para incluir el árbol de categorías y las imágenes
 * Basado en la asociación establecida en models/index.js
 */
function includeCategoryTree() {
  return [
    {
      model: Category,
      as: "category",
      attributes: ["id", "name", "parent_id"],
      required: false,
      include: [
        {
          model: Category,
          as: "parent",
          attributes: ["id", "name"],
          required: false,
        },
      ],
    },
    {
      model: ProductImage,
      as: "images", // Coincide con la asociación en models/index.js
      required: false,
    },
  ];
}

async function list(req, res, next) {
  try {
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
        { code: { [Op.like]: `%${q}%` } },
      ];
    }

    const { rows, count } = await Product.findAndCountAll({
      where,
      include: includeCategoryTree(),
      order: [["id", "DESC"]],
      limit,
      offset,
    });

    res.json({ ok: true, page, limit, total: count, items: rows });
  } catch (e) {
    next(e);
  }
}

async function getOne(req, res, next) {
  try {
    const item = await Product.findByPk(req.params.id, {
      include: includeCategoryTree(),
    });

    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });
    res.json({ ok: true, item });
  } catch (e) {
    next(e);
  }
}

async function create(req, res, next) {
  try {
    const body = req.body || {};
    if (!body.sku || !body.name) {
      return res.status(400).json({ ok: false, message: "sku y name son obligatorios" });
    }

    const created = await Product.create({
      code: body.code ?? null,
      sku: body.sku,
      barcode: body.barcode ?? null,
      name: body.name,
      description: body.description ?? null,
      category_id: body.category_id ? Number(body.category_id) : null,
      is_new: body.is_new ?? 0,
      is_promo: body.is_promo ?? 0,
      brand: body.brand ?? null,
      model: body.model ?? null,
      warranty_months: body.warranty_months ?? 0,
      track_stock: body.track_stock ?? 1,
      sheet_stock_label: body.sheet_stock_label ?? null,
      sheet_has_stock: body.sheet_has_stock ?? 1,
      is_active: body.is_active ?? 1,
      cost: toDec(body.cost, 0),
      price: toDec(body.price, 0),
      price_list: toDec(body.price_list, 0),
      price_discount: toDec(body.price_discount, 0),
      price_reseller: toDec(body.price_reseller, 0),
      tax_rate: toDec(body.tax_rate, 21),
    });

    const item = await Product.findByPk(created.id, { include: includeCategoryTree() });
    res.status(201).json({ ok: true, item });
  } catch (e) {
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const item = await Product.findByPk(req.params.id);
    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const body = req.body || {};
    await item.update({
      code: body.code ?? item.code,
      sku: body.sku ?? item.sku,
      barcode: body.barcode ?? item.barcode,
      name: body.name ?? item.name,
      description: body.description ?? item.description,
      category_id: body.category_id !== undefined ? (body.category_id ? Number(body.category_id) : null) : item.category_id,
      is_new: body.is_new ?? item.is_new,
      is_promo: body.is_promo ?? item.is_promo,
      brand: body.brand ?? item.brand,
      model: body.model ?? item.model,
      warranty_months: body.warranty_months ?? item.warranty_months,
      track_stock: body.track_stock ?? item.track_stock,
      is_active: body.is_active ?? item.is_active,
      cost: body.cost !== undefined ? toDec(body.cost, item.cost) : item.cost,
      price: body.price !== undefined ? toDec(body.price, item.price) : item.price,
      price_list: body.price_list !== undefined ? toDec(body.price_list, item.price_list) : item.price_list,
      price_discount: body.price_discount !== undefined ? toDec(body.price_discount, item.price_discount) : item.price_discount,
      price_reseller: body.price_reseller !== undefined ? toDec(body.price_reseller, item.price_reseller) : item.price_reseller,
      tax_rate: body.tax_rate !== undefined ? toDec(body.tax_rate, item.tax_rate) : item.tax_rate,
    });

    const full = await Product.findByPk(item.id, { include: includeCategoryTree() });
    res.json({ ok: true, item: full });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, getOne, create, update };