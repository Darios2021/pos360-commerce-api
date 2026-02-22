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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

/* =========================
   RBAC helpers
========================= */
function norm(s) {
  return String(s || "").trim();
}

function normLower(s) {
  return norm(s).toLowerCase();
}

function hasAny(list, wanted = []) {
  const set = new Set((Array.isArray(list) ? list : []).map(normLower));
  for (const w of wanted) if (set.has(normLower(w))) return true;
  return false;
}

// =========================
// Guard SAFE (lectura)
// =========================
function allowAdminOrPermission(permissionCode) {
  return (req, res, next) => {
    const a = req.access || {};

    const roles = Array.isArray(a.roles) ? a.roles : [];
    const perms = Array.isArray(a.permissions) ? a.permissions : [];

    // ✅ flags típicos
    if (a.is_super_admin) return next();
    if (a.is_admin) return next();

    // ✅ roles “admin-like” (tu RBAC a veces no usa literalmente "admin")
    const ADMIN_ROLES = [
      "admin",
      "super_admin",
      "admin_all",
      "adminall",
      "admin-all",
      "administrator",
      "root",
      "owner",
      "pos_admin",
      "posadmin",
      "admin_pos",
      "adminpos",
      "user_scope_all",
      "userscopeall",
      "admin_scope_all",
      "adminscopecall",
      "admin_scope",
      "adminscope",
      "admin_all_scope",
      "adminallscope",
      "admin_all_access",
      "adminallaccess",
      "admin_all_full",
      "adminallfull",
      "admin_all_read",
      "adminallread",
      "admin_all_view",
      "adminallview",
      "admin_all_only_view",
      "adminallonlyview",
      "admin_all_pos",
      "adminallpos",
      // variantes en mayúsculas que a veces vienen así
      "ADMIN",
      "SUPER_ADMIN",
      "ADMIN_ALL",
      "USER_SCOPE_ALL",
    ];

    if (hasAny(roles, ADMIN_ROLES)) return next();

    // ✅ permiso explícito pedido
    if (permissionCode && perms.map(normLower).includes(normLower(permissionCode))) return next();

    // ✅ fallback de “solo vista POS” para permitir leer catálogo + imágenes en POS
    // Ajustá estos códigos a tu naming real si difiere
    const POS_VIEW_PERMS = ["pos.read", "pos.view", "pos.products.read", "pos.catalog.read"];
    if (hasAny(perms, POS_VIEW_PERMS)) return next();

    return res.status(403).json({
      ok: false,
      code: "FORBIDDEN",
      message: "No tenés permisos para ver productos.",
      needed: permissionCode || null,
      roles,
      permissions: perms,
      access: {
        is_admin: !!a.is_admin,
        is_super_admin: !!a.is_super_admin,
      },
    });
  };
}

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

// ✅ Imágenes:
// - GET = LECTURA (admin / products.read / pos.view)
// - POST/DELETE = OPERAR (requireProductsOperate)
router.get("/:id/images", allowAdminOrPermission("products.read"), productImagesCtrl.listByProduct);
router.post("/:id/images", requireProductsOperate, upload.any(), productImagesCtrl.upload);
router.delete("/:id/images/:imageId", requireProductsOperate, productImagesCtrl.remove);

// ✅ GetOne
router.get("/:id", allowAdminOrPermission("products.read"), productsCtrl.getOne);

// ✅ Update (USER con sucursal permitida)
router.patch("/:id", requireProductsOperate, productsCtrl.update);

// ✅ Delete producto
router.delete("/:id", requireProductsOperate, productsCtrl.remove);

module.exports = router;