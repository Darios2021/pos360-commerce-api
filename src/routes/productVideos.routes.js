// src/routes/productVideos.routes.js
// ✅ COPY-PASTE FINAL
// Rutas:
// GET    /api/v1/products/:id/videos
// POST   /api/v1/products/:id/videos/youtube
// POST   /api/v1/products/:id/videos/upload
// DELETE /api/v1/products/:id/videos/:videoId
//
// (Y alias si lo montás en /admin/products desde v1.routes)

const router = require("express").Router();
const multer = require("multer");
const ctrl = require("../controllers/productVideos.controller");

// ✅ buffer en memoria (req.file.buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 }, // 80MB
});

// LIST
router.get("/:id/videos", ctrl.list);

// ADD YOUTUBE
router.post("/:id/videos/youtube", ctrl.addYoutube);

// UPLOAD FILE
router.post("/:id/videos/upload", upload.single("file"), ctrl.upload);

// REMOVE (soft delete)
router.delete("/:id/videos/:videoId", ctrl.remove);

module.exports = router;
