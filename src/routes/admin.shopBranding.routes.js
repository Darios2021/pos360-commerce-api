// src/routes/admin.shopBranding.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
// Montado en v1.routes como: safeUse("/admin/shop", requireAuth, adminShopBrandingRoutes)
// => rutas finales:
// GET    /api/v1/admin/shop/branding
// PUT    /api/v1/admin/shop/branding
// POST   /api/v1/admin/shop/branding/logo
// POST   /api/v1/admin/shop/branding/favicon

const router = require("express").Router();
const multer = require("multer");

const ctrl = require("../controllers/admin.shopBranding.controller");

// ✅ Multer in-memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

function mustFn(fn, name) {
  if (typeof fn !== "function") {
    console.error(`❌ admin.shopBranding: handler inválido "${name}" ->`, typeof fn);
    throw new Error(`INVALID_HANDLER_${name}`);
  }
}

// Validación dura (esto evita tu crash silencioso)
mustFn(ctrl.getBranding, "getBranding");
mustFn(ctrl.updateBranding, "updateBranding");
mustFn(ctrl.uploadLogo, "uploadLogo");
mustFn(ctrl.uploadFavicon, "uploadFavicon");

router.get("/branding", ctrl.getBranding);
router.put("/branding", ctrl.updateBranding);

router.post("/branding/logo", upload.single("file"), ctrl.uploadLogo);
router.post("/branding/favicon", upload.single("file"), ctrl.uploadFavicon);

module.exports = router;
