// src/routes/customers.routes.js
"use strict";

const router = require("express").Router();
const ctrl = require("../controllers/customers.controller");

// Listado y CRUD
router.get("/",      ctrl.list);
router.get("/stats", ctrl.getStats);
router.post("/",     ctrl.create);

// Operaciones especiales (van antes de /:id)
router.post("/merge",    ctrl.merge);
router.post("/backfill", ctrl.backfill);

// Detalle / edición / eliminar
router.get("/:id",    ctrl.getById);
router.put("/:id",    ctrl.update);
router.delete("/:id", ctrl.remove);

module.exports = router;
