const { Branch } = require("../models");

exports.list = async (req, res) => {
  const items = await Branch.findAll({ order: [["id", "DESC"]] });
  res.json({ ok: true, items });
};

exports.create = async (req, res) => {
  const body = req.body || {};
  if (!body.code || !body.name) {
    return res.status(400).json({ ok: false, code: "VALIDATION", message: "code y name son obligatorios" });
  }
  const item = await Branch.create({
    code: body.code,
    name: body.name,
    address: body.address || null,
    phone: body.phone || null,
    is_active: body.is_active ?? 1,
  });
  res.status(201).json({ ok: true, item });
};
