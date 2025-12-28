// src/routes/adminUsers.routes.js
const router = require("express").Router();

const {
  getMeta,
  listUsers,
  createUser,
  updateUser,
} = require("../controllers/adminUsers.controller");

// ✅ Wrapper para async controllers (evita crash / 502)
function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Meta para UI
router.get("/meta", ah(getMeta));

// Listado
router.get("/", ah(listUsers));

// Crear
router.post("/", ah(createUser));

// ✅ Editar (aceptamos PATCH y PUT porque tu frontend manda PUT)
router.patch("/:id", ah(updateUser));
router.put("/:id", ah(updateUser));

module.exports = router;
