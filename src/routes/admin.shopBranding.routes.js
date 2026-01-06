// src/routes/admin.shopBranding.routes.js
// ✅ COPY-PASTE FINAL

const express = require("express");
const router = express.Router();

const AdminShopBrandingController = require("../controllers/admin.shopBranding.controller");

const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

// ⚠️ Si ya tenés auth/admin middleware, ponelo acá:
// const { requireAuth, requireAdmin } = require("../middlewares/auth");
// router.use(requireAuth, requireAdmin);

router.get("/shop/branding", AdminShopBrandingController.get);
router.put("/shop/branding", AdminShopBrandingController.update);

router.post("/shop/branding/logo", upload.single("file"), AdminShopBrandingController.uploadLogo);
router.post("/shop/branding/favicon", upload.single("file"), AdminShopBrandingController.uploadFavicon);

module.exports = router;
