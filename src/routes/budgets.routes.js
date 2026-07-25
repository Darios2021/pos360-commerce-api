// src/routes/budgets.routes.js
"use strict";

const router = require("express").Router();
const ctrl = require("../controllers/budgets.controller");

// Cabecera
router.get("/", ctrl.list);
// Antes de /:id, si no "stats" cae en getById y rompe.
router.get("/stats", ctrl.stats);
router.post("/", ctrl.create);
router.get("/:id", ctrl.getById);
router.put("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);

// Envío al cliente
router.post("/:id/email", ctrl.sendByEmail);

// Renglones
router.post("/:id/items", ctrl.addItem);
router.put("/:id/items/:itemId", ctrl.updateItem);
router.delete("/:id/items/:itemId", ctrl.removeItem);

module.exports = router;
