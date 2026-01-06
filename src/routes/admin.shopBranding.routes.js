// src/routes/admin.shopBranding.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
const router = require("express").Router();
const multer = require("multer");

// ✅ MUY IMPORTANTE: memoryStorage para subir a MinIO/S3
const upload = multer({ storage: multer.memoryStorage() });

const ctrl = require("../controllers/admin.shopBranding.controller");

// OJO: estas funciones DEBEN existir (con el controller de arriba existen)
router.get("/branding", ctrl.get);
router.put("/branding", ctrl.update);

router.post("/branding/logo", upload.single("file"), ctrl.uploadLogo);
router.post("/branding/favicon", upload.single("file"), ctrl.uploadFavicon);

module.exports = router;
