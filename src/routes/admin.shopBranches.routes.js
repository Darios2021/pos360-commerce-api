// src/routes/admin.shopBranches.routes.js
// ✅ COPY-PASTE FINAL
// Admin Ecommerce - Sucursales
// GET /api/v1/admin/shop/branches
//
// Reutiliza branches.controller.js
// Respeta RBAC ya inyectado por v1.routes.js

const router = require("express").Router();
const branchesCtrl = require("../controllers/branches.controller");

// Resolver handler automáticamente (blindado)
const handler =
  branchesCtrl.list ||
  branchesCtrl.index ||
  branchesCtrl.getAll ||
  branchesCtrl.getBranches ||
  branchesCtrl.findAll;

if (typeof handler !== "function") {
  throw new Error(
    "❌ branches.controller.js no exporta un handler compatible (list/index/getAll/getBranches/findAll)"
  );
}

router.get("/branches", handler);

module.exports = router;
