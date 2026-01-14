// src/routes/adminUsers.routes.js
const router = require("express").Router();

const {
  getMeta,
  listUsers,
  createUser,
  updateUser,
  toggleActive,
  resetPassword,
} = require("../controllers/adminUsers.controller");

// ✅ Guard SAFE (no rompe producción)
// - super_admin: pasa siempre
// - si tiene permiso específico: pasa
// - fallback: si es admin (rol), pasa
function allowAdminOrPermission(permissionCode) {
  return (req, res, next) => {
    const a = req.access || {};
    const roles = Array.isArray(a.roles) ? a.roles : [];
    const perms = Array.isArray(a.permissions) ? a.permissions : [];

    if (a.is_super_admin) return next();
    if (permissionCode && perms.includes(permissionCode)) return next();
    if (roles.includes("admin")) return next(); // fallback seguro

    return res.status(403).json({
      ok: false,
      code: "FORBIDDEN",
      message: "No tenés permisos para administrar usuarios.",
      needed: permissionCode || null,
      roles,
      permissions: perms,
    });
  };
}

// Meta
router.get("/meta", allowAdminOrPermission("users.read"), getMeta);

// Listado
router.get("/", allowAdminOrPermission("users.read"), listUsers);

// Crear
router.post("/", allowAdminOrPermission("users.create"), createUser);

// Editar
router.put("/:id", allowAdminOrPermission("users.update"), updateUser);

// Toggle activo (lo usa tu frontend)
router.patch("/:id/toggle-active", allowAdminOrPermission("users.update"), toggleActive);

// Reset password (admin)
router.post("/:id/reset-password", allowAdminOrPermission("users.update"), resetPassword);

module.exports = router;
