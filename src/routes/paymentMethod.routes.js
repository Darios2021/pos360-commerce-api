// ✅ COPY-PASTE FINAL COMPLETO
// src/routes/paymentMethod.routes.js

const router = require("express").Router();
const controller = require("../controllers/paymentMethod.controller");

/* =========================================================
   PUBLIC
   Se monta en /api/v1/public
   => GET /api/v1/public/payment-methods
========================================================= */
router.get("/payment-methods", controller.publicList);

/* =========================================================
   POS
   Se monta también en /api/v1/pos
   => GET /api/v1/pos/payment-methods
   Nota:
   reutilizamos publicList porque ya resuelve por branch_id
   y filtra activos. El middleware del mount ya protege auth.
========================================================= */
router.get("/payment-methods", controller.publicList);

/* =========================================================
   ADMIN
   Se monta también en /api/v1/admin
   => GET    /api/v1/admin/payment-methods
   => GET    /api/v1/admin/payment-methods/:id
   => POST   /api/v1/admin/payment-methods
   => PUT    /api/v1/admin/payment-methods/:id
   => PATCH  /api/v1/admin/payment-methods/:id/toggle-active
   => DELETE /api/v1/admin/payment-methods/:id
========================================================= */
router.get("/payment-methods", controller.adminList);
router.get("/payment-methods/:id", controller.adminGetOne);
router.post("/payment-methods", controller.adminCreate);
router.put("/payment-methods/:id", controller.adminUpdate);
router.patch("/payment-methods/:id/toggle-active", controller.adminToggleActive);
router.delete("/payment-methods/:id", controller.adminDelete);

module.exports = router;