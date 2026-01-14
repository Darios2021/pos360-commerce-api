// src/middlewares/rbac.middleware.js
const { User, Role, Branch, Permission, RolePermission } = require("../models");

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function normRoleName(x) {
  return String(x || "").trim().toLowerCase();
}

function rolesFromToken(req) {
  const u = req.user || {};
  // puede venir: roles: ["admin"] o roles: [{name:"admin"}] o role: "admin"
  const roles = [];

  if (Array.isArray(u.roles)) {
    for (const r of u.roles) {
      if (!r) continue;
      if (typeof r === "string") roles.push(r);
      else if (typeof r === "object") roles.push(r.name || r.code || r.role);
    }
  } else if (typeof u.roles === "string") {
    roles.push(...u.roles.split(/[,\s|]+/g));
  }

  if (typeof u.role === "string") roles.push(u.role);

  return uniq(roles.map(normRoleName));
}

function branchIdsFromToken(req) {
  const u = req.user || {};
  // tu JWT pone: branches: [1,3,4] (ids)
  if (Array.isArray(u.branches)) {
    return uniq(u.branches.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0));
  }
  return [];
}

async function fetchRolesFromDB(userId) {
  const u = await User.findByPk(userId, {
    attributes: ["id"],
    include: [{ model: Role, as: "roles", through: { attributes: [] }, required: false }],
  });
  return uniq((u?.roles || []).map((r) => normRoleName(r?.name)));
}

async function fetchBranchIdsFromDB(userId) {
  const u = await User.findByPk(userId, {
    attributes: ["id"],
    include: [{ model: Branch, as: "branches", through: { attributes: [] }, required: false }],
  });
  return uniq((u?.branches || []).map((b) => Number(b?.id)).filter((n) => Number.isFinite(n) && n > 0));
}

async function fetchPermissionsFromDB(roleIdsOrNames) {
  // role_permissions usa role_id (ids), pero acá normalmente tenemos nombres.
  // Preferimos pedir IDs con un query extra SOLO si hace falta.
  // Para no romper: si RolePermission no existe, devolvemos [].
  if (!RolePermission) return [];

  // 1) Buscar IDs de roles por nombre
  const roleNames = uniq((roleIdsOrNames || []).map(normRoleName)).filter(Boolean);
  if (!roleNames.length) return [];

  const roles = await Role.findAll({
    where: { name: roleNames },
    attributes: ["id", "name"],
  });

  const roleIds = roles.map((r) => r.id).filter(Boolean);
  if (!roleIds.length) return [];

  // 2) role_permissions -> permission_id
  const rps = await RolePermission.findAll({ where: { role_id: roleIds } });
  const permIds = uniq((rps || []).map((x) => x.permission_id)).filter(Boolean);
  if (!permIds.length) return [];

  // 3) permissions
  const perms = await Permission.findAll({ where: { id: permIds }, attributes: ["code"] });
  return uniq((perms || []).map((p) => String(p.code || "").trim()).filter(Boolean));
}

/**
 * ✅ attachAccessContext
 * - Usa token si ya trae roles/branches.
 * - Si faltan, cae a DB.
 * - Carga permisos por role_permissions (si no es super_admin).
 */
async function attachAccessContext(req, res, next) {
  try {
    const userId = Number(req.user?.sub || req.user?.id || 0);
    if (!userId) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

    // cache por request
    if (req.access && req.access.user_id === userId) return next();

    // 1) roles
    let roles = rolesFromToken(req);
    if (!roles.length) {
      roles = await fetchRolesFromDB(userId);
    }

    const is_super_admin = roles.includes("super_admin");

    // 2) branches (ids)
    let branch_ids = branchIdsFromToken(req);
    if (!branch_ids.length) {
      branch_ids = await fetchBranchIdsFromDB(userId);
    }

    // 3) permissions
    let permissions = [];
    if (!is_super_admin) {
      permissions = await fetchPermissionsFromDB(roles);
    }

    req.access = {
      user_id: userId,
      roles,
      permissions,
      branch_ids,
      is_super_admin,
      // ✅ helpers
      is_admin: roles.includes("admin") || is_super_admin,
    };

    return next();
  } catch (err) {
    console.error("❌ [rbac] attachAccessContext error:", err?.message || err);
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: "RBAC error" });
  }
}

// ✅ Guard genérico
function requirePermission(code) {
  return (req, res, next) => {
    const a = req.access || {};
    if (a.is_super_admin) return next();
    const perms = Array.isArray(a.permissions) ? a.permissions : [];
    if (perms.includes(code)) return next();
    return res.status(403).json({
      ok: false,
      code: "FORBIDDEN",
      message: `Missing permission: ${code}`,
    });
  };
}

// ✅ Guard safe (permiso OR admin OR super_admin)
function allowAdminOrPermission(permissionCode, message) {
  return (req, res, next) => {
    const a = req.access || {};
    if (a.is_super_admin) return next();

    const roles = Array.isArray(a.roles) ? a.roles : [];
    const perms = Array.isArray(a.permissions) ? a.permissions : [];

    if (permissionCode && perms.includes(permissionCode)) return next();
    if (roles.includes("admin")) return next(); // fallback prod

    return res.status(403).json({
      ok: false,
      code: "FORBIDDEN",
      message: message || "No tenés permisos.",
      needed: permissionCode || null,
      roles,
      permissions: perms,
    });
  };
}

module.exports = { attachAccessContext, requirePermission, allowAdminOrPermission };
