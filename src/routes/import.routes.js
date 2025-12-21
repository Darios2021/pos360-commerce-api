// src/routes/import.routes.js
const router = require("express").Router();
const multer = require("multer");
const ImportController = require("../controllers/import.controller");

// Multer en memoria (para CSV chico/mediano). Si el CSV es enorme, se puede pasar a diskStorage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// POST /api/v1/import/products  (multipart/form-data: file)
router.post("/products", upload.single("file"), ImportController.importProductsCsv);

module.exports = router;
