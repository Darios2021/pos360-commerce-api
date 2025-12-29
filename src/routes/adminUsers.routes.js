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

// Meta
router.get("/meta", getMeta);

// Listado
router.get("/", listUsers);

// Crear
router.post("/", createUser);

// Editar
router.put("/:id", updateUser);

// Toggle activo (lo usa tu frontend)
router.patch("/:id/toggle-active", toggleActive);

// Reset password (admin)
router.post("/:id/reset-password", resetPassword);

module.exports = router;
