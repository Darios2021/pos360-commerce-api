// src/routes/admin.shopBranding.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
const router = require("express").Router();

const controller = require("../controllers/admin.shopBranding.controller");
const service = require("../services/admin.shopBranding.service");

// GET /api/v1/admin/shop/branding
router.get("/branding", controller.getBranding);

// PUT /api/v1/admin/shop/branding
router.put("/branding", controller.updateBranding);

// POST /api/v1/admin/shop/branding/logo
router.post("/branding/logo", service.uploadLogoMiddleware, controller.uploadLogo);

// POST /api/v1/admin/shop/branding/favicon
router.post("/branding/favicon", service.uploadFaviconMiddleware, controller.uploadFavicon);

module.exports = router;
