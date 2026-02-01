// src/routes/publicVideosFeed.routes.js
// ✅ COPY-PASTE FINAL
const router = require("express").Router();
const ctrl = require("../controllers/productVideos.controller");

router.get("/videos/feed", ctrl.listPublicFeed);

module.exports = router;
