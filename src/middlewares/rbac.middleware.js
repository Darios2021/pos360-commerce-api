// src/middlewares/rbac.middleware.js
const { sequelize } = require("../models");
const { QueryTypes } = require("sequelize");

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function pickUserId(req) {
  // JWT payload: { sub, ... }
  const uid = Number(req?.user?.sub || req?.user?.id || 0);
  return Number.isFinite(uid) && uid > 0 ? uid : 0;
}

async function loadRoleNames(userId) {
  const rows = await sequelize.query(
    `
    SELECT r.name
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = ?
    `,
    { replacements: [userId], type: QueryTypes.SELECT }
  );

  return rows.map((r) => norm(r.name)).filter(Boolean);
}

async function loadPermissionCodes(userId) {
  const rows = await sequelize.query(
    `
    SELECT DISTINCT p.code
    FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ?
    `,
    { replacements: [userId], type: QueryTypes.SELECT }
  );

  return rows.map((r) => norm(r.code)).filter(Boolean);
}

async function loadBranchIds(userId) {
  const rows = await sequelize.query(
    `SELECT branch_id FROM user_branches WHERE user_id = ?`,
    { replacements: [userId], type: QueryTypes.SELECT }
  );

  return rows
    .map((r) => Number(r.branch_id))
    .filter((n) => Number.isFinite(n) && n > 0);
}

// ✅ Adjunta contexto de acceso al request (no rompe nada)
async function attachAccessContext(req, res, next) {
  try {
    const uid = pickUserId(req);
    if (!uid) return res.status(401).json({ ok: false, code: "NO_AUTH" });

    if (!req.access) req.access = {};

    // Cache por request
    if (!Array.isArray(req.access.roles)) req.access.roles = await loadRoleNames(uid);
    if (!Array.isArray(req.access.permissions)) req.access.permissions = await loadPermissionCodes(uid);
    if (!Array.isArray(req.access.branch_ids)) req.access.branch_ids = await loadBranchIds(uid);

    req.access.is_super_admin = req.access.roles.includes("super_admin");

    return next();
  } catch (e) {
    return res.status(500).json({
      ok: false,
      code: "ACCESS_CONTEXT_FAILED",
      message: e?.message || "access context failed",
    });
  }
}

// ✅ Gate por permiso
function requirePermission(code) {
  const need = norm(code);
  return async (req, res, next) => {
    await attachAccessContext(req, res, () => {
      if (req.access?.is_super_admin) return next();
      const perms = req.access?.permissions || [];
      if (perms.includes(need)) return next();
      return res.status(403).json({ ok: false, code: "FORBIDDEN_PERMISSION", missing: need });
    });
  };
}

module.exports = { attachAccessContext, requirePermission };
