// src/routes/adminUsers.routes.js
const router = require("express").Router();

const {
  meta,
  list,
  create,
  update,
  setStatus,
} = require("../controllers/adminUsers.controller");

// Meta para combos (roles/sucursales)
router.get("/meta", meta);

// Listado
router.get("/", list);

// Crear
router.post("/", create);

// Editar (✅ esto te faltaba: por eso el PUT daba 404)
router.put("/:id", update);

// Activar/Desactivar (opcional)
router.patch("/:id/status", setStatus);

module.exports = router;
