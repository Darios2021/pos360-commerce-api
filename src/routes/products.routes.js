const router = require("express").Router();
const multer = require("multer");

const productsCtrl = require("../controllers/products.controller.js");
const productImagesCtrl = require("../controllers/productImages.controller.js");

// Configuración de Multer en Memoria (Buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// --- RUTAS DE PRODUCTOS ---
router.get("/", productsCtrl.list);
router.post("/", productsCtrl.create);
router.get("/:id", productsCtrl.getOne);
router.patch("/:id", productsCtrl.update);

// --- RUTAS DE IMÁGENES ---

router.get("/:id/images", productImagesCtrl.listByProduct);

// ✅ SOLUCIÓN AL "UNEXPECTED FIELD":
// 1. 'upload.single("file")' coincide con fd.append("file", ...) del frontend.
// 2. Pasamos el ID del parámetro de ruta al body para que el controller lo encuentre.
router.post("/:id/images", upload.single("file"), (req, res, next) => {
  if (req.params.id) {
    req.body = req.body || {};
    req.body.productId = req.params.id;
  }
  next();
}, productImagesCtrl.upload);

module.exports = router;