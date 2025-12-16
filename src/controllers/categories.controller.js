// src/controllers/categories.controller.js
const { Category } = require("../models");

exports.list = async (req, res) => {
  const items = await Category.findAll({
    order: [["name", "ASC"]],
  });

  res.json({ ok: true, items });
};

exports.getOne = async (req, res) => {
  const item = await Category.findByPk(req.params.id);
  if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });
  res.json({ ok: true, item });
};

exports.create = async (req, res) => {
  const body = req.body || {};
  if (!body.name || !String(body.name).trim()) {
    return res.status(400).json({ ok: false, code: "VALIDATION", message: "name es obligatorio" });
  }

  const item = await Category.create({
    name: String(body.name).trim(),
    description: body.description || null,
    is_active: body.is_active ?? 1,
  });

  res.status(201).json({ ok: true, item });
};

exports.update = async (req, res) => {
  const item = await Category.findByPk(req.params.id);
  if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

  const body = req.body || {};
  await item.update({
    name: body.name ?? item.name,
    description: body.description ?? item.description,
    is_active: body.is_active ?? item.is_active,
  });

  res.json({ ok: true, item });
};
