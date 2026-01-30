// src/routes/productVideos.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
// ADMIN / PROTECTED (se monta en /api/v1/admin/products)
//
// POST   /api/v1/admin/products/:id/videos/youtube
// POST   /api/v1/admin/products/:id/videos/upload
// DELETE /api/v1/admin/products/:id/videos/:videoId

const router = require("express").Router();
const multer = require("multer");
const ctrl = require("../controllers/productVideos.controller");

// ✅ buffer en memoria (req.file.buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 }, // 80MB
});

// ADD YOUTUBE
router.post("/:id/videos/youtube", ctrl.addYoutube);

// UPLOAD FILE
router.post("/:id/videos/upload", upload.single("file"), ctrl.upload);

// REMOVE (soft delete)
router.delete("/:id/videos/:videoId", ctrl.remove);

module.exports = router;
