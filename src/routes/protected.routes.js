const router = require('express').Router();

const { authRequired } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

router.get('/admin-only', authRequired, requireRole('super_admin', 'admin'), (req, res) => {
  res.json({ ok: true, message: 'You are admin' });
});

module.exports = router;
