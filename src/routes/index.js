// src/routes/index.js
const router = require("express").Router();

const authRoutes = require("./auth.routes");

// =====================
// Health (PUBLICO) - primero siempre
// =====================
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-commerce-api",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// =====================
// Resolver middleware auth sin romper el server
// (si no existe, NO crashea: devuelve 500 con mensaje)
// =====================
function resolveRequireAuth() {
  let authMw;
  try {
    authMw = require("../middlewares/auth.middleware");
  } catch (e) {
    console.error("❌ No existe ../middlewares/auth.middleware:", e?.message || e);
    return function missingAuthMw(req, res) {
      return res.status(500).json({
        ok: false,
        code: "AUTH_MW_MISSING",
        message: "Auth middleware missing: ../middlewares/auth.middleware",
      });
    };
  }

  const candidate =
    authMw?.requireAuth ||
    authMw?.authenticate ||
    authMw?.auth ||
    authMw?.authenticateToken ||
    authMw?.default ||
    authMw;

  if (typeof candidate !== "function") {
    console.error("❌ Auth middleware export NO es function. Keys:", Object.keys(authMw || {}));
    return function badAuthMw(req, res) {
      return res.status(500).json({
        ok: false,
        code: "AUTH_MW_INVALID",
        message: "Auth middleware export is not a function",
        keys: Object.keys(authMw || {}),
      });
    };
  }

  return candidate;
}

const requireAuth = resolveRequireAuth();

// =====================
// Auth (PUBLICO)
// =====================
router.use("/auth", authRoutes);

// =====================
// Uploads + imágenes + inventory (PROTEGIDO)
// =====================

// ✅ OJO: si montás /upload, adentro NO debe ser /upload otra vez.
// (Abajo te dejo uploads.routes corregido)
router.use("/upload", requireAuth, require("./uploads.routes"));

// Productos / categorías
router.use("/products", requireAuth, require("./products.routes"));
router.use("/categories", requireAuth, require("./categories.routes"));

// Import
router.use("/import", requireAuth, require("./import.routes"));

// Otros
router.use("/branches", requireAuth, require("./branches.routes"));
router.use("/warehouses", requireAuth, require("./warehouses.routes"));
router.use("/stock", requireAuth, require("./stock.routes"));

module.exports = router;
