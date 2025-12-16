const express = require("express");

const authRoutes = require("./auth.routes");
const productsRoutes = require("./products.routes");
const categoriesRoutes = require("./categories.routes");
const stockRoutes = require("./stock.routes");

const router = express.Router();

// Health
router.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Auth
router.use("/auth", authRoutes);

// Core
router.use("/products", productsRoutes);
router.use("/categories", categoriesRoutes);
router.use("/stock", stockRoutes);

module.exports = router;
