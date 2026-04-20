// src/controllers/branches.controller.js
// ✅ COPY-PASTE FINAL (RBAC + user_branches)
// - GET /branches:
//    - admin/super_admin => todas
//    - usuario normal => solo las permitidas (user_branches) y activas
// - POST /branches: solo admin

const { Branch, sequelize } = require("../models");

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

exports.list = async (req, res) => {
  try {
    const admin = isAdminReq(req);
    const userId = toInt(req.user?.id || req.user?.sub, 0);

    // ✅ Admin: como estaba (todas)
    if (admin) {
      const items = await Branch.findAll({
        attributes: ["id", "code", "name", "is_active"],
        order: [["id", "DESC"]],
      });
      return res.json({ ok: true, data: items });
    }

    // ✅ No admin: devuelve todas las sucursales activas
    // Los usuarios con sucursal necesitan ver todos los destinos posibles (para derivaciones, etc.)
    if (!userId) {
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "No user in token" });
    }

    const items = await Branch.findAll({
      attributes: ["id", "code", "name", "is_active"],
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

exports.create = async (req, res) => {
  try {
    // 🔒 Solo admin
    if (!isAdminReq(req)) {
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "No tenés permisos para crear sucursales.",
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

    // OJO: tu tabla branches (según SHOW CREATE) solo tiene:
    // id, name, code, address, city, is_active, created_at, updated_at
    // Así que NO metemos phone (en tu código original estaba y te puede romper).
    const item = await Branch.create({
      code: body.code,
      name: body.name,
      address: body.address || null,
      city: body.city || null,
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
