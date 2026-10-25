// src/routes/service.routes.js
"use strict";

const router = require("express").Router();
const ctrl = require("../controllers/service.controller");

// Lista de precios de reparacion. Va antes de /orders/:id para que no lo tape
// ninguna ruta con parametro.
router.get("/prices", ctrl.prices);
// Crea (o reusa) el producto de catalogo para poder cobrar la reparacion por POS.
router.post("/prices/:id/espejo", ctrl.mirrorPrice);

// Buscador de clientes del ingreso (cualquier usuario: es el cajero el que recibe)
router.get("/clientes", ctrl.customers);

// Tecnicos: la lista para derivar y la marca de quien es tecnico (admin).
router.get("/technicians", ctrl.technicians);
router.get("/technicians/usuarios", ctrl.technicianUsers);
router.put("/technicians/:userId", ctrl.setTechnician);

// Cabecera
router.get("/orders", ctrl.list);
// Antes de /orders/:id: si no, "stats" se lee como un id y rompe.
router.get("/orders/stats", ctrl.stats);
router.post("/orders", ctrl.create);
router.get("/orders/:id", ctrl.getById);
router.put("/orders/:id", ctrl.update);
router.delete("/orders/:id", ctrl.remove);

// Seguimiento: notas internas y avisos al cliente por WhatsApp
router.post("/orders/:id/notes", ctrl.addNote);
router.post("/orders/:id/whatsapp", ctrl.whatsapp);

// Renglones: repuestos y mano de obra
router.post("/orders/:id/items", ctrl.addItem);
router.put("/orders/:id/items/:itemId", ctrl.updateItem);
router.delete("/orders/:id/items/:itemId", ctrl.removeItem);

module.exports = router;
