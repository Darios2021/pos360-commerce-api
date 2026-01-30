// src/routes/productVideos.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (ANTI-CRASH)
// Rutas:
// GET    /api/v1/products/:id/videos
// POST   /api/v1/products/:id/videos/youtube
// POST   /api/v1/products/:id/videos/upload
// DELETE /api/v1/products/:id/videos/:videoId

const router = require("express").Router();
const multer = require("multer");
const ctrl = require("../controllers/productVideos.controller");

// ✅ Express 4 NO atrapa errores de async/await => esto evita 502 (crash)
const asyncWrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Multer memory (subida a buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 }, // 80MB
});

// ✅ Helper para devolver JSON en errores de multer
function multerErrorHandler(err, req, res, next) {
  if (!err) return next();
  const msg =
    err?.code === "LIMIT_FILE_SIZE"
      ? "Video muy grande (max 80MB)"
      : err?.message || "Error subiendo archivo";
  return res.status(400).json({ ok: false, code: "UPLOAD_ERROR", message: msg });
}

router.get("/:id/videos", asyncWrap(ctrl.list));
router.post("/:id/videos/youtube", asyncWrap(ctrl.addYoutube));

router.post(
  "/:id/videos/upload",
  upload.single("file"),
  multerErrorHandler,
  asyncWrap(ctrl.upload)
);

router.delete("/:id/videos/:videoId", asyncWrap(ctrl.remove));

// ✅ Error handler local (si algo explota igual, devuelve JSON y NO 502)
router.use((err, req, res, next) => {
  console.error("❌ [productVideos.routes] error:", err);
  if (res.headersSent) return next(err);
  return res.status(500).json({
    ok: false,
    code: "VIDEO_ROUTE_ERROR",
    message: err?.message || "Error interno",
  });
});

module.exports = router;
