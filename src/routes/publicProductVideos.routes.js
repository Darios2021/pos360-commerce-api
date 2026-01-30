// src/routes/publicProductVideos.routes.js
// ✅ COPY-PASTE FINAL
// Rutas PUBLIC (sin auth):
// GET /api/v1/public/products/:id/videos

const router = require("express").Router();
const ctrl = require("../controllers/productVideos.controller");

// LIST (solo lectura pública)
router.get("/products/:id/videos", ctrl.list);

module.exports = router;
