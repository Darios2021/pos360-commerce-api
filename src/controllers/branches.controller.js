// src/controllers/branches.controller.js
const { Branch } = require("../models");

exports.list = async (req, res) => {
  try {
    const items = await Branch.findAll({
      attributes: ["id", "code", "name", "is_active"],
      order: [["id", "DESC"]],
    });

    return res.json({ ok: true, data: items });
  } catch (e) {
    console.error("❌ branches.list error:", e);
    return res.status(500).json({
      ok: false,
      code: "BRANCH_LIST_FAILED",
      message: e?.message || "BRANCH_LIST_FAILED",
    });
  }
};

exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.code || !body.name) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "code y name son obligatorios",
      });
    }

    const item = await Branch.create({
      code: body.code,
      name: body.name,
      address: body.address || null,
      phone: body.phone || null,
      is_active: body.is_active ?? 1,
    });

    return res.status(201).json({ ok: true, data: item });
  } catch (e) {
    console.error("❌ branches.create error:", e);
    return res.status(500).json({
      ok: false,
      code: "BRANCH_CREATE_FAILED",
      message: e?.message || "BRANCH_CREATE_FAILED",
    });
  }
};
