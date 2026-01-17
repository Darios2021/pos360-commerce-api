// src/middlewares/productsAccess.middleware.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Permite operar productos (create/update/images/delete) si:
// - super_admin
// - rol admin
// - o tiene permiso products.write (si existiera en prod)
// - o usuario común con sucursal activa válida (req.ctx.branchId) y esa sucursal está en req.access.branch_ids
//
// NOTA:
// - branchContext (req.ctx) y attachAccessContext (req.access) deben estar aplicados ANTES.

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function norm(x) {
  return String(x || "").trim().toLowerCase();
}

function hasRole(req, roleName) {
  const roles = Array.isArray(req.access?.roles) ? req.access.roles : [];
  const target = norm(roleName);
  return roles.map(norm).includes(target);
}

function hasPermission(req, permCode) {
  const perms = Array.isArray(req.access?.permissions) ? req.access.permissions : [];
  const target = norm(permCode);
  return perms.map(norm).includes(target);
}

function requireProductsOperate(req, res, next) {
  // 1) super admin
  if (req.access?.is_super_admin) return next();

  // 2) rol admin
  if (hasRole(req, "admin")) return next();

  // 3) permiso explícito (si tu prod lo tiene)
  if (hasPermission(req, "products.write")) return next();

  // 4) user común: sucursal activa debe existir y estar permitida
  const branchId = toInt(req.ctx?.branchId, 0);
  const allowed = Array.isArray(req.access?.branch_ids) ? req.access.branch_ids.map((x) => toInt(x, 0)) : [];

  if (branchId && allowed.includes(branchId)) return next();

  return res.status(403).json({
    ok: false,
    code: "FORBIDDEN",
    message: "No tenés permisos para operar productos.",
    data: {
      branchId,
      allowedBranches: allowed,
      roles: req.access?.roles || [],
      permissions: req.access?.permissions || [],
    },
  });
}

module.exports = { requireProductsOperate };
