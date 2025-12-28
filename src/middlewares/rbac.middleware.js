// src/middlewares/rbac.middleware.js
const { User, Role, Permission } = require("../models");

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function userIdFromReq(req) {
  const p = req.user || {};
  return p.sub || p.id || null;
}

/**
 * Carga roles/permisos efectivos al request.
 * - Si el JWT ya trae roles/perms, los respeta.
 * - Si no, los busca en DB (seguro para prod).
 */
async function loadRbac(req, res, next) {
  try {
    // Si ya vienen en token, no consultamos DB
    const tokenRoles = Array.isArray(req.user?.roles) ? req.user.roles : null;
    const tokenPerms = Array.isArray(req.user?.permissions) ? req.user.permissions : null;

    if (tokenRoles && tokenPerms) {
      req.rbac = {
        roles: uniq(tokenRoles.map((x) => String(x))),
        permissions: uniq(tokenPerms.map((x) => String(x))),
        isSuperAdmin: tokenRoles.includes("super_admin"),
      };
      return next();
    }

    const userId = userIdFromReq(req);
    if (!userId) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

    const u = await User.findByPk(userId, {
      include: [
        {
          model: Role,
          as: "roles",
          through: { attributes: [] },
          include: [
            {
              model: Permission,
              as: "permissions",
              through: { attributes: [] },
            },
          ],
        },
      ],
    });

    if (!u) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

    const roles = uniq((u.roles || []).map((r) => String(r.name)));
    const permissions = uniq(
      (u.roles || []).flatMap((r) => (r.permissions || []).map((p) => String(p.code)))
    );

    req.rbac = {
      roles,
      permissions,
      isSuperAdmin: roles.includes("super_admin"),
    };

    return next();
  } catch (e) {
    console.error("❌ [RBAC] loadRbac error:", e?.message || e);
    return res.status(500).json({ ok: false, code: "RBAC_ERROR", message: "Error cargando RBAC" });
  }
}

/**
 * Requiere un permiso.
 * - super_admin pasa siempre
 */
function requirePermission(code) {
  return (req, res, next) => {
    const r = req.rbac || {};
    if (r.isSuperAdmin) return next();

    const perms = Array.isArray(r.permissions) ? r.permissions : [];
    if (perms.includes(code)) return next();

    return res.status(403).json({
      ok: false,
      code: "FORBIDDEN",
      message: `Falta permiso: ${code}`,
    });
  };
}

/**
 * Requiere uno de varios permisos (OR)
 */
function requireAnyPermission(codes) {
  const want = Array.isArray(codes) ? codes : [codes];
  return (req, res, next) => {
    const r = req.rbac || {};
    if (r.isSuperAdmin) return next();

    const perms = Array.isArray(r.permissions) ? r.permissions : [];
    const ok = want.some((c) => perms.includes(c));
    if (ok) return next();

    return res.status(403).json({
      ok: false,
      code: "FORBIDDEN",
      message: `Falta alguno de: ${want.join(", ")}`,
    });
  };
}

module.exports = {
  loadRbac,
  requirePermission,
  requireAnyPermission,
};
