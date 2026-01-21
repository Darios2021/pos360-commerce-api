// ✅ COPY-PASTE FINAL COMPLETO
// src/routes/adminShopLinks.routes.js

const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/adminShopLinks.controller");

// Montado en v1 como: /admin/shop-links
router.get("/", ctrl.list);
router.post("/", ctrl.create);
router.patch("/:id", ctrl.patch);
router.delete("/:id", ctrl.remove);

module.exports = router;
