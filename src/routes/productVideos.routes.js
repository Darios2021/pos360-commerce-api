// src/routes/productVideos.routes.js
// ✅ COPY-PASTE FINAL
// Montaje esperado:
// - /api/v1/products/:id/videos...
// - /api/v1/admin/products/:id/videos... (alias)

const router = require("express").Router();
const multer = require("multer");

const productVideosController = require("../controllers/productVideos.controller");

// Multer memory (igual que images)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 80 * 1024 * 1024, // 80MB
  },
});

router.get("/:id/videos", productVideosController.list);
router.post("/:id/videos/youtube", productVideosController.addYoutube);
router.post("/:id/videos/upload", upload.single("file"), productVideosController.upload);
router.delete("/:id/videos/:videoId", productVideosController.remove);

module.exports = router;
