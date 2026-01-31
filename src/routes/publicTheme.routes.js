// pos360-commerce-api/src/routes/publicTheme.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
// Public: GET /api/v1/public/theme

const router = require("express").Router();
const shopTheme = require("../controllers/shopTheme.controller");

router.get("/theme", shopTheme.getPublicTheme);

module.exports = router;
