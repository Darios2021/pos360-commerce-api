const router = require("express").Router();
const multer = require("multer");

const productsCtrl = require("../controllers/products.controller.js");
const productImagesCtrl = require("../controllers/productImages.controller.js");

// --- CONFIGURACIÓN MULTER ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// --- RUTAS PRODUCTOS ---
router.get("/", productsCtrl.list);
router.post("/", productsCtrl.create);
router.get("/:id", productsCtrl.getOne);
router.patch("/:id", productsCtrl.update);

// --- RUTAS IMÁGENES ---
router.get("/:id/images", productImagesCtrl.listByProduct);

/**
 * ✅ SOLUCIÓN FINAL PARA IMÁGENES
 * Usamos .any() para que no importe si el frontend envía 'file', 'files' o 'image'.
 */
router.post("/:id/images", upload.any(), productImagesCtrl.upload);

module.exports = router;