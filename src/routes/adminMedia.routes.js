// src/routes/adminMedia.routes.js
// ✅ COPY-PASTE FINAL DEFINITIVO
//
// Mount esperado:
// /api/v1/admin/media
//
// Endpoints:
// GET    /images?page&limit&q&used&product_id&category_id&subcategory_id
// POST   /images
// PUT    /images/:filename           (overwrite)
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

// =======================
// LIST (con filtros)
// =======================
router.get("/images", mediaCtrl.listAll);

// =======================
// USED BY  🔥🔥🔥
// ⚠️ TIENE QUE IR ANTES DEL :id
// =======================
router.get("/images/used-by/:filename", mediaCtrl.usedByFilename);

// =======================
// UPLOAD
// =======================
router.post("/images", upload.single("file"), mediaCtrl.uploadOne);

// =======================
// OVERWRITE (reescribe)
// ⚠️ también antes del :id si compartís el mismo patrón
// (acá no choca porque :id está en DELETE)
// =======================
router.put("/images/:filename", upload.single("file"), mediaCtrl.overwriteByFilename);

// =======================
// DELETE
// =======================
router.delete("/images/:id", mediaCtrl.removeById);

module.exports = router;
