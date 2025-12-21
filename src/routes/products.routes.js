// src/routes/products.routes.js
const router = require("express").Router();
const multer = require("multer");

const productsCtrl = require("../controllers/products.controller.js");
const productImagesCtrl = require("../controllers/productImages.controller.js");

// Multer en memoria para subir a MinIO desde controller
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// ----------------------
// Productos
// ----------------------
router.get("/", productsCtrl.list);
router.post("/", productsCtrl.create);
router.get("/:id", productsCtrl.getOne);
router.patch("/:id", productsCtrl.update);

// ----------------------
// Imágenes de producto
// GET  /api/v1/products/:id/images
// POST /api/v1/products/:id/images  (multipart: file)
// ----------------------
router.get("/:id/images", productImagesCtrl.listByProduct);

// Nota: el controller espera productId en body, así que lo seteamos acá:
router.post("/:id/images", upload.single("file"), (req, res, next) => {
  req.body = req.body || {};
  req.body.productId = req.params.id;
  return productImagesCtrl.upload(req, res, next);
});

module.exports = router;
