// src/routes/admin.shopOrders.routes.js
// ✅ COPY-PASTE FINAL (alineado a v1.routes.js)
//
// Se monta así en v1.routes.js:
// safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopOrdersRoutes);
//
// Por eso ACÁ ADENTRO las rutas van SIN "/admin/shop":
// - GET  /orders
// - GET  /orders/:id

const router = require("express").Router();
const ctrl = require("../controllers/admin.shopOrders.controller");

function mustFn(fn, name) {
  if (typeof fn !== "function") {
    console.error(`❌ admin.shopOrders: handler inválido "${name}" ->`, typeof fn);
    throw new Error(`INVALID_HANDLER_${name}`);
  }
}

mustFn(ctrl.listOrders, "listOrders");
mustFn(ctrl.getOrderById, "getOrderById");

function allowAdminOnly() {
  return (req, res, next) => {
    const a = req.access || {};
    const roles = Array.isArray(a.roles) ? a.roles : [];

    if (a.is_super_admin) return next();
    if (roles.includes("admin")) return next();

    return res.status(403).json({
      ok: false,
      code: "FORBIDDEN",
      message: "No tenés permisos para ver pedidos del shop.",
      roles,
    });
  };
}

// ✅ OJO: SIN /admin/shop acá
router.get("/orders", allowAdminOnly(), ctrl.listOrders);
router.get("/orders/:id", allowAdminOnly(), ctrl.getOrderById);

module.exports = router;
