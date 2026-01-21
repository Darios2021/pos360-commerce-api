// src/routes/admin.media.routes.js
// ✅ COPY-PASTE FINAL COMPLETO

const router = require("express").Router();
const media = require("../controllers/mediaImages.controller");

// GET /api/v1/admin/media/images
router.get("/images", media.listAll);

// DELETE /api/v1/admin/media/images/:id
router.delete("/images/:id", media.removeById);

module.exports = router;
