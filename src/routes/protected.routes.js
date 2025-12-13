const express = require('express');
const { requireAuth } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

module.exports = router;
