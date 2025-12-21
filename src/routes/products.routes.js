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

// ✅ SOLUCIÓN ROBUSTA: Wrapper para capturar errores de Multer
router.post("/:id/images", (req, res, next) => {
  const uploadMiddleware = upload.single("file"); // Backend espera campo 'file'

  uploadMiddleware(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      // Error específico de Multer (ej: Unexpected field, File too large)
      console.error("❌ MULTER ERROR DETECTADO:", JSON.stringify(err));
      console.error("👉 El backend esperaba el campo 'file'. Revisa qué envía el frontend.");
      return res.status(400).json({ 
        ok: false, 
        message: `Error al subir archivo: ${err.message}`,
        code: err.code,
        field: err.field 
      });
    } else if (err) {
      // Otros errores
      console.error("❌ ERROR DESCONOCIDO EN UPLOAD:", err);
      return res.status(500).json({ ok: false, message: err.message });
    }

    // Si todo salió bien, inyectamos el ID y pasamos al controller
    if (req.params.id) {
      req.body = req.body || {};
      req.body.productId = req.params.id;
    }
    
    // Validamos que el archivo realmente llegó
    if (!req.file) {
      console.warn("⚠️ ALERTA: Multer corrió sin errores, pero req.file está vacío.");
    }

    next();
  });
}, productImagesCtrl.upload);

module.exports = router;