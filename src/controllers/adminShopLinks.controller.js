// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/adminShopLinks.controller.js

const { Op } = require("sequelize");
const { ShopLink } = require("../models");

// ------------------
// Helpers
// ------------------
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function isAdminReq(req) {
  // Soportar varios formatos de auth context (por tus middlewares)
  const u = req.usuario || req.user || req.auth || {};
  const roles = Array.isArray(u?.roles) ? u.roles : Array.isArray(req.roles) ? req.roles : [];
  const access = req.access || req.accessContext || {};
  return (
    access?.isAdmin === true ||
    roles.includes("admin") ||
    roles.includes("super_admin") ||
    u?.is_admin === 1 ||
    u?.is_admin === true
  );
}

function normalizeUrl(u) {
  let s = String(u || "").trim();
  if (!s) return "";
  try {
    const url = new URL(s);
    url.search = "";
    url.hash = "";
    s = url.toString();
  } catch {
    // ok
  }
  return s;
}

function mustAdmin(req, res) {
  if (!isAdminReq(req)) {
    res.status(403).json({ ok: false, error: "Forbidden (admin only)" });
    return false;
  }
  return true;
}

// ------------------
// GET /admin/shop-links
// query: kind, q, page, limit
// ------------------
async function list(req, res) {
  try {
    if (!mustAdmin(req, res)) return;

    const kind = String(req.query.kind || "").trim();
    const q = String(req.query.q || "").trim();

    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
    const offset = (page - 1) * limit;

    const where = {};
    if (kind) where.kind = kind;

    if (q) {
      where[Op.or] = [
        { title: { [Op.like]: `%${q}%` } },
        { subtitle: { [Op.like]: `%${q}%` } },
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
    console.error("❌ adminShopLinks.list", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}

// ------------------
// POST /admin/shop-links
// body: kind, title, subtitle, url, sort_order, is_active
// ------------------
async function create(req, res) {
  try {
    if (!mustAdmin(req, res)) return;

    const kind = String(req.body?.kind || "").trim();
    const title = String(req.body?.title || "").trim();
    const subtitle = String(req.body?.subtitle || "").trim();
    const url = normalizeUrl(req.body?.url);
    const sort_order = toInt(req.body?.sort_order, 0);
    const is_active = req.body?.is_active === 0 || req.body?.is_active === false ? false : true;

    if (!kind) return res.status(400).json({ ok: false, error: "Missing kind" });
    if (!url) return res.status(400).json({ ok: false, error: "Missing url" });

    const row = await ShopLink.create({
      kind,
      title: title || null,
      subtitle: subtitle || null,
      url,
      sort_order,
      is_active,
    });

    return res.json({ ok: true, item: row });
  } catch (err) {
    console.error("❌ adminShopLinks.create", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}

// ------------------
// PATCH /admin/shop-links/:id
// body: partial fields
// ------------------
async function patch(req, res) {
  try {
    if (!mustAdmin(req, res)) return;

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: "Invalid id" });

    const row = await ShopLink.findByPk(id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const payload = {};

    if (req.body?.kind != null) payload.kind = String(req.body.kind || "").trim();
    if (req.body?.title != null) payload.title = String(req.body.title || "").trim() || null;
    if (req.body?.subtitle != null) payload.subtitle = String(req.body.subtitle || "").trim() || null;

    if (req.body?.url != null) payload.url = normalizeUrl(req.body.url);
    if (req.body?.sort_order != null) payload.sort_order = toInt(req.body.sort_order, row.sort_order || 0);

    if (req.body?.is_active != null) {
      payload.is_active = req.body.is_active === 1 || req.body.is_active === true;
    }

    // Validaciones mínimas
    if (payload.kind === "") return res.status(400).json({ ok: false, error: "kind vacío" });
    if (payload.url === "") return res.status(400).json({ ok: false, error: "url vacía" });

    await row.update(payload);

    return res.json({ ok: true, item: row });
  } catch (err) {
    console.error("❌ adminShopLinks.patch", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}

// ------------------
// DELETE /admin/shop-links/:id
// ------------------
async function remove(req, res) {
  try {
    if (!mustAdmin(req, res)) return;

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: "Invalid id" });

    const row = await ShopLink.findByPk(id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    await row.destroy();
    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ adminShopLinks.remove", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}

module.exports = { list, create, patch, remove };
