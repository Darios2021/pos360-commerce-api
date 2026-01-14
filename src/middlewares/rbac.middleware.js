// src/middlewares/rbac.middleware.js
const { User, Role, Branch, Permission, RolePermission } = require("../models");

async function attachAccessContext(req, res, next) {
  try {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

    const u = await User.findByPk(userId, {
      include: [
        {
          model: Role,
          as: "roles",
          through: { attributes: [] },
          required: false,
          attributes: ["id", "name"], // ✅ seguro
        },
        {
          model: Branch,
          as: "branches",
          through: { attributes: [] },
          required: false,
          // ✅ SOLO columnas que existen en tu DB (evita branches.phone)
          attributes: ["id", "name", "code"],
        },
      ],
      attributes: ["id", "email"], // ✅ mínimo
    });

    if (!u) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

    const roles = (u.roles || []).map((r) => r.name);
    const is_super_admin = roles.includes("super_admin");

    let permissions = [];
    if (!is_super_admin) {
      const roleIds = (u.roles || []).map((r) => r.id).filter(Boolean);
      if (roleIds.length) {
        const rps = await RolePermission.findAll({ where: { role_id: roleIds } });
        const permIds = Array.from(new Set((rps || []).map((x) => x.permission_id).filter(Boolean)));

        if (permIds.length) {
          const perms = await Permission.findAll({
            where: { id: permIds },
            attributes: ["code"],
          });
          permissions = (perms || []).map((p) => p.code);
        }
      }
    }

    req.access = {
      roles,
      permissions,
      branch_ids: (u.branches || []).map((b) => b.id),
      is_super_admin,
    };

    return next();
  } catch (err) {
    console.error("❌ [rbac] attachAccessContext error:", err?.message || err);
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: "RBAC error" });
  }
}

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

module.exports = { attachAccessContext, requirePermission };
