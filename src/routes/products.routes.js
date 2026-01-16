// src/routes/products.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (RBAC + sin duplicar branchContext)
//
// IMPORTANTE:
// - branchContext NO va acá porque YA se aplica en v1.routes.js:
//   safeUse("/products", requireAuth, branchContext, productsRoutes);
//
// RBAC:
// - GET /                 -> products.read
// - GET /next-code        -> products.read   ✅ preview code
// - GET /:id              -> products.read
// - GET /:id/stock        -> products.read
// - GET /:id/branches     -> products.read   ✅ matriz de sucursales
// - imágenes GET          -> products.read
//
// - POST /                -> products.write
// - PATCH /:id            -> products.write
// - DELETE /:id           -> products.write
// - imágenes POST/DELETE  -> products.write
//
// SAFE fallback:
// - super_admin: pasa siempre
// - permiso presente: pasa
// - rol admin: pasa (fallback producción)

const router = require("express").Router();
const multer = require("multer");

const productsCtrl = require("../controllers/products.controller.js");
const productImagesCtrl = require("../controllers/productImages.controller.js");

// ✅ RBAC
const { attachAccessContext } = require("../middlewares/rbac.middleware");

// =========================
// Guard SAFE (no rompe prod)
// =========================
function allowAdminOrPermission(permissionCode) {
  return (req, res, next) => {
    const a = req.access || {};
    const roles = Array.isArray(a.roles) ? a.roles : [];
    const perms = Array.isArray(a.permissions) ? a.permissions : [];

    if (a.is_super_admin) return next();
    if (permissionCode && perms.includes(permissionCode)) return next();

    // ✅ fallback por rol (por si role_permissions no está completo en prod)
    if (roles.includes("admin")) return next();

    return res.status(403).json({
      ok: false,
      code: "FORBIDDEN",
      message: "No tenés permisos para operar productos.",
      needed: permissionCode || null,
      roles,
      permissions: perms,
    });
  };
}

// 1) Adjunta contexto RBAC (roles/permisos/branches)
router.use(attachAccessContext);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// =========================
// --- PRODUCTOS ---
// =========================
router.get("/", allowAdminOrPermission("products.read"), productsCtrl.list);

// ✅ PREVIEW del próximo código (IMPORTANTE: antes de /:id)
router.get("/next-code", allowAdminOrPermission("products.read"), productsCtrl.getNextCode);

router.post("/", allowAdminOrPermission("products.write"), productsCtrl.create);

// ✅ STOCK REAL por sucursal
// GET /api/v1/products/:id/stock?branch_id=3
router.get("/:id/stock", allowAdminOrPermission("products.read"), productsCtrl.getStock);

// ✅ MATRIZ REAL por sucursal (para UI de reparto/asignación)
// GET /api/v1/products/:id/branches
router.get("/:id/branches", allowAdminOrPermission("products.read"), productsCtrl.getBranchesMatrix);

router.get("/:id", allowAdminOrPermission("products.read"), productsCtrl.getOne);

router.patch("/:id", allowAdminOrPermission("products.write"), productsCtrl.update);

// ✅ DELETE producto
router.delete("/:id", allowAdminOrPermission("products.write"), productsCtrl.remove);

// =========================
// --- IMÁGENES ---
// =========================
router.get("/:id/images", allowAdminOrPermission("products.read"), productImagesCtrl.listByProduct);

router.post("/:id/images", allowAdminOrPermission("products.write"), upload.any(), productImagesCtrl.upload);

// ✅ borrar una imagen por id
router.delete("/:id/images/:imageId", allowAdminOrPermission("products.write"), productImagesCtrl.remove);

module.exports = router;
