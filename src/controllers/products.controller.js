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
      as: "images",
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

    const { rows, count } = await Product.findAndCountAll({
      where: q ? { name: { [Op.like]: `%${q}%` } } : {},
      include: includeCategoryTree(),
      order: [["id", "DESC"]],
      limit,
      offset,
    });
    res.json({ ok: true, page, limit, total: count, items: rows });
  } catch (e) { next(e); }
}

async function getOne(req, res, next) {
  try {
    console.log(`[GET] Consultando producto ID: ${req.params.id}`);
    const item = await Product.findByPk(req.params.id, { include: includeCategoryTree() });
    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });
    res.json({ ok: true, item });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const body = req.body;
    const created = await Product.create(body);
    console.log(`[POST] Producto creado: ${created.id}`);
    const item = await Product.findByPk(created.id, { include: includeCategoryTree() });
    res.status(201).json({ ok: true, item });
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const item = await Product.findByPk(req.params.id);
    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });
    
    await item.update(req.body);
    console.log(`[PATCH] Producto ${req.params.id} actualizado en DB`);
    
    const full = await Product.findByPk(item.id, { include: includeCategoryTree() });
    res.json({ ok: true, item: full });
  } catch (e) { next(e); }
}

module.exports = { list, getOne, create, update };