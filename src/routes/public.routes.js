// src/routes/public.routes.js
// ✅ COPY-PASTE FINAL
// Rutas públicas para Ecommerce (taxonomía + catálogo)

const express = require("express");
const router = express.Router();

const PublicController = require("../controllers/public.controller");

// Health simple
router.get("/health", (req, res) => res.json({ ok: true, scope: "public" }));

// ✅ Taxonomía (como MercadoLibre)
// Rubros (padres)
router.get("/categories", PublicController.listCategories);
// Subrubros (hijos de category_id)
router.get("/subcategories", PublicController.listSubcategories);

// Sucursales activas
router.get("/branches", PublicController.listBranches);

// Catálogo (con filtros)
router.get("/catalog", PublicController.listCatalog);

// Detalle producto (por sucursal)
router.get("/products/:id", PublicController.getProductById);

// Crear pedido Ecommerce (sin pago) (si ya lo usás)
router.post("/orders", PublicController.createOrder);

module.exports = router;
