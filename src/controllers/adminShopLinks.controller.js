// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/adminShopLinks.controller.js
const { Op } = require("sequelize");
const { ShopLink, sequelize } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function normKind(v) {
  return String(v ?? "").trim().toUpperCase();
}

function cleanUrl(v) {
  let s = String(v ?? "").trim();
  // quitar saltos y espacios raros
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function isValidUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

// GET /api/v1/admin/shop/links?kind=INSTAGRAM_POST (si no mandás kind => todos)
async function list(req, res) {
  try {
    const kind = normKind(req.query.kind);
    const where = {};
    if (kind) where.kind = kind;

    const rows = await ShopLink.findAll({
      where,
      order: [
        ["kind", "ASC"],
        ["sort_order", "ASC"],
        ["id", "DESC"],
      ],
      limit: 500,
    });

    return res.json({
      ok: true,
      items: rows.map((x) => ({
        id: x.id,
        kind: x.kind,
        label: x.label,
        url: x.url,
        sort_order: x.sort_order,
        is_active: !!x.is_active,
      })),
    });
  } catch (e) {
    console.error("❌ adminShopLinks.list", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}

// POST /api/v1/admin/shop/links
// body: { kind, label?, url, sort_order?, is_active? }
async function create(req, res) {
  try {
    const kind = normKind(req.body?.kind);
    const label = req.body?.label != null ? String(req.body.label).trim() : null;
    const url = cleanUrl(req.body?.url);
    const sort_order = toInt(req.body?.sort_order, 0);
    const is_active = req.body?.is_active === false ? 0 : 1;

    if (!kind) return res.status(400).json({ ok: false, error: "kind requerido" });
    if (!url) return res.status(400).json({ ok: false, error: "url requerido" });
    if (!isValidUrl(url)) return res.status(400).json({ ok: false, error: "url inválida" });

    const row = await ShopLink.create({
      kind,
      label,
      url,
      sort_order,
      is_active,
    });

    return res.json({ ok: true, item: { id: row.id } });
  } catch (e) {
    console.error("❌ adminShopLinks.create", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}

// PUT /api/v1/admin/shop/links/:id
// body: { kind?, label?, url?, sort_order?, is_active? }
async function update(req, res) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: "id inválido" });

    const row = await ShopLink.findByPk(id);
    if (!row) return res.status(404).json({ ok: false, error: "No encontrado" });

    const patch = {};

    if (req.body?.kind != null) patch.kind = normKind(req.body.kind);
    if (req.body?.label !== undefined) patch.label = req.body.label != null ? String(req.body.label).trim() : null;

    if (req.body?.url != null) {
      const url = cleanUrl(req.body.url);
      if (!url) return res.status(400).json({ ok: false, error: "url vacío" });
      if (!isValidUrl(url)) return res.status(400).json({ ok: false, error: "url inválida" });
      patch.url = url;
    }

    if (req.body?.sort_order != null) patch.sort_order = toInt(req.body.sort_order, row.sort_order);
    if (req.body?.is_active != null) patch.is_active = req.body.is_active ? 1 : 0;

    await row.update(patch);

    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ adminShopLinks.update", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}

// DELETE /api/v1/admin/shop/links/:id
async function remove(req, res) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: "id inválido" });

    const row = await ShopLink.findByPk(id);
    if (!row) return res.status(404).json({ ok: false, error: "No encontrado" });

    await row.destroy();
    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ adminShopLinks.remove", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}

// POST /api/v1/admin/shop/links/reorder
// body: { kind: "INSTAGRAM_POST", ids: [5,9,2,...] }
async function reorder(req, res) {
  const t = await sequelize.transaction();
  try {
    const kind = normKind(req.body?.kind);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => toInt(x, 0)).filter((n) => n > 0) : [];

    if (!kind) return res.status(400).json({ ok: false, error: "kind requerido" });
    if (!ids.length) return res.status(400).json({ ok: false, error: "ids requerido (array)" });

    // Traigo solo los de ese kind para validar pertenencia
    const rows = await ShopLink.findAll({
      where: { kind, id: { [Op.in]: ids } },
      transaction: t,
    });

    const found = new Set(rows.map((r) => Number(r.id)));
    const missing = ids.filter((id) => !found.has(Number(id)));
    if (missing.length) {
      await t.rollback();
      return res.status(400).json({ ok: false, error: `ids no encontrados para kind=${kind}`, missing });
    }

    // Aplico sort_order según posición
    let i = 0;
    for (const id of ids) {
      await ShopLink.update(
        { sort_order: i++ },
        { where: { id, kind }, transaction: t }
      );
    }

    await t.commit();
    return res.json({ ok: true });
  } catch (e) {
    try { await t.rollback(); } catch {}
    console.error("❌ adminShopLinks.reorder", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}

module.exports = { list, create, update, remove, reorder };
