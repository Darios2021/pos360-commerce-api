const router = require("express").Router();

const authRoutes = require("./auth.routes");
const productsRoutes = require("./products.routes");
const categoriesRoutes = require("./categories.routes");
const subcategoriesRoutes = require("./subcategories.routes");
const branchesRoutes = require("./branches.routes");
const warehousesRoutes = require("./warehouses.routes");
const stockRoutes = require("./stock.routes");
// Nueva ruta para el POS
const posRoutes = require("../modules/pos/pos.routes"); 

router.use("/auth", authRoutes);
router.use("/products", productsRoutes);
router.use("/categories", categoriesRoutes);
router.use("/subcategories", subcategoriesRoutes);
router.use("/branches", branchesRoutes);
router.use("/warehouses", warehousesRoutes);
router.use("/stock", stockRoutes);

// Registro de la ruta POS
router.use("/pos", posRoutes);

module.exports = router;