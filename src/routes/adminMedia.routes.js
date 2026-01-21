// src/routes/admin.media.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (LIST + DELETE + UPLOAD)

const router = require("express").Router();
const multer = require("multer");
const media = require("../controllers/mediaImages.controller");

// Multer in-memory (ideal para S3/MinIO)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

// GET /api/v1/admin/media/images?page=1&limit=60&q=...
router.get("/images", media.listAll);

// POST /api/v1/admin/media/images (multipart/form-data file=...)
router.post("/images", upload.single("file"), media.uploadOne);

// DELETE /api/v1/admin/media/images/:idOrFilename
router.delete("/images/:id", media.removeById);

module.exports = router;
