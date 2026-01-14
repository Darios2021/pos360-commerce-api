// src/routes/pos.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (SIN RUTAS DUPLICADAS)
//
// OBJETIVO:
// - /api/v1/pos/context + /products + ✅ POST /sales => POS rápido (pos.controller.js)
// - List/stats/detail/delete/refunds/exchanges => posSales.controller.js
//
// CLAVE:
// - ✅ POST /sales va a pos.controller.js (createSale) porque resuelve warehouse por contexto.
// - posSales.controller.js queda para list/stats/detail/refunds/exchanges.

const router = require("express").Router();

// ✅ IMPORTANTE: asegura req.ctx (branchId/warehouseId) en TODAS las rutas POS
const branchContext = require("../middlewares/branchContext.middleware");
router.use(branchContext);

// ==============================
// POS "context / products / createSale" (POS rápido)
// ==============================
const posController = require("../controllers/pos.controller");

// Soportar ambos estilos de export (module.exports = {} o exports.named)
const getContext = posController.getContext || posController?.default?.getContext;
const listProductsForPos =
  posController.listProductsForPos || posController?.default?.listProductsForPos;
const createPosSale = posController.createSale || posController?.default?.createSale;

// ✅ NUEVO: devoluciones/cambios del POS rápido (si existen)
const createSaleReturn =
  posController.createSaleReturn || posController?.default?.createSaleReturn;
const createSaleExchange =
  posController.createSaleExchange || posController?.default?.createSaleExchange;

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

// ⚠️ OJO: createSale del módulo ventas NO lo usamos para POS checkout
const createSaleBackoffice =
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

/**
 * ✅ POS CREATE SALE (FRONT POS)
 * - NO requiere warehouse_id por item
 * - resuelve warehouse por contexto
 */
router.post("/sales", safeFn("createPosSale", createPosSale));

/**
 * (Opcional) endpoint viejo del módulo ventas:
 * - Puede exigir warehouse_id por item
 */
router.post("/sales/backoffice", safeFn("createSaleBackoffice", createSaleBackoffice));

// ---- SALES MODULE (posSales.controller.js)
router.get("/sales", safeFn("listSales", listSales));
router.get("/sales/stats", safeFn("statsSales", statsSales));

router.get("/sales/:id", safeFn("getSaleById", getSaleById));
router.delete("/sales/:id", safeFn("deleteSale", deleteSale));

// ✅ Refunds/Exchanges del módulo de ventas
router.post("/sales/:id/refunds", safeFn("createRefund", createRefund));
router.post("/sales/:id/exchanges", safeFn("createExchange", createExchange));

// ✅ GET refunds/exchanges
router.get("/sales/:id/refunds", safeFn("listRefundsBySale", listRefundsBySale));
router.get("/sales/:id/exchanges", safeFn("listExchangesBySale", listExchangesBySale));

// ---- DEVOLUCIONES / CAMBIOS (si usás las NUEVAS del pos.controller.js)
router.post("/returns", safeFn("createSaleReturn", createSaleReturn));
router.post("/exchanges", safeFn("createSaleExchange", createSaleExchange));

// ---- OPTIONS (posSalesOptions.controller.js)
router.get("/sales/options/sellers", safeFn("optionsSellers", optionsSellers));
router.get("/sales/options/customers", safeFn("optionsCustomers", optionsCustomers));
router.get("/sales/options/products", safeFn("optionsProducts", optionsProducts));

module.exports = router;
