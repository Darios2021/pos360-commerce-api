// src/routes/protected.routes.js
const express = require("express");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

// ✅ Ruta de prueba para ver payload JWT (diagnóstico)
router.get("/whoami", requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

module.exports = router;
