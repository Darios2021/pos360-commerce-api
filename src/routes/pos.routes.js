// src/routes/pos.routes.js
// ✅ COPY-PASTE FINAL COMPLETO

const router = require("express").Router();

// ==============================
// POS "context / products / createSale"
// ==============================
const posController = require("../controllers/pos.controller");

// Soportar ambos estilos de export (module.exports = {} o exports.named)
const getContext = posController.getContext || posController?.default?.getContext;
const listProductsForPos =
  posController.listProductsForPos || posController?.default?.listProductsForPos;
const createPosSale = posController.createSale || posController?.default?.createSale;

// ==============================
// POS Sales (list/stats/options/etc)
// ==============================
const posSalesController = require("../controllers/posSales.controller");

const listSales = posSalesController.listSales;
const statsSales = posSalesController.statsSales;
const optionsSellers = posSalesController.optionsSellers;
const optionsCustomers = posSalesController.optionsCustomers;
const optionsProducts = posSalesController.optionsProducts;
const getSaleById = posSalesController.getSaleById;
const createSale = posSalesController.createSale;
const deleteSale = posSalesController.deleteSale;

// ✅ NUEVO: devoluciones
const createRefund = posSalesController.createRefund;

// ==============================
// Guards para evitar [object Undefined]
// ==============================
function assertFn(name, fn) {
  if (typeof fn !== "function") {
    // eslint-disable-next-line no-console
    console.error(`❌ [pos.routes] Handler inválido: ${name} ->`, typeof fn);
    throw new Error(`POS_ROUTE_HANDLER_UNDEFINED_${name}`);
  }
}

// Validamos handlers POS context/products
assertFn("getContext", getContext);
assertFn("listProductsForPos", listProductsForPos);
assertFn("createPosSale", createPosSale);

// Validamos handlers POS sales
assertFn("listSales", listSales);
assertFn("statsSales", statsSales);
assertFn("optionsSellers", optionsSellers);
assertFn("optionsCustomers", optionsCustomers);
assertFn("optionsProducts", optionsProducts);
assertFn("getSaleById", getSaleById);
assertFn("createSale", createSale);
assertFn("deleteSale", deleteSale);

// ✅ NUEVO: validamos devoluciones
assertFn("createRefund", createRefund);

// ==============================
// ✅ ROUTES
// ==============================

// ---- POS CONTEXT (lo que te tira 404 hoy)
router.get("/context", getContext);

// ---- POS PRODUCTS (buscador / grilla)
router.get("/products", listProductsForPos);

// ---- POS CREATE SALE (el de pos.controller.js)
// Nota: lo dejo en singular para no pisar el otro createSale de /sales
router.post("/sale", createPosSale);

// ---- SALES MODULE (listado, stats, etc)
router.get("/sales", listSales);
router.get("/sales/stats", statsSales);

router.get("/sales/options/sellers", optionsSellers);
router.get("/sales/options/customers", optionsCustomers);
router.get("/sales/options/products", optionsProducts);

router.get("/sales/:id", getSaleById);
router.post("/sales", createSale);
router.delete("/sales/:id", deleteSale);

// ✅ NUEVO: registrar devolución (lo usa tu modal)
router.post("/sales/:id/refunds", createRefund);

module.exports = router;
