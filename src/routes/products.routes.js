// src/routes/products.routes.js
const router = require("express").Router();
const productsCtrl = require("../controllers/products.controller");

// Listado (con q/page/limit)
router.get("/", productsCtrl.list);

// ✅ GET by id (esto te falta y por eso 404)
router.get("/:id", productsCtrl.getById);

// Crear
router.post("/", productsCtrl.create);

// Actualizar
router.put("/:id", productsCtrl.update);

// (opcional) borrar
// router.delete("/:id", productsCtrl.remove);

module.exports = router;
