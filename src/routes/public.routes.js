// src/routes/public.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
// Rutas públicas Ecommerce (taxonomía + catálogo + sugerencias + producto + branding)
// ✅ + /products/:id/media (imágenes para card sin branch_id / sin auth)

const express = require("express");
const router = express.Router();

const PublicController = require("../controllers/public.controller");

function mustFn(fn, name) {
  if (typeof fn !== "function") {
    // eslint-disable-next-line no-console
    console.error(`❌ public.routes: handler inválido "${name}" ->`, typeof fn);
    throw new Error(`INVALID_HANDLER_${name}`);
  }
}

// ✅ Validación fuerte (si falta algo, lo ves en logs)
mustFn(PublicController.listCategories, "listCategories");
mustFn(PublicController.listSubcategories, "listSubcategories");
mustFn(PublicController.listBranches, "listBranches");
mustFn(PublicController.listCatalog, "listCatalog");
mustFn(PublicController.listSuggestions, "listSuggestions");
mustFn(PublicController.getShopBranding, "getShopBranding");
mustFn(PublicController.getProductById, "getProductById");
mustFn(PublicController.getProductMedia, "getProductMedia");

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

// Producto (detalle: requiere branch_id)
router.get("/products/:id", PublicController.getProductById);

// ✅ NUEVO: media pública para ProductCard (NO branch_id)
router.get("/products/:id/media", PublicController.getProductMedia);

module.exports = router;
