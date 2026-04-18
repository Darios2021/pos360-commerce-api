// src/routes/analytics.routes.js
const router = require("express").Router();
const analytics = require("../controllers/analytics.controller");

router.get("/cash", analytics.cashAnalytics);
router.get("/sales", analytics.salesDeep);
router.get("/products", analytics.productsDeep);
router.get("/stock-movements", analytics.stockMovementsDeep);

module.exports = router;
