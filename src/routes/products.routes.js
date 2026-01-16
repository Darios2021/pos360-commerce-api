// src/routes/products.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (RBAC + orden correcto de rutas)
//
// IMPORTANTE:
// - branchContext NO va acá porque YA se aplica en v1.routes.js:
//   safeUse("/products", requireAuth, branchContext, productsRoutes);

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

// ✅ SIEMPRE primero rutas literales (para que NO las agarre /:id)
router.get("/next-code", allowAdminOrPermission("products.read"), productsCtrl.getNextCode);

// ✅ Listado
router.get("/", allowAdminOrPermission("products.read"), productsCtrl.list);

// ✅ Crear
router.post("/", allowAdminOrPermission("products.write"), productsCtrl.create);

// ✅ STOCK REAL por sucursal
// GET /api/v1/products/:id/stock?branch_id=3
router.get("/:id/stock", allowAdminOrPermission("products.read"), productsCtrl.getStock);

// ✅ MATRIZ REAL por sucursal
// GET /api/v1/products/:id/branches
router.get("/:id/branches", allowAdminOrPermission("products.read"), productsCtrl.getBranchesMatrix);

// ✅ Imágenes (GET/POST) antes de /:id (no es obligatorio, pero queda prolijo)
router.get("/:id/images", allowAdminOrPermission("products.read"), productImagesCtrl.listByProduct);
router.post("/:id/images", allowAdminOrPermission("products.write"), upload.any(), productImagesCtrl.upload);
router.delete("/:id/images/:imageId", allowAdminOrPermission("products.write"), productImagesCtrl.remove);

// ✅ GetOne (siempre al final de las rutas paramétricas)
router.get("/:id", allowAdminOrPermission("products.read"), productsCtrl.getOne);

// ✅ Update
router.patch("/:id", allowAdminOrPermission("products.write"), productsCtrl.update);

// ✅ Delete producto
router.delete("/:id", allowAdminOrPermission("products.write"), productsCtrl.remove);

module.exports = router;
