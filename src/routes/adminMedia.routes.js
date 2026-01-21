// src/routes/adminMedia.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Mount esperado:
// /api/v1/admin/media
//
// Endpoints:
// GET    /images?page&limit&q
// POST   /images            (multipart file)
// DELETE /images/:id
// GET    /images/used-by/:filename   (opcional si lo agregás)

const router = require("express").Router();
const multer = require("multer");

const mediaCtrl = require("../controllers/mediaImages.controller");

// ✅ Multer en memoria (para subir a S3/MinIO directo)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

// ✅ anti-cache para que NO te devuelva 304 sin body
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");

  // Nota: si tenés etag global ON, esto solo no siempre alcanza,
  // por eso recomiendo app.set("etag", false)
  next();
});

// LIST
router.get("/images", mediaCtrl.listAll);

// UPLOAD
router.post("/images", upload.single("file"), mediaCtrl.uploadOne);

// DELETE
router.delete("/images/:id", mediaCtrl.removeById);

// (opcional) USED-BY
// router.get("/images/used-by/:filename", mediaCtrl.usedBy);

module.exports = router;
