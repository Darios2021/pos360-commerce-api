// ✅ COPY-PASTE FINAL COMPLETO
// src/routes/publicInstagram.routes.js
const express = require("express");
const router = express.Router();

const { latest } = require("../controllers/publicInstagram.controller");

// Público (sin auth)
// Montado desde v1 como /public => /api/v1/public/instagram/latest
router.get("/instagram/latest", latest);

module.exports = router;
