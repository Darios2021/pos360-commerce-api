// src/controllers/products.controller.js
const { Op } = require("sequelize");
const { Product, Category } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toDec(v, d = 0) {
  // acepta "123", "123.45", "123,45"
  if (v === null || v === undefined || v === "") return d;
  const s = String(v).replace(",", ".").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : d;
}

exports.list = async (req, res, next) => {
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
        { sub_rubro: { [Op.like]: `%${q}%` } },
      ];
    }

    const { rows, count } = await Product.findAndCountAll({
      where,
      include: [
        {
          model: Category,
          as: "category", // ✅ ESTE ES EL ALIAS REAL DEFINIDO EN models/index.js
          attributes: ["id", "name"],
          required: false,
        },
      ],
      order: [["id", "DESC"]],
      limit,
      offset,
    });

    res.json({ ok: true, page, limit, total: count, items: rows });
  } catch (e) {
    next(e);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const item = await Product.findByPk(req.params.id, {
      include: [
        { model: Category, as: "category", attributes: ["id", "name"], required: false },
      ],
    });

    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });
    res.json({ ok: true, item });
  } catch (e) {
    next(e);
  }
};

exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};

    if (!body.sku || !body.name) {
      return res
        .status(400)
        .json({ ok: false, code: "VALIDATION", message: "sku y name son obligatorios" });
    }

    const item = await Product.create({
      // base
      code: body.code ?? null,
      sku: body.sku,
      barcode: body.barcode ?? null,
      name: body.name,
      description: body.description ?? null,

      // rubro/subrubro
      category_id: body.category_id ? Number(body.category_id) : null,
      sub_rubro: body.sub_rubro ?? null,

      // flags
      is_new: body.is_new ?? 0,
      is_promo: body.is_promo ?? 0,

      // marca/modelo
      brand: body.brand ?? null,
      model: body.model ?? null,
      warranty_months: body.warranty_months ?? 0,

      // stock
      track_stock: body.track_stock ?? 1,
      sheet_stock_label: body.sheet_stock_label ?? null,
      sheet_has_stock: body.sheet_has_stock ?? 1,

      is_active: body.is_active ?? 1,

      // precios
      cost: toDec(body.cost, 0),
      price: toDec(body.price, 0), // compat
      price_list: toDec(body.price_list, 0),
      price_discount: toDec(body.price_discount, 0),
      price_reseller: toDec(body.price_reseller, 0),

      tax_rate: toDec(body.tax_rate, 21),
    });

    res.status(201).json({ ok: true, item });
  } catch (e) {
    next(e);
  }
};

exports.update = async (req, res, next) => {
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
      sub_rubro: body.sub_rubro ?? item.sub_rubro,

      is_new: body.is_new ?? item.is_new,
      is_promo: body.is_promo ?? item.is_promo,

      brand: body.brand ?? item.brand,
      model: body.model ?? item.model,
      warranty_months: body.warranty_months ?? item.warranty_months,

      track_stock: body.track_stock ?? item.track_stock,
      sheet_stock_label: body.sheet_stock_label ?? item.sheet_stock_label,
      sheet_has_stock: body.sheet_has_stock ?? item.sheet_has_stock,

      is_active: body.is_active ?? item.is_active,

      cost: body.cost !== undefined ? toDec(body.cost, item.cost) : item.cost,
      price: body.price !== undefined ? toDec(body.price, item.price) : item.price,
      price_list: body.price_list !== undefined ? toDec(body.price_list, item.price_list) : item.price_list,
      price_discount: body.price_discount !== undefined ? toDec(body.price_discount, item.price_discount) : item.price_discount,
      price_reseller: body.price_reseller !== undefined ? toDec(body.price_reseller, item.price_reseller) : item.price_reseller,

      tax_rate: body.tax_rate !== undefined ? toDec(body.tax_rate, item.tax_rate) : item.tax_rate,
    });

    res.json({ ok: true, item });
  } catch (e) {
    next(e);
  }
};
