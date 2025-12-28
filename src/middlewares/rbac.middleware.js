// src/middlewares/rbac.middleware.js
const { User, Role, Permission, Branch } = require("../models");

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

/**
 * Carga access context:
 *  - roles (names)
 *  - permissions (codes)
 *  - branch_ids (ids)
 * y lo deja en req.access
 */
async function attachAccessContext(req, res, next) {
  try {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

    const u = await User.findByPk(userId, {
      include: [
        { model: Role, as: "roles", through: { attributes: [] } },
        { model: Branch, as: "branches", through: { attributes: [] } },
      ],
    });

    if (!u) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

    const roles = uniq((u.roles || []).map((r) => r.name));
    const branch_ids = uniq((u.branches || []).map((b) => Number(b.id)));

    // permisos por roles
    let permissions = [];
    if (Role.associations?.permissions) {
      const rs = await Role.findAll({
        where: { name: roles },
        include: [{ model: Permission, as: "permissions", through: { attributes: [] } }],
      });
      permissions = uniq(
        rs.flatMap((r) => (r.permissions || []).map((p) => p.code))
      );
    }

    req.access = {
      roles,
      permissions,
      branch_ids,
      is_super_admin: roles.includes("super_admin"),
    };

    return next();
  } catch (e) {
    console.error("❌ [attachAccessContext]", e?.message || e);
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR" });
  }
}

/**
 * Requiere role
 */
function requireRole(...allowed) {
  const allow = allowed.filter(Boolean);
  return (req, res, next) => {
    const roles = req.access?.roles || req.user?.roles || [];
    const ok = allow.length === 0 ? true : allow.some((r) => roles.includes(r));
    if (!ok) return res.status(403).json({ ok: false, code: "FORBIDDEN" });
    next();
  };
}

/**
 * Requiere permiso (code)
 */
function requirePermission(...codes) {
  const need = codes.filter(Boolean);
  return (req, res, next) => {
    const perms = req.access?.permissions || [];
    const roles = req.access?.roles || req.user?.roles || [];
    if (roles.includes("super_admin")) return next();
    const ok = need.length === 0 ? true : need.every((c) => perms.includes(c));
    if (!ok) return res.status(403).json({ ok: false, code: "FORBIDDEN" });
    next();
  };
}

module.exports = { attachAccessContext, requireRole, requirePermission };
