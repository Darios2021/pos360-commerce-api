// src/routes/admin.shopSettings.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
// Montado en v1.routes como: safeUse("/admin/shop", requireAuth, adminShopSettingsRoutes)
//
// Rutas finales:
// GET /api/v1/admin/shop/settings/:key
// PUT /api/v1/admin/shop/settings/:key

const router = require("express").Router();
const ctrl = require("../controllers/admin.shopSettings.controller");

function mustFn(fn, name) {
  if (typeof fn !== "function") {
    console.error(`❌ admin.shopSettings: handler inválido "${name}" ->`, typeof fn);
    throw new Error(`INVALID_HANDLER_${name}`);
  }
}

mustFn(ctrl.getSetting, "getSetting");
mustFn(ctrl.putSetting, "putSetting");

router.get("/settings/:key", ctrl.getSetting);
router.put("/settings/:key", ctrl.putSetting);

module.exports = router;
