const { Router } = require('express');

const healthRoutes = require('../modules/health/health.routes');

const router = Router();

router.use('/', healthRoutes);

module.exports = router;
