// src/controllers/branches.controller.js
// ✅ COPY-PASTE FINAL (CRUD + RBAC + campos geo)
// - GET /branches             → admin/super_admin: todas | user normal: activas
// - POST /branches            → solo super_admin
// - PUT/PATCH /branches/:id   → solo super_admin
// - DELETE /branches/:id      → solo super_admin (soft delete: is_active=0)

const { Branch } = require("../models");
const access = require("../utils/accessScope");

// Campos completos que devolvemos siempre (admin y user normal)
const BRANCH_ATTRIBUTES = [
  "id",
  "code",
  "name",
  "address",
  "city",
  "province",
  "latitude",
  "longitude",
  "phone",
  "hours",
  "maps_url",
  "is_active",
  "created_at",
  "updated_at",
];

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function normalizeRoles(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((r) => {
        if (!r) return null;
        if (typeof r === "string") return r.toLowerCase().trim();
        if (typeof r === "object" && r.name) return String(r.name).toLowerCase().trim();
        return null;
      })
      .filter(Boolean);
  }
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminReq(req) {
  const u = req?.user || {};
  if (u?.is_admin === true || u?.isAdmin === true || u?.admin === true) return true;
  const roles = normalizeRoles(u.roles || u.role || u.user_role);
  return roles.some((r) => ["admin", "super_admin", "superadmin", "root", "owner"].includes(r));
}

function toFloatOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickBranchPayload(body = {}) {
  return {
    code: body.code ?? undefined,
    name: body.name ?? undefined,
    address: body.address === "" ? null : body.address,
    city: body.city === "" ? null : body.city,
    province: body.province === "" ? null : body.province,
    latitude: toFloatOrNull(body.latitude ?? body.lat),
    longitude: toFloatOrNull(body.longitude ?? body.lng),
    phone: body.phone === "" ? null : body.phone,
    hours: body.hours === "" ? null : body.hours,
    maps_url: body.maps_url === "" ? null : body.maps_url,
    is_active:
      body.is_active === undefined || body.is_active === null
        ? undefined
        : body.is_active === true || body.is_active === 1 || body.is_active === "1"
        ? 1
        : 0,
  };
}

// =========================
// LIST
// =========================
exports.list = async (req, res) => {
  try {
    const admin = isAdminReq(req);
    const userId = toInt(req.user?.id || req.user?.sub, 0);

    if (admin) {
      const items = await Branch.findAll({
        attributes: BRANCH_ATTRIBUTES,
        order: [["id", "DESC"]],
      });
      return res.json({ ok: true, data: items });
    }

    if (!userId) {
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "No user in token" });
    }

    const items = await Branch.findAll({
      attributes: BRANCH_ATTRIBUTES,
      where: { is_active: true },
      order: [["id", "ASC"]],
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

// =========================
// CREATE
// =========================
exports.create = async (req, res) => {
  try {
    if (!access.isSuperAdmin(req)) {
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "Solo un super administrador puede crear sucursales.",
      });
    }

    const body = req.body || {};
    if (!body.code || !body.name) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "code y name son obligatorios",
      });
    }

    const payload = pickBranchPayload(body);
    if (payload.is_active === undefined) payload.is_active = 1;

    const item = await Branch.create(payload);
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

// =========================
// UPDATE
// =========================
exports.update = async (req, res) => {
  try {
    if (!access.isSuperAdmin(req)) {
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "Solo un super administrador puede editar sucursales.",
      });
    }

    const id = toInt(req.params.id, 0);
    if (!id) {
      return res.status(400).json({ ok: false, code: "VALIDATION", message: "id inválido" });
    }

    const item = await Branch.findByPk(id);
    if (!item) {
      return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Sucursal no encontrada" });
    }

    const payload = pickBranchPayload(req.body || {});
    // Filtrar undefineds para no pisar con null lo que no vino en el body
    const clean = {};
    for (const k of Object.keys(payload)) {
      if (payload[k] !== undefined) clean[k] = payload[k];
    }

    if (Object.prototype.hasOwnProperty.call(clean, "code") && !clean.code) {
      return res.status(400).json({ ok: false, code: "VALIDATION", message: "code es obligatorio" });
    }
    if (Object.prototype.hasOwnProperty.call(clean, "name") && !clean.name) {
      return res.status(400).json({ ok: false, code: "VALIDATION", message: "name es obligatorio" });
    }

    await item.update(clean);
    await item.reload();
    return res.json({ ok: true, data: item });
  } catch (e) {
    console.error("❌ branches.update error:", e);
    return res.status(500).json({
      ok: false,
      code: "BRANCH_UPDATE_FAILED",
      message: e?.message || "BRANCH_UPDATE_FAILED",
    });
  }
};

// =========================
// REMOVE (soft delete)
// =========================
exports.remove = async (req, res) => {
  try {
    if (!access.isSuperAdmin(req)) {
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "Solo un super administrador puede dar de baja sucursales.",
      });
    }

    const id = toInt(req.params.id, 0);
    if (!id) {
      return res.status(400).json({ ok: false, code: "VALIDATION", message: "id inválido" });
    }

    const item = await Branch.findByPk(id);
    if (!item) {
      return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Sucursal no encontrada" });
    }

    await item.update({ is_active: 0 });
    return res.json({ ok: true, data: { id, is_active: 0 } });
  } catch (e) {
    console.error("❌ branches.remove error:", e);
    return res.status(500).json({
      ok: false,
      code: "BRANCH_REMOVE_FAILED",
      message: e?.message || "BRANCH_REMOVE_FAILED",
    });
  }
};
