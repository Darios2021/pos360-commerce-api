// src/routes/pos.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (ANTI-CRASH)
// - NO usa router.use() con imports dudosos
// - POST /sales va al POS rápido (pos.controller.js) si existe createSale
// - List/stats/detail/refunds/exchanges van al módulo posSales.controller.js si existen

const router = require("express").Router();

// ==============================
// POS "rápido" (context/products/createSale) => src/controllers/pos.controller.js
// ==============================
const posController = require("../controllers/pos.controller");

// soporta module.exports = {..} o export default
const getContext =
  posController.getContext || posController?.default?.getContext;

const listProductsForPos =
  posController.listProductsForPos || posController?.default?.listProductsForPos;

const createPosSale =
  posController.createSale || posController?.default?.createSale;

// (opcionales)
const createSaleReturn =
  posController.createSaleReturn || posController?.default?.createSaleReturn;

const createSaleExchange =
  posController.createSaleExchange || posController?.default?.createSaleExchange;

// ==============================
// POS Sales "módulo" (list/stats/detail/delete/refunds/exchanges) => posSales.controller.js
// ==============================
const posSalesController = require("../controllers/posSales.controller");

const listSales =
  posSalesController.listSales ||
  posSalesController.getSales ||
  posSalesController.salesList;

const statsSales =
  posSalesController.statsSales ||
  posSalesController.salesStats ||
  posSalesController.getSalesStats;

const getSaleById =
  posSalesController.getSaleById ||
  posSalesController.getSale ||
  posSalesController.saleById;

const deleteSale =
  posSalesController.deleteSale ||
  posSalesController.removeSale ||
  posSalesController.destroySale;

const createRefund =
  posSalesController.createRefund ||
  posSalesController.createSaleRefund ||
  posSalesController.refundSale;

const createExchange =
  posSalesController.createExchange ||
  posSalesController.createSaleExchange ||
  posSalesController.exchangeSale;

const listRefundsBySale =
  posSalesController.listRefundsBySale ||
  posSalesController.getRefundsBySale ||
  null;

const listExchangesBySale =
  posSalesController.listExchangesBySale ||
  posSalesController.getExchangesBySale ||
  null;

// ==============================
// OPTIONS (autocomplete) => posSalesOptions.controller.js
// ==============================
const posSalesOptionsController = require("../controllers/posSalesOptions.controller");

const optionsSellers =
  posSalesOptionsController.optionsSellers ||
  posSalesOptionsController?.default?.optionsSellers;

const optionsCustomers =
  posSalesOptionsController.optionsCustomers ||
  posSalesOptionsController?.default?.optionsCustomers;

const optionsProducts =
  posSalesOptionsController.optionsProducts ||
  posSalesOptionsController?.default?.optionsProducts;

// ==============================
// Guards SAFE (NO CRASH)
// ==============================
function notImplemented(name) {
  return (req, res) => {
    console.error(`❌ [pos.routes] Handler NO implementado: ${name}`);
    return res.status(501).json({
      ok: false,
      code: "NOT_IMPLEMENTED",
      message: `POS handler no implementado: ${name}. Revisá exports en controller.`,
      handler: name,
    });
  };
}

function safeFn(name, fn) {
  if (typeof fn === "function") return fn;
  console.error(`❌ [pos.routes] Handler inválido: ${name} ->`, typeof fn);
  return notImplemented(name);
}

// ==============================
// ✅ ROUTES
// ==============================

// ---- POS CONTEXT
router.get("/context", safeFn("getContext", getContext));

// ---- POS PRODUCTS
router.get("/products", safeFn("listProductsForPos", listProductsForPos));

/**
 * ✅ POS CREATE SALE (FRONT POS)
 * Este ES el endpoint que usa el POS:
 * - NO requiere warehouse_id por item
 * - resuelve warehouse por contexto (pos.controller.js)
 */
router.post("/sales", safeFn("createPosSale", createPosSale));

/**
 * Backoffice sale create (si lo querés)
 * (puede exigir warehouse_id por item según tu controller)
 */
router.post("/sales/backoffice", safeFn("posSalesController.createSale", posSalesController.createSale));

// ---- SALES MODULE
router.get("/sales", safeFn("listSales", listSales));
router.get("/sales/stats", safeFn("statsSales", statsSales));

router.get("/sales/:id", safeFn("getSaleById", getSaleById));
router.delete("/sales/:id", safeFn("deleteSale", deleteSale));

router.post("/sales/:id/refunds", safeFn("createRefund", createRefund));
router.post("/sales/:id/exchanges", safeFn("createExchange", createExchange));

router.get("/sales/:id/refunds", safeFn("listRefundsBySale", listRefundsBySale));
router.get("/sales/:id/exchanges", safeFn("listExchangesBySale", listExchangesBySale));

// ---- POS rápido (si existen)
router.post("/returns", safeFn("createSaleReturn", createSaleReturn));
router.post("/exchanges", safeFn("createSaleExchange", createSaleExchange));

// ---- OPTIONS
router.get("/sales/options/sellers", safeFn("optionsSellers", optionsSellers));
router.get("/sales/options/customers", safeFn("optionsCustomers", optionsCustomers));
router.get("/sales/options/products", safeFn("optionsProducts", optionsProducts));

module.exports = router;
