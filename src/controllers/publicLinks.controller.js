// src/controllers/publicLinks.controller.js
// ✅ COPY-PASTE FINAL COMPLETO

const { Op } = require("sequelize");
const { ShopLink } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

async function listPublic(req, res) {
  try {
    if (!ShopLink) {
      return res.status(500).json({ ok: false, error: "ShopLink model no cargado" });
    }

    const kind = String(req.query.kind || "").trim();
    const limit = Math.min(Math.max(toInt(req.query.limit, 12), 1), 50);

    const where = { is_active: 1 };
    if (kind) where.kind = kind;

    const rows = await ShopLink.findAll({
      where,
      order: [
        ["sort_order", "ASC"],
        ["id", "ASC"],
      ],
      limit,
      attributes: ["id", "kind", "title", "subtitle", "url", "sort_order"],
    });

    return res.json({ ok: true, items: rows });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "No se pudo listar links",
    });
  }
}

module.exports = { listPublic };
