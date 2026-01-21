// ✅ COPY-PASTE FINAL COMPLETO
// src/routes/publicLinks.routes.js

const router = require("express").Router();
const { Op } = require("sequelize");
const { ShopLink } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function cleanStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

// GET /api/v1/public/links?kind=INSTAGRAM_POST&limit=10
router.get("/links", async (req, res) => {
  try {
    if (!ShopLink) return res.status(500).json({ ok: false, error: "ShopLink model no cargado" });

    const kind = cleanStr(req.query.kind);
    const q = cleanStr(req.query.q);
    const limit = Math.min(Math.max(toInt(req.query.limit, 10), 1), 50);

    const where = { is_active: 1 };
    if (kind) where.kind = kind;
    if (q) {
      where[Op.or] = [
        { label: { [Op.like]: `%${q}%` } },
        { url: { [Op.like]: `%${q}%` } },
      ];
    }

    const rows = await ShopLink.findAll({
      where,
      order: [
        ["sort_order", "ASC"],
        ["id", "ASC"],
      ],
      limit,
    });

    return res.json({ ok: true, items: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Error public links" });
  }
});

module.exports = router;
