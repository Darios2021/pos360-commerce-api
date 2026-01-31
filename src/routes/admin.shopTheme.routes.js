// ✅ COPY-PASTE FINAL COMPLETO
// pos360-commerce-api/src/routes/admin.shopTheme.routes.js
const router = require("express").Router();

const shopTheme = require("../controllers/shopTheme.controller");

// ✅ /api/v1/admin/shop/theme
router.get("/theme", shopTheme.getAdminTheme);
router.put("/theme", shopTheme.updateAdminTheme);

module.exports = router;
