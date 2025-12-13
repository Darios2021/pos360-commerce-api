const express = require('express');

const authRoutes = require('./auth.routes');
const healthRoutes = require('./health.routes');
const protectedRoutes = require('./protected.routes');

const router = express.Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/protected', protectedRoutes);

module.exports = router;
