const { Op } = require("sequelize");
const { Subcategory, Category } = require("../models");

exports.list = async (req, res) => {
  const q = (req.query.q || "").trim();
  const category_id = req.query.category_id ? Number(req.query.category_id) : null;

  const where = {};
  if (category_id) where.category_id = category_id;
  if (q) where.name = { [Op.like]: `%${q}%` };

  const items = await Subcategory.findAll({
    where,
    include: [{ model: Category, as: "category", attributes: ["id", "name"] }],
    order: [["name", "ASC"]],
  });

  res.json({ ok: true, items });
};

exports.getOne = async (req, res) => {
  const item = await Subcategory.findByPk(req.params.id, {
    include: [{ model: Category, as: "category", attributes: ["id", "name"] }],
  });
  if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });
  res.json({ ok: true, item });
};

exports.create = async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const category_id = Number(body.category_id || 0);

  if (!category_id) {
    return res.status(400).json({ ok: false, code: "VALIDATION", message: "category_id es obligatorio" });
  }
  if (!name) {
    return res.status(400).json({ ok: false, code: "VALIDATION", message: "name es obligatorio" });
  }

  const item = await Subcategory.create({
    category_id,
    name,
    description: body.description || null,
    is_active: body.is_active ?? 1,
  });

  res.status(201).json({ ok: true, item });
};

exports.update = async (req, res) => {
  const item = await Subcategory.findByPk(req.params.id);
  if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

  const body = req.body || {};
  await item.update({
    category_id: body.category_id ?? item.category_id,
    name: body.name ?? item.name,
    description: body.description ?? item.description,
    is_active: body.is_active ?? item.is_active,
  });

  res.json({ ok: true, item });
};
