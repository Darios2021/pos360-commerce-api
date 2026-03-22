// src/routes/cashRegisters.routes.js
const router = require("express").Router();
const controller = require("../controllers/cashRegisters.controller");

router.get("/current", controller.getCurrent);
router.post("/open", controller.open);
router.get("/:id/summary", controller.getSummary);
router.post("/:id/movements", controller.addMovement);
router.post("/:id/close", controller.close);

module.exports = router;