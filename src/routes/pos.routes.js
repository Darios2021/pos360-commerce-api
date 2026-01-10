// src/routes/pos.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// FIX:
// - NO se cae el backend si falta un handler
// - /sales/options/* va al controller correcto: posSalesOptions.controller.js

const router = require("express").Router();

// ==============================
// POS "context / products / createSale / returns / exchanges"
// ==============================
const posController = require("../controllers/pos.controller");

// Soportar ambos estilos de export (module.exports = {} o exports.named)
const getContext = posController.getContext || posController?.default?.getContext;
const listProductsForPos =
  posController.listProductsForPos || posController?.default?.listProductsForPos;
const createPosSale = posController.createSale || posController?.default?.createSale;

// ✅ NUEVO: devoluciones/cambios (pos.controller.js)
const createSaleReturn =
  posController.createSaleReturn || posController?.default?.createSaleReturn;

const createSaleExchange =
  posController.createSaleExchange || posController?.default?.createSaleExchange;

// ==============================
// POS Sales (list/stats/detail/delete)
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

// ==============================
// ✅ POS Sales OPTIONS (AUTOCOMPLETE) -> controller dedicado
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

// ---- POS CREATE SALE (pos.controller.js)
router.post("/sale", safeFn("createPosSale", createPosSale));

// ---- POS RETURNS / EXCHANGES (pos.controller.js)
router.post("/sales/:id/refunds", safeFn("createSaleReturn", createSaleReturn));
router.post("/sales/:id/exchanges", safeFn("createSaleExchange", createSaleExchange));

// ---- SALES MODULE (posSales.controller.js)
router.get("/sales", safeFn("listSales", listSales));
router.get("/sales/stats", safeFn("statsSales", statsSales));

router.get("/sales/:id", safeFn("getSaleById", getSaleById));
router.post("/sales", safeFn("createSale", createSale));
router.delete("/sales/:id", safeFn("deleteSale", deleteSale));

// ---- OPTIONS (posSalesOptions.controller.js) ✅
router.get("/sales/options/sellers", safeFn("optionsSellers", optionsSellers));
router.get("/sales/options/customers", safeFn("optionsCustomers", optionsCustomers));
router.get("/sales/options/products", safeFn("optionsProducts", optionsProducts));

module.exports = router;
