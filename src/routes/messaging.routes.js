// src/routes/messaging.routes.js
"use strict";

const router = require("express").Router();
const ctrl = require("../controllers/messaging.controller");

// Templates CRUD
router.get("/templates",       ctrl.listTemplates);
router.post("/templates",      ctrl.createTemplate);
router.put("/templates/:id",   ctrl.updateTemplate);
router.delete("/templates/:id", ctrl.deleteTemplate);

// Helpers
router.get("/variables", ctrl.listVariables);
router.get("/status",    ctrl.status);
router.post("/preview",  ctrl.preview);
router.post("/test-email", ctrl.testEmail);

// Envíos
router.post("/send",       ctrl.sendOne);
router.post("/send-bulk",  ctrl.sendBulk);

// Logs
router.get("/logs",                ctrl.listLogs);
router.get("/logs/customer/:id",   ctrl.listLogsByCustomer);

module.exports = router;
