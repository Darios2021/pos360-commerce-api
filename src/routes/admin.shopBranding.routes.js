// src/routes/admin.shopBranding.routes.js
// ✅ COPY-PASTE FINAL
// Admin Branding (protegido por requireAuth desde v1.routes.js)

const router = require("express").Router();
const AdminShopBrandingController = require("../controllers/admin.shopBranding.controller");

// GET branding actual
router.get("/branding", AdminShopBrandingController.get);

// PUT branding (json)
router.put("/branding", AdminShopBrandingController.update);

module.exports = router;
