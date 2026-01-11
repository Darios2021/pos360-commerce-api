// src/controllers/posExchanges.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Stub seguro para no tumbar el backend.
// Después lo reemplazamos por la lógica real.

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

async function createExchange(req, res) {
  const saleId = toInt(req.params.id ?? req.params.saleId ?? req.params.sale_id, 0);
  if (!saleId) return res.status(400).json({ ok: false, code: "BAD_SALE_ID", message: "saleId inválido" });

  return res.status(501).json({
    ok: false,
    code: "NOT_IMPLEMENTED",
    message: "createExchange todavía no está implementado (pero el servicio está OK).",
    sale_id: saleId,
  });
}

async function listExchangesBySale(req, res) {
  const saleId = toInt(req.params.id ?? req.params.saleId ?? req.params.sale_id, 0);
  if (!saleId) return res.status(400).json({ ok: false, code: "BAD_SALE_ID", message: "saleId inválido" });

  return res.json({ ok: true, data: [] });
}

module.exports = {
  createExchange,
  listExchangesBySale,
};
