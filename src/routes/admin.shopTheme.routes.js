// pos360-commerce-api/src/routes/admin.shopTheme.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
// Admin: GET/PUT /api/v1/admin/shop/theme

const router = require("express").Router();
const shopTheme = require("../controllers/shopTheme.controller");

router.get("/theme", shopTheme.getAdminTheme);
router.put("/theme", shopTheme.updateAdminTheme);

module.exports = router;
