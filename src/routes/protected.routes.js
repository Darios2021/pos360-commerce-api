// src/routes/protected.routes.js
const express = require("express");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

router.get("/me", requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: req.user,
  });
});

module.exports = router;
