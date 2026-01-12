// src/routes/admin.shopOrders.routes.js
// ✅ Admin Shop: Orders Inbox
const router = require("express").Router();
const C = require("../controllers/admin.shopOrders.controller");

router.get("/orders", C.listOrders);
router.get("/orders/:id", C.getOrderById);

module.exports = router;
