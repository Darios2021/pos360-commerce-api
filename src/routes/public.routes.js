// src/routes/public.routes.js
// ✅ COPY-PASTE FINAL
// Rutas públicas para Ecommerce (catálogo, sucursales, taxonomía, sugerencias, detalle producto)

const express = require("express");
const router = express.Router();

const PublicController = require("../controllers/public.controller");

// Health simple (opcional)
router.get("/health", (req, res) => res.json({ ok: true, scope: "public" }));

// ✅ Taxonomía
router.get("/categories", PublicController.listCategories);
router.get("/subcategories", PublicController.listSubcategories);

// ✅ Sucursales activas
router.get("/branches", PublicController.listBranches);

// ✅ Catálogo
router.get("/catalog", PublicController.listCatalog);

// ✅ Autocomplete / sugerencias (MercadoLibre style)
router.get("/suggestions", PublicController.listSuggestions);

// ✅ Detalle producto
router.get("/products/:id", PublicController.getProductById);

module.exports = router;
