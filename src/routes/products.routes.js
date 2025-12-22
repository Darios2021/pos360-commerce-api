// src/routes/products.routes.js
const router = require("express").Router();
const multer = require("multer");

const productsCtrl = require("../controllers/products.controller.js");
const productImagesCtrl = require("../controllers/productImages.controller.js");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// --- PRODUCTOS ---
router.get("/", productsCtrl.list);
router.post("/", productsCtrl.create);
router.get("/:id", productsCtrl.getOne);
router.patch("/:id", productsCtrl.update);

// ✅ DELETE producto
router.delete("/:id", productsCtrl.remove);

// --- IMÁGENES ---
router.get("/:id/images", productImagesCtrl.listByProduct);
router.post("/:id/images", upload.any(), productImagesCtrl.upload);

// ✅ borrar una imagen por id
router.delete("/:id/images/:imageId", productImagesCtrl.remove);

module.exports = router;
