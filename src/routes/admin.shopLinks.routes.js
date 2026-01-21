// ✅ COPY-PASTE FINAL COMPLETO
// src/routes/admin.shopLinks.routes.js
const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/adminShopLinks.controller");

// Montado en v1 como /admin/shop (con requireAuth + attachAccessContext)
// => /api/v1/admin/shop/links
router.get("/links", ctrl.list);
router.post("/links", ctrl.create);
router.put("/links/:id", ctrl.update);
router.delete("/links/:id", ctrl.remove);

// reorder
router.post("/links/reorder", ctrl.reorder);

module.exports = router;
