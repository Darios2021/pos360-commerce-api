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

// ✅ SOLUCIÓN FINAL: Aceptamos el campo "files" que envía tu frontend
router.post("/:id/images", (req, res, next) => {
  // Aceptamos hasta 10 archivos en el campo "files"
  const uploadMiddleware = upload.array("files", 10); 

  uploadMiddleware(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error("❌ MULTER ERROR:", JSON.stringify(err));
      return res.status(400).json({ ok: false, message: err.message, field: err.field });
    } else if (err) {
      return res.status(500).json({ ok: false, message: err.message });
    }

    // Inyectamos el ID del producto
    req.body.productId = req.params.id;
    
    // IMPORTANTE: Como usamos .array(), los archivos están en req.files
    // Si el controlador espera req.file, le pasamos el primero del array
    if (req.files && req.files.length > 0) {
      req.file = req.files[0];
    }

    next();
  });
}, productImagesCtrl.upload);

module.exports = router;