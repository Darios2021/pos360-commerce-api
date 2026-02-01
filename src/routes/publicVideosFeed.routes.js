// ✅ COPY-PASTE FINAL COMPLETO
// src/routes/publicVideosFeed.routes.js
// Rutas PUBLIC (sin auth):
// GET /api/v1/public/videos/feed?limit=18

const router = require("express").Router();
const ctrl = require("../controllers/productVideos.controller");

// FEED GLOBAL (todos los videos)
router.get("/videos/feed", ctrl.listPublicFeed);

module.exports = router;
