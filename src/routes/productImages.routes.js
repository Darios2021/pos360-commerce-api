// src/routes/productImages.routes.js
const router = require("express").Router();
const ctrl = require("../controllers/productImages.controller");

router.get("/products/:id/images", ctrl.listByProduct);

module.exports = router;
