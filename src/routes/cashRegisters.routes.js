// src/routes/cashRegisters.routes.js
const router = require("express").Router();
const controller = require("../controllers/cashRegisters.controller");

router.get("/current", controller.getCurrent);
router.get("/admin/list", controller.adminList);
router.post("/open", controller.open);
router.get("/:id/summary", controller.getSummary);
router.post("/:id/movements", controller.addMovement);
router.post("/:id/close", controller.close);

// Admin-only: cierre forzado (declarar = expected, sin diferencia) y eliminación.
router.post("/admin/:id/force-close", controller.adminForceClose);
router.delete("/admin/:id", controller.adminDelete);

module.exports = router;