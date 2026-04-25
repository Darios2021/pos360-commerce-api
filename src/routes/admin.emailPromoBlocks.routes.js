// src/routes/admin.emailPromoBlocks.routes.js
//
// Rutas del CRM admin para los bloques promocionales reutilizables.
// Mount en v1.routes:
//   safeUse("/admin/email-promo-blocks", requireAuth, attachAccessContext, adminEmailPromoBlocksRoutes);
//
// Endpoints:
//   GET    /api/v1/admin/email-promo-blocks
//   GET    /api/v1/admin/email-promo-blocks/:id
//   POST   /api/v1/admin/email-promo-blocks
//   PUT    /api/v1/admin/email-promo-blocks/:id
//   DELETE /api/v1/admin/email-promo-blocks/:id
//   POST   /api/v1/admin/email-promo-blocks/:id/image
//   GET    /api/v1/admin/email-promo-blocks/from-product/:productId

const router = require("express").Router();
const multer = require("multer");

const ctrl = require("../controllers/admin.emailPromoBlocks.controller");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

router.get("/", ctrl.listBlocks);
router.get("/from-product/:productId", ctrl.fromProduct);
router.get("/:id", ctrl.getBlock);
router.post("/", ctrl.createBlock);
router.put("/:id", ctrl.updateBlock);
router.delete("/:id", ctrl.deleteBlock);
router.post("/:id/image", upload.single("file"), ctrl.uploadBlockImage);

module.exports = router;
