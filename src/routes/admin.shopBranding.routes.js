// src/routes/admin.shopBranding.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
// Mount en v1.routes: safeUse("/admin/shop", requireAuth, adminShopBrandingRoutes)
//
// Rutas finales:
// GET    /api/v1/admin/shop/branding
// PUT    /api/v1/admin/shop/branding
// POST   /api/v1/admin/shop/branding/logo
// POST   /api/v1/admin/shop/branding/favicon
// POST   /api/v1/admin/shop/branding/og-image

const router = require("express").Router();
const multer = require("multer");

const ctrl = require("../controllers/admin.shopBranding.controller");

// ✅ Multer in-memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB (OG puede ser pesada)
});

// Multer separado para holiday overlay: permite videos cortos (hasta 8MB).
const uploadOverlay = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

function mustFn(fn, name) {
  if (typeof fn !== "function") {
    console.error(`❌ admin.shopBranding: handler inválido "${name}" ->`, typeof fn);
    throw new Error(`INVALID_HANDLER_${name}`);
  }
}

mustFn(ctrl.getBranding, "getBranding");
mustFn(ctrl.updateBranding, "updateBranding");
mustFn(ctrl.uploadLogo, "uploadLogo");
mustFn(ctrl.uploadFavicon, "uploadFavicon");
mustFn(ctrl.uploadOgImage, "uploadOgImage");
mustFn(ctrl.uploadHolidayOverlay, "uploadHolidayOverlay");
mustFn(ctrl.removeHolidayOverlay, "removeHolidayOverlay");

router.get("/branding", ctrl.getBranding);
router.put("/branding", ctrl.updateBranding);

router.post("/branding/logo", upload.single("file"), ctrl.uploadLogo);
router.post("/branding/favicon", upload.single("file"), ctrl.uploadFavicon);
router.post("/branding/og-image", upload.single("file"), ctrl.uploadOgImage);

// 🇦🇷 Decoración estacional sobre el logo (GIF/PNG/MP4)
router.post("/branding/holiday-overlay", uploadOverlay.single("file"), ctrl.uploadHolidayOverlay);
router.delete("/branding/holiday-overlay", ctrl.removeHolidayOverlay);

// Íconos custom de redes sociales (CRM email).
router.get("/branding/social-icons", ctrl.listSocialIcons);
router.post("/branding/social-icons/:kind", upload.single("file"), ctrl.uploadSocialIcon);
router.delete("/branding/social-icons/:kind", ctrl.deleteSocialIcon);

module.exports = router;
