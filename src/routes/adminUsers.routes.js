// src/routes/adminUsers.routes.js
const router = require("express").Router();

const {
  getMeta,
  listUsers,
  createUser,
  updateUser,
  resetPassword,
} = require("../controllers/admin.users.controller");

// GET meta (roles/branches/permissions)
router.get("/meta", getMeta);

// Listado
router.get("/", listUsers);

// CRUD (dejamos stub por ahora)
router.post("/", createUser);
router.patch("/:id", updateUser);
router.post("/:id/password", resetPassword);

module.exports = router;
