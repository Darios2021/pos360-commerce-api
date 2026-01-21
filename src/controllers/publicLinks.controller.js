// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/publicLinks.controller.js
const { Op } = require("sequelize");
const { ShopLink } = require("../models");

function normKind(v) {
  const s = String(v ?? "").trim().toUpperCase();
  return s;
}

// GET /api/v1/public/links?kind=INSTAGRAM_POST
async function list(req, res) {
  try {
    const kind = normKind(req.query.kind);
    if (!kind) {
      return res.status(400).json({ ok: false, error: "Missing kind. Ej: ?kind=INSTAGRAM_POST" });
    }

    const items = await ShopLink.findAll({
      where: {
        kind,
        is_active: 1,
        url: { [Op.ne]: "" },
      },
      order: [
        ["sort_order", "ASC"],
        ["id", "DESC"],
      ],
      limit: 200,
    });

    return res.json({
      ok: true,
      kind,
      items: items.map((x) => ({
        id: x.id,
        kind: x.kind,
        label: x.label,
        url: x.url,
        sort_order: x.sort_order,
      })),
    });
  } catch (e) {
    console.error("❌ publicLinks.list", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}

module.exports = { list };
