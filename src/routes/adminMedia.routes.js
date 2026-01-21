// src/routes/adminMedia.routes.js
// ✅ COPY-PASTE FINAL DEFINITIVO
//
// Mount esperado:
// /api/v1/admin/media
//
// Endpoints:
// GET    /images?page&limit&q&used&product_id&category_id&subcategory_id
// POST   /images
// PUT    /images/:id               (overwrite REAL por key/url/filename)
// DELETE /images/:id
// GET    /images/used-by/:filename

const router = require("express").Router();
const multer = require("multer");
const mediaCtrl = require("../controllers/mediaImages.controller");

// Multer en memoria (S3 / MinIO)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

// 🔒 Anti-cache (evita 304 sin body)
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// LIST
router.get("/images", mediaCtrl.listAll);

// USED BY (antes de /:id por seguridad)
router.get("/images/used-by/:filename", mediaCtrl.usedByFilename);

// UPLOAD
router.post("/images", upload.single("file"), mediaCtrl.uploadOne);

// ✅ OVERWRITE REAL (mismo objeto)
router.put("/images/:id", upload.single("file"), mediaCtrl.overwriteById);

// DELETE
router.delete("/images/:id", mediaCtrl.removeById);

module.exports = router;
