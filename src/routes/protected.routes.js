const express = require('express');
const { requireAuth } = require('../middlewares/auth.middleware');

const router = express.Router();

// ✅ Ruta protegida simple para testear JWT
router.get('/me', requireAuth, (req, res) => {
  return res.json({ ok: true, user: req.user });
});

module.exports = router;
