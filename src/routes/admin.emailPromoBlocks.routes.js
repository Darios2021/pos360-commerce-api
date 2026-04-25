// src/routes/admin.emailPromoBlocks.routes.js
//
// Endpoints del CRM admin para los bloques promocionales.
// Mount en v1.routes:
//   safeUse("/admin/email-promo-blocks", requireAuth, attachAccessContext, adminEmailPromoBlocksRoutes);
//
// Endpoints:
//   GET    /api/v1/admin/email-promo-blocks
//   GET    /api/v1/admin/email-promo-blocks/:id
//   POST   /api/v1/admin/email-promo-blocks/bulk-from-products
//   PUT    /api/v1/admin/email-promo-blocks/:id      (solo overrides)
//   DELETE /api/v1/admin/email-promo-blocks/:id

const router = require("express").Router();

const ctrl = require("../controllers/admin.emailPromoBlocks.controller");

router.get("/", ctrl.listBlocks);
router.post("/bulk-from-products", ctrl.bulkFromProducts);
router.get("/:id", ctrl.getBlock);
router.put("/:id", ctrl.updateBlock);
router.delete("/:id", ctrl.deleteBlock);

module.exports = router;
