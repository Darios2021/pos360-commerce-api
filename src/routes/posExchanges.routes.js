// src/routes/posExchanges.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// FIX:
// - Evita crash "Route.get requires a callback but got Undefined"
// - Valida que el controller exporte funciones reales
// - Log útil si falta algo
//
// Rutas esperadas (ajustá si querés):
// POST /api/v1/pos/sales/:id/exchanges
// GET  /api/v1/pos/sales/:id/exchanges

const router = require("express").Router();

const ctrl = require("../controllers/posExchanges.controller");

// helper: asegura handler válido
function mustFn(fn, name) {
  if (typeof fn !== "function") {
    console.error("❌ [posExchanges.routes] Handler inválido:", name);
    console.error("   typeof:", typeof fn);
    console.error("   ctrl keys:", ctrl && typeof ctrl === "object" ? Object.keys(ctrl) : null);

    // En producción NO crasheamos: devolvemos handler 500 para no tumbar el servicio
    return (req, res) => {
      return res.status(500).json({
        ok: false,
        code: "EXCHANGES_ROUTE_HANDLER_MISSING",
        message: `Ruta exchanges misconfigurada: falta handler ${name}`,
      });
    };
  }
  return fn;
}

// ✅ Soporta varios nombres de export por si lo tenés distinto
const createExchange =
  ctrl.createExchange ||
  ctrl.create ||
  ctrl.createPosExchange ||
  ctrl.registerExchange ||
  null;

const listExchangesBySale =
  ctrl.listExchangesBySale ||
  ctrl.listBySale ||
  ctrl.list ||
  null;

// ===== Routes =====
router.post("/sales/:id/exchanges", mustFn(createExchange, "createExchange"));
router.get("/sales/:id/exchanges", mustFn(listExchangesBySale, "listExchangesBySale"));

module.exports = router;
