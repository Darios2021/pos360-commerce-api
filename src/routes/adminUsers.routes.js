// src/routes/adminUsers.routes.js
const router = require("express").Router();

// ✅ IMPORTANTE: este require tiene que coincidir con el archivo que te dejé
const {
  listMeta,
  listUsers,
  createUser,
  updateUser,
  resetUserPassword,
} = require("../controllers/admin.users.controller");

// RBAC (solo para estas rutas nuevas)
const { attachAccessContext, requirePermission } = require("../middlewares/rbac.middleware");

// ✅ Cargamos access (roles/permissions/branches) sin tocar rutas viejas
router.use(attachAccessContext);

// META (roles/branches/permissions) → lo pide la vista
router.get("/meta", requirePermission("users.read"), listMeta);

// LIST
router.get("/", requirePermission("users.read"), listUsers);

// CREATE
router.post("/", requirePermission("users.create"), createUser);

// UPDATE
router.patch("/:id", requirePermission("users.update"), updateUser);

// RESET PASSWORD (admin)
router.post("/:id/password", requirePermission("users.update"), resetUserPassword);

module.exports = router;
