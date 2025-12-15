const { Warehouse, Branch } = require("../models");

exports.list = async (req, res) => {
  const branch_id = req.query.branch_id ? Number(req.query.branch_id) : null;
  const where = {};
  if (branch_id) where.branch_id = branch_id;

  const items = await Warehouse.findAll({
    where,
    include: [{ model: Branch, as: "branch", attributes: ["id", "code", "name"] }],
    order: [["id", "DESC"]],
  });

  res.json({ ok: true, items });
};

exports.create = async (req, res) => {
  const body = req.body || {};
  if (!body.branch_id || !body.code || !body.name) {
    return res.status(400).json({ ok: false, code: "VALIDATION", message: "branch_id, code y name son obligatorios" });
  }

  const item = await Warehouse.create({
    branch_id: Number(body.branch_id),
    code: body.code,
    name: body.name,
    is_active: body.is_active ?? 1,
  });

  res.status(201).json({ ok: true, item });
};
