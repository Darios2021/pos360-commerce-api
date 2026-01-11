// src/routes/pos.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (SIN RUTAS DUPLICADAS)
//
// OBJETIVO:
// - Este router es el ÚNICO que expone /sales/* en /api/v1/pos
// - Refunds/Exchanges salen del módulo de ventas (posSales.controller.js)
// - ✅ GET refunds/exchanges TAMBIÉN desde posSales.controller.js (FUENTE DE VERDAD)
//   para no depender de controllers opcionales que pueden faltar.
//
// IMPORTANTE:
// - NO montes otros routers que definan /sales/:id/refunds o /sales/:id/exchanges
//   (posRefunds.routes.js y posExchanges.routes.js deben quedar fuera de /pos)

const router = require("express").Router();

// ==============================
// POS "context / products / createSale" (POS rápido)
// ==============================
const posController = require("../controllers/pos.controller");

// Soportar ambos estilos de export (module.exports = {} o exports.named)
const getContext = posController.getContext || posController?.default?.getContext;
const listProductsForPos =
  posController.listProductsForPos || posController?.default?.listProductsForPos;
const createPosSale = posController.createSale || posController?.default?.createSale;

// ==============================
// POS Sales (list/stats/detail/delete/refunds/exchanges)
// ==============================
const posSalesController = require("../controllers/posSales.controller");

// Aliases robustos (por si tu controller usa otros nombres)
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

const createSale =
  posSalesController.createSale ||
  posSalesController.createSales ||
  posSalesController.newSale;

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

// ✅ GET refunds/exchanges: FUENTE DE VERDAD en posSales.controller.js
const listRefundsBySale =
  posSalesController.listRefundsBySale ||
  posSalesController.getRefundsBySale ||
  null;

const listExchangesBySale =
  posSalesController.listExchangesBySale ||
  posSalesController.getExchangesBySale ||
  null;

// ==============================
// ✅ POS Sales OPTIONS (AUTOCOMPLETE)
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
    // eslint-disable-next-line no-console
    console.error(`❌ [pos.routes] Handler NO implementado: ${name}`);
    return res.status(501).json({
      ok: false,
      message: `POS handler no implementado: ${name}. Revisá exports en controller.`,
      handler: name,
    });
  };
}

function safeFn(name, fn) {
  if (typeof fn === "function") return fn;

  // eslint-disable-next-line no-console
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

// ---- POS CREATE SALE (pos.controller.js) - POS rápido
router.post("/sale", safeFn("createPosSale", createPosSale));

// ---- SALES MODULE (posSales.controller.js)
router.get("/sales", safeFn("listSales", listSales));
router.get("/sales/stats", safeFn("statsSales", statsSales));

router.get("/sales/:id", safeFn("getSaleById", getSaleById));
router.post("/sales", safeFn("createSale", createSale));
router.delete("/sales/:id", safeFn("deleteSale", deleteSale));

// ✅ Refunds/Exchanges del módulo de ventas (NO pos.controller.js)
router.post("/sales/:id/refunds", safeFn("createRefund", createRefund));
router.post("/sales/:id/exchanges", safeFn("createExchange", createExchange));

// ✅ GET refunds/exchanges garantizado (misma fuente de verdad)
router.get("/sales/:id/refunds", safeFn("listRefundsBySale", listRefundsBySale));
router.get("/sales/:id/exchanges", safeFn("listExchangesBySale", listExchangesBySale));

// ---- OPTIONS (posSalesOptions.controller.js)
router.get("/sales/options/sellers", safeFn("optionsSellers", optionsSellers));
router.get("/sales/options/customers", safeFn("optionsCustomers", optionsCustomers));
router.get("/sales/options/products", safeFn("optionsProducts", optionsProducts));

module.exports = router;
