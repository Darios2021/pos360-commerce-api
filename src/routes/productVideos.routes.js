// src/routes/productVideos.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
// Rutas:
// GET    /api/v1/products/:id/videos
// POST   /api/v1/products/:id/videos/youtube
// POST   /api/v1/products/:id/videos/upload
// DELETE /api/v1/products/:id/videos/:videoId

const router = require("express").Router();
const multer = require("multer");
const ctrl = require("../controllers/productVideos.controller");

// Multer memory (subida a buffer) - igual a imágenes
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 80 * 1024 * 1024, // 80MB
  },
});

router.get("/:id/videos", ctrl.list);
router.post("/:id/videos/youtube", ctrl.addYoutube);
router.post("/:id/videos/upload", upload.single("file"), ctrl.upload);
router.delete("/:id/videos/:videoId", ctrl.remove);

module.exports = router;
