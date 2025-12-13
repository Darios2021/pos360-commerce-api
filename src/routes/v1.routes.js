const express = require('express');
const routes = require('./index');

const router = express.Router();

router.use('/', routes);

module.exports = router;
