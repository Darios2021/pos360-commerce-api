const { Op } = require("sequelize");
const { Category } = require("../models");

exports.list = async (req, res) => {
  const q = (req.query.q || "").trim();

  const where = {};
  if (q) where.name = { [Op.like]: `%${q}%` };

  const items = await Category.findAll({
    where,
    order: [["name", "ASC"]],
  });

  res.json({ ok: true, items });
};
