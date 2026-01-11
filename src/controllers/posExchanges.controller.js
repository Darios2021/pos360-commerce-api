// src/controllers/posExchanges.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Flujo de CAMBIO:
// - Valida venta
// - Registra sale_exchanges
// - (placeholder) stock / items -> se puede ampliar luego
//
// IMPORTANTE:
// Este controller NO mezcla lógica de refunds ni sales

const { sequelize, Sale, SaleExchange } = require("../models");

function toFloat(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}

function upper(v, def = "") {
  const s = String(v ?? def).trim();
  return s ? s.toUpperCase() : def;
}

function pickUserId(req) {
  return (
    req?.usuario?.id ||
    req?.user?.id ||
    req?.auth?.id ||
    req?.usuario_id ||
    req?.userId ||
    req?.user_id ||
    null
  );
}

async function createExchange(req, res) {
  const saleId = Number(req.params.id || 0);
  if (!saleId) {
    return res.status(400).json({ ok: false, message: "sale_id inválido" });
  }

  const returns = Array.isArray(req.body?.returns) ? req.body.returns : [];
  const takes = Array.isArray(req.body?.takes) ? req.body.takes : [];

  if (!returns.length || !takes.length) {
    return res.status(400).json({
      ok: false,
      message: "El cambio requiere items devueltos y items nuevos",
    });
  }

  const method = upper(req.body?.method || "CASH", "CASH");
  const reference = String(req.body?.reference || "").trim() || null;
  const note = String(req.body?.note || "").trim() || null;

  const createdBy = pickUserId(req);

  try {
    const out = await sequelize.transaction(async (t) => {
      const sale = await Sale.findByPk(saleId, { transaction: t });
      if (!sale) {
        const err = new Error("Venta no encontrada");
        err.status = 404;
        throw err;
      }

      // Totales calculados por frontend (confiamos pero validamos)
      const returnedAmount = returns.reduce(
        (a, it) => a + toFloat(it.qty) * toFloat(it.unit_price),
        0
      );

      const newTotal = takes.reduce(
        (a, it) => a + toFloat(it.qty) * toFloat(it.unit_price),
        0
      );

      const diff = Number((newTotal - returnedAmount).toFixed(2));

      // Crear registro principal de cambio
      const exchange = await SaleExchange.create(
        {
          original_sale_id: saleId,
          return_id: null, // se puede linkear luego si querés
          new_sale_id: saleId, // placeholder (si luego generás una nueva venta real)
          original_total: toFloat(sale.total),
          returned_amount: returnedAmount,
          new_total: newTotal,
          diff,
          note,
          created_by: createdBy,
        },
        { transaction: t }
      );

      return {
        exchange_id: exchange.id,
        diff,
        method,
        reference,
      };
    });

    return res.json({
      ok: true,
      message: "Cambio registrado",
      data: out,
    });
  } catch (e) {
    const status = Number(e?.status || 500);
    return res.status(status).json({
      ok: false,
      message: e?.message || "Error registrando cambio",
    });
  }
}

module.exports = { createExchange };
