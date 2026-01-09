// src/routes/pos.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// FIX CRÍTICO:
// - Antes: assertFn() tiraba error y CAÍA EL BACKEND si un handler era undefined.
// - Ahora: NO se cae. Si falta un handler:
//   - loguea el problema
//   - responde 501 "Not implemented" (y el resto del server sigue arriba)
//
// Además:
// - Soporta exports "named" y "default".
// - Soporta aliases comunes (statsSales vs salesStats, etc.)

const router = require("express").Router();

// ==============================
// POS "context / products / createSale"
// ==============================
const posController = require("../controllers/pos.controller");

// Soportar ambos estilos de export (module.exports = {} o exports.named)
const getContext =
  posController.getContext || posController?.default?.getContext;

const listProductsForPos =
  posController.listProductsForPos || posController?.default?.listProductsForPos;

const createPosSale =
  posController.createSale || posController?.default?.createSale;

// ==============================
// POS Sales (list/stats/options/etc)
// ==============================
const posSalesController = require("../controllers/posSales.controller");

// Aliases robustos (por si tu controller usa otros nombres)
const listSales =
  posSalesController.listSales ||
  posSalesController.getSales ||
  posSalesController.salesList;

const statsSales =
  posSalesController.statsSales || // tu ruta actual
  posSalesController.salesStats || // otra convención
  posSalesController.getSalesStats;

const optionsSellers =
  posSalesController.optionsSellers ||
  posSalesController.optionsSeller ||
  posSalesController.getOptionsSellers ||
  posSalesController.sellersOptions ||
  posSalesController.optionsVendors;

const optionsCustomers =
  posSalesController.optionsCustomers ||
  posSalesController.getOptionsCustomers ||
  posSalesController.customersOptions ||
  posSalesController.optionsClients;

const optionsProducts =
  posSalesController.optionsProducts ||
  posSalesController.getOptionsProducts ||
  posSalesController.productsOptions;

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

// ✅ Opcionales (no deben tumbar server)
const createRefund =
  posSalesController.createRefund ||
  posSalesController.createSaleRefund ||
  posSalesController.refundSale;

const createExchange =
  posSalesController.createExchange ||
  posSalesController.createSaleExchange ||
  posSalesController.exchangeSale;

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

// ---- POS CREATE SALE (pos.controller.js)
router.post("/sale", safeFn("createPosSale", createPosSale));

// ---- SALES MODULE
router.get("/sales", safeFn("listSales", listSales));
router.get("/sales/stats", safeFn("statsSales", statsSales));

router.get("/sales/options/sellers", safeFn("optionsSellers", optionsSellers));
router.get("/sales/options/customers", safeFn("optionsCustomers", optionsCustomers));
router.get("/sales/options/products", safeFn("optionsProducts", optionsProducts));

router.get("/sales/:id", safeFn("getSaleById", getSaleById));
router.post("/sales", safeFn("createSale", createSale));
router.delete("/sales/:id", safeFn("deleteSale", deleteSale));

// ---- DEVOLUCIONES (si existe handler)
if (typeof createRefund === "function") {
  router.post("/sales/:id/refunds", createRefund);
} else {
  // eslint-disable-next-line no-console
  console.warn(
    "⚠️ [pos.routes] createRefund NO está exportado -> no se registra /sales/:id/refunds"
  );
}

// ---- CAMBIOS (si existe handler)
if (typeof createExchange === "function") {
  router.post("/sales/:id/exchanges", createExchange);
} else {
  // eslint-disable-next-line no-console
  console.warn(
    "⚠️ [pos.routes] createExchange NO está exportado -> no se registra /sales/:id/exchanges"
  );
}

module.exports = router;
