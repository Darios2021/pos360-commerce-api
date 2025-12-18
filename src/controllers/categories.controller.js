// src/controllers/categories.controller.js
const { Category } = require("../models");

exports.list = async (req, res, next) => {
  try {
    const items = await Category.findAll({
      where: { is_active: 1 },
      attributes: ["id", "name", "parent_id", "is_active"],
      order: [
        ["parent_id", "ASC"],
        ["name", "ASC"],
      ],
    });

    res.json({ ok: true, items });
  } catch (e) {
    next(e);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const item = await Category.findByPk(req.params.id, {
      attributes: ["id", "name", "parent_id", "is_active"],
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
    const name = String(body.name || "").trim();

    if (!name) {
      return res
        .status(400)
        .json({ ok: false, code: "VALIDATION", message: "name es obligatorio" });
    }

    const item = await Category.create({
      name,
      parent_id: body.parent_id ?? null,
      is_active: body.is_active ?? 1,
    });

    res.status(201).json({ ok: true, item });
  } catch (e) {
    next(e);
  }
};

exports.update = async (req, res, next) => {
  try {
    const item = await Category.findByPk(req.params.id);
    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const body = req.body || {};
    await item.update({
      name: body.name ?? item.name,
      parent_id: body.parent_id ?? item.parent_id,
      is_active: body.is_active ?? item.is_active,
    });

    res.json({ ok: true, item });
  } catch (e) {
    next(e);
  }
};
