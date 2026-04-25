// src/routes/admin.telegram.routes.js
const router = require("express").Router();
const ctrl = require("../controllers/telegram.controller");

router.get("/config", ctrl.getConfig);
router.put("/config", ctrl.updateConfig);
router.post("/test-send", ctrl.testSend);
router.get("/ping", ctrl.ping);
router.get("/logs", ctrl.listLogs);
router.post("/run-scans-now", ctrl.runScansNow);
router.post("/test-stock-alert", ctrl.testStockAlert);
router.post("/scan-low-stock", ctrl.scanLowStock);

module.exports = router;
