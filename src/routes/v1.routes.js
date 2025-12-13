const router = require('express').Router();
const routes = require('./index');

router.use('/', routes);

module.exports = router;
