// src/routes/public.routes.js
// ✅ COPY-PASTE FINAL

const router = require("express").Router();
const PublicController = require("../controllers/public.controller");

router.get("/health", (req, res) => res.json({ ok: true, scope: "ecommerce-public" }));

router.get("/branches", PublicController.listBranches);
router.get("/catalog", PublicController.listCatalog);
router.get("/products/:id", PublicController.getProductById);

// ✅ Checkout: crear pedido (sin pago todavía)
router.post("/orders", PublicController.createOrder);

module.exports = router;
