// src/routes/service.routes.js
"use strict";

const router = require("express").Router();
const ctrl = require("../controllers/service.controller");

// Lista de precios de reparacion. Va antes de /orders/:id para que no lo tape
// ninguna ruta con parametro.
router.get("/prices", ctrl.prices);
// Crea (o reusa) el producto de catalogo para poder cobrar la reparacion por POS.
router.post("/prices/:id/espejo", ctrl.mirrorPrice);

// Cabecera
router.get("/orders", ctrl.list);
// Antes de /orders/:id: si no, "stats" se lee como un id y rompe.
router.get("/orders/stats", ctrl.stats);
router.post("/orders", ctrl.create);
router.get("/orders/:id", ctrl.getById);
router.put("/orders/:id", ctrl.update);
router.delete("/orders/:id", ctrl.remove);

// Renglones: repuestos y mano de obra
router.post("/orders/:id/items", ctrl.addItem);
router.put("/orders/:id/items/:itemId", ctrl.updateItem);
router.delete("/orders/:id/items/:itemId", ctrl.removeItem);

module.exports = router;
