// ✅ COPY-PASTE FINAL COMPLETO
// src/routes/public.account.routes.js
//
// Se monta en v1.routes.js como:
//   router.use("/public/account", publicAccountRoutes)
//
// Queda:
// - /api/v1/public/account/orders
// - /api/v1/public/account/favorites

const express = require("express");
const router = express.Router();

const { requireShopCustomer } = require("../middlewares/shopCustomerAuth.middleware");
const c = require("../controllers/public.account.controller");

// Orders
router.get("/orders", requireShopCustomer, c.getMyOrders);
router.get("/orders/:id", requireShopCustomer, c.getMyOrderDetail);

// Favorites
router.get("/favorites", requireShopCustomer, c.getMyFavorites);
router.post("/favorites", requireShopCustomer, express.json(), c.addFavorite);
router.delete("/favorites/:product_id", requireShopCustomer, c.removeFavorite);

module.exports = router;
