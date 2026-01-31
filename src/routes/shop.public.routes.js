// ✅ COPY-PASTE FINAL COMPLETO
// pos360-commerce-api/src/routes/shop.public.routes.js
const router = require("express").Router();

const shopTheme = require("../controllers/shopTheme.controller");

// ... (dejá tus rutas públicas actuales)

// ✅ THEME PUBLICO (para el shop)
router.get("/theme", shopTheme.getPublicTheme);

module.exports = router;
