// src/routes/stockTransfer.routes.js
"use strict";

const router = require("express").Router();
const ctrl   = require("../controllers/stockTransfer.controller");

// Listado y creación
router.get("/",    ctrl.list);
router.post("/",   ctrl.create);

// Operaciones bulk (deben ir antes de /:id para no chocar con la ruta dinámica)
router.post("/bulk/receive", ctrl.bulkReceive);
router.post("/bulk/delete",  ctrl.bulkDelete);

// Detalle y edición de draft
router.get("/:id",    ctrl.getById);
router.put("/:id",    ctrl.update);
router.delete("/:id", ctrl.remove);

// Acciones de estado
router.post("/:id/dispatch", ctrl.dispatch);
router.post("/:id/receive",  ctrl.receive);
router.post("/:id/cancel",   ctrl.cancel);

module.exports = router;
