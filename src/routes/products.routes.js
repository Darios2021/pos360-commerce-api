// src/routes/products.routes.js
const router = require("express").Router();
const multer = require("multer");

const productsCtrl = require("../controllers/products.controller.js");
const productImagesCtrl = require("../controllers/productImages.controller.js");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// --- LIST ---
router.get("/", productsCtrl.list);
router.post("/", productsCtrl.create);

// --- IMÁGENES (antes de /:id) ---
router.get("/:id/images", productImagesCtrl.listByProduct);
router.post("/:id/images", upload.any(), productImagesCtrl.upload);

// --- ONE ---
router.get("/:id", productsCtrl.getOne);
router.patch("/:id", productsCtrl.update);

module.exports = router;
