// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/adminShopLinks.controller.js

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

function normalizeUrl(u) {
  let s = String(u ?? "").trim();
  if (!s) return "";
  try {
    const url = new URL(s);
    url.hash = "";
    // opcional: limpiar utm
    url.searchParams.delete("utm_source");
    url.searchParams.delete("utm_medium");
    url.searchParams.delete("utm_campaign");
    url.searchParams.delete("igsh");
    // si querés volar TODO query:
    // url.search = "";
    s = url.toString();
  } catch {
    // ok
  }
  return s;
}

async function list(req, res) {
  try {
    if (!ShopLink) return res.status(500).json({ ok: false, error: "ShopLink model no cargado" });

    const kind = cleanStr(req.query.kind);
    const q = cleanStr(req.query.q);
    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
    const offset = (page - 1) * limit;

    const where = {};
    if (kind) where.kind = kind;
    if (q) {
      where[Op.or] = [
        { label: { [Op.like]: `%${q}%` } },
        { url: { [Op.like]: `%${q}%` } },
      ];
    }

    const { rows, count } = await ShopLink.findAndCountAll({
      where,
      order: [
        ["sort_order", "ASC"],
        ["id", "ASC"],
      ],
      limit,
      offset,
    });

    return res.json({
      ok: true,
      page,
      limit,
      total: count,
      items: rows,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Error listando links" });
  }
}

async function create(req, res) {
  try {
    if (!ShopLink) return res.status(500).json({ ok: false, error: "ShopLink model no cargado" });

    const kind = cleanStr(req.body.kind);
    const label = cleanStr(req.body.label);
    const url = normalizeUrl(req.body.url);
    const sort_order = toInt(req.body.sort_order, 0);
    const is_active = req.body.is_active === 0 || req.body.is_active === false ? 0 : 1;

    if (!kind) return res.status(400).json({ ok: false, error: "Falta kind" });
    if (!url) return res.status(400).json({ ok: false, error: "Falta url" });

    const row = await ShopLink.create({
      kind,
      label,
      url,
      sort_order,
      is_active,
    });

    return res.json({ ok: true, item: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Error creando link" });
  }
}

async function update(req, res) {
  try {
    if (!ShopLink) return res.status(500).json({ ok: false, error: "ShopLink model no cargado" });

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const row = await ShopLink.findByPk(id);
    if (!row) return res.status(404).json({ ok: false, error: "No existe" });

    const patch = {};
    if (req.body.kind != null) patch.kind = cleanStr(req.body.kind) || row.kind;
    if (req.body.label != null) patch.label = cleanStr(req.body.label);
    if (req.body.url != null) patch.url = normalizeUrl(req.body.url) || row.url;
    if (req.body.sort_order != null) patch.sort_order = toInt(req.body.sort_order, row.sort_order);
    if (req.body.is_active != null) patch.is_active = req.body.is_active ? 1 : 0;

    await row.update(patch);

    return res.json({ ok: true, item: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Error actualizando link" });
  }
}

async function remove(req, res) {
  try {
    if (!ShopLink) return res.status(500).json({ ok: false, error: "ShopLink model no cargado" });

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const row = await ShopLink.findByPk(id);
    if (!row) return res.status(404).json({ ok: false, error: "No existe" });

    await row.destroy();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Error borrando link" });
  }
}

module.exports = { list, create, update, remove };
