// src/routes/public.routes.js
// ✅ COPY-PASTE FINAL
// Rutas públicas Ecommerce (taxonomía + catálogo + sugerencias + producto + branding)

const express = require("express");
const router = express.Router();

const PublicController = require("../controllers/public.controller");

// Health
router.get("/health", (req, res) => res.json({ ok: true, scope: "public" }));

// Taxonomía
router.get("/categories", PublicController.listCategories);
router.get("/subcategories", PublicController.listSubcategories);

// Sucursales
router.get("/branches", PublicController.listBranches);

// Catálogo
router.get("/catalog", PublicController.listCatalog);

// ✅ Sugerencias (autocomplete tipo ML)
router.get("/suggestions", PublicController.listSuggestions);

// ✅ Branding (logo + favicon + nombre tienda)
router.get("/shop/branding", PublicController.getShopBranding);

// Producto
router.get("/products/:id", PublicController.getProductById);

module.exports = router;
