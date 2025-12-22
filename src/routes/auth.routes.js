// src/routes/auth.routes.js
const express = require("express");
const { login } = require("../controllers/auth.controller");

// ✅ OJO: usá el MISMO requireAuth que estás usando en v1.routes.js
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

// Public
router.post("/login", login);

// Protected (debug)
router.get("/me", requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

module.exports = router;
