// src/routes/products.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (RBAC + USERS CON SUCURSAL PUEDEN CREAR)
//
// IMPORTANTE:
// - branchContext + attachAccessContext ya se aplican en v1.routes.js:
//   safeUse("/products", requireAuth, attachAccessContext, branchContext, productsRoutes);

const router = require("express").Router();
const multer = require("multer");

const productsCtrl = require("../controllers/products.controller.js");
const productImagesCtrl = require("../controllers/productImages.controller.js");

// ✅ NUEVO GUARD: permite operar si user tiene sucursal activa
const { requireProductsOperate } = require("../middlewares/productsAccess.middleware");

// =========================
// Guard SAFE (lectura)
// =========================
function allowAdminOrPermission(permissionCode) {
  return (req, res, next) => {
    const a = req.access || {};
    const roles = Array.isArray(a.roles) ? a.roles : [];
    const perms = Array.isArray(a.permissions) ? a.permissions : [];

    if (a.is_super_admin) return next();
    if (permissionCode && perms.includes(permissionCode)) return next();

    // fallback por rol
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// =========================
// --- PRODUCTOS ---
// =========================

// ✅ SIEMPRE primero rutas literales
router.get("/next-code", allowAdminOrPermission("products.read"), productsCtrl.getNextCode);

// ✅ Listado
router.get("/", allowAdminOrPermission("products.read"), productsCtrl.list);

// ✅ Crear (USER con sucursal permitida)
router.post("/", requireProductsOperate, productsCtrl.create);

// ✅ STOCK REAL por sucursal
router.get("/:id/stock", allowAdminOrPermission("products.read"), productsCtrl.getStock);

// ✅ MATRIZ REAL por sucursal
router.get("/:id/branches", allowAdminOrPermission("products.read"), productsCtrl.getBranchesMatrix);

// ✅ Imágenes: operar (USER con sucursal permitida)
router.get("/:id/images", allowAdminOrPermission("products.read"), productImagesCtrl.listByProduct);
router.post("/:id/images", requireProductsOperate, upload.any(), productImagesCtrl.upload);
router.delete("/:id/images/:imageId", requireProductsOperate, productImagesCtrl.remove);

// ✅ GetOne
router.get("/:id", allowAdminOrPermission("products.read"), productsCtrl.getOne);

// ✅ Update (USER con sucursal permitida)
router.patch("/:id", requireProductsOperate, productsCtrl.update);

// ✅ Delete producto
// Nota: tu controller remove() ya tiene requireAdmin(req,res) adentro.
// Igual lo dejo con requireProductsOperate para que si querés “soft delete” futuro por sucursal puedas,
// pero HOY el controller lo va a cortar si no es admin.
router.delete("/:id", requireProductsOperate, productsCtrl.remove);

module.exports = router;
