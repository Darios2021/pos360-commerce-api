// src/routes/adminUsers.routes.js
const router = require("express").Router();

const {
  getMeta,
  listUsers,
  createUser,
  updateUser,
} = require("../controllers/adminUsers.controller");

// Meta para UI
router.get("/meta", getMeta);

// Listado
router.get("/", listUsers);

// Crear
router.post("/", createUser);

// Editar (✅ soporta PATCH y PUT porque el frontend te está pegando con PUT)
router.patch("/:id", updateUser);
router.put("/:id", updateUser);

module.exports = router;
