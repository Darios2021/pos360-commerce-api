// src/routes/productVideos.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
// Público:
//   GET    /api/v1/products/:id/videos
//
// Protegido (requiere Bearer token):
//   POST   /api/v1/products/:id/videos/youtube
//   POST   /api/v1/products/:id/videos/upload
//   DELETE /api/v1/products/:id/videos/:videoId
//
// Nota: YA NO dependemos de requireAuth en v1.routes mount para que el GET sea público.

const router = require("express").Router();
const multer = require("multer");
const { requireAuth } = require("../middlewares/auth");
const ctrl = require("../controllers/productVideos.controller");

// ✅ buffer en memoria (req.file.buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 }, // 80MB
});

// =========================
// PUBLIC
// =========================
router.get("/:id/videos", ctrl.list);

// =========================
// PROTECTED
// =========================
router.post("/:id/videos/youtube", requireAuth, ctrl.addYoutube);
router.post("/:id/videos/upload", requireAuth, upload.single("file"), ctrl.upload);
router.delete("/:id/videos/:videoId", requireAuth, ctrl.remove);

module.exports = router;
