// src/routes/admin.media.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (LIST + USED-BY + DELETE + UPLOAD)

const router = require("express").Router();
const multer = require("multer");
const media = require("../controllers/mediaImages.controller");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.get("/images", media.listAll);
router.get("/images/used-by/:filename", media.usedBy);
router.post("/images", upload.single("file"), media.uploadOne);
router.delete("/images/:id", media.removeById);

module.exports = router;
