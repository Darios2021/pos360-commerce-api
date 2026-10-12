// src/routes/stockCount.routes.js
// Montado en v1.routes como /stock/counts (requireAuth + attachAccessContext + branchContext).
"use strict";

const router = require("express").Router();
const ctrl   = require("../controllers/stockCount.controller");

router.get("/",  ctrl.list);
router.post("/", ctrl.create);

router.get("/:id", ctrl.getById);
router.put("/:id", ctrl.update);

// Acciones de estado
router.post("/:id/submit", ctrl.submit);
router.post("/:id/apply",  ctrl.apply);
router.post("/:id/cancel", ctrl.cancel);

module.exports = router;
