// src/controllers/posRefunds.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// FIX clave del error "return_id vacío":
// - SaleReturn.create() devuelve una instancia Sequelize -> usar createdReturn.id (NO destructuring raro)
// - Transacción atómica: sale_returns + sale_return_payments
// - Valida amount y method
// - (Opcional) setea status REFUNDED si devolvió todo lo pagado

const { sequelize, Sale, SaleReturn, SaleReturnPayment } = require("../models");

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

async function createRefund(req, res) {
  const saleId = Number(req.params.id || 0);
  if (!saleId) return res.status(400).json({ ok: false, message: "sale_id inválido" });

  const amount = toFloat(req.body?.amount, NaN);
  const restock = !!req.body?.restock;

  // compat: method o refund_method
  const method = upper(req.body?.refund_method || req.body?.method || "CASH", "CASH");

  const reference = String(req.body?.reference || "").trim() || null;
  const reason = String(req.body?.reason || "").trim() || null;
  const note = String(req.body?.note || "").trim() || null;

  const allowed = new Set(["CASH", "TRANSFER", "CARD", "QR", "OTHER"]);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ ok: false, message: "Monto inválido" });
  }
  if (!allowed.has(method)) {
    return res.status(400).json({ ok: false, message: "Método inválido" });
  }

  const createdBy = pickUserId(req);

  try {
    const out = await sequelize.transaction(async (t) => {
      const sale = await Sale.findByPk(saleId, { transaction: t });
      if (!sale) {
        const err = new Error("Venta no encontrada");
        err.status = 404;
        throw err;
      }

      const maxPaid = toFloat(sale.paid_total, 0);
      if (amount > maxPaid + 0.0001) {
        const err = new Error("El monto excede lo pagado");
        err.status = 400;
        throw err;
      }

      // ✅ 1) Crear sale_returns
      const createdReturn = await SaleReturn.create(
        {
          sale_id: saleId,
          amount,
          restock,
          reason,
          note,
          created_by: createdBy,
        },
        { transaction: t }
      );

      // ✅ FIX: id desde la instancia
      const returnId = createdReturn?.id || null;
      if (!returnId) {
        const err = new Error("No se pudo crear sale_returns (return_id vacío)");
        err.status = 500;
        throw err;
      }

      // ✅ 2) Crear sale_return_payments
      await SaleReturnPayment.create(
        {
          return_id: returnId,
          method,
          amount,
          reference,
          note: reason || note || null,
        },
        { transaction: t }
      );

      // ✅ 3) Si devolvió todo lo pagado -> marcar REFUNDED (opcional)
      if (amount >= maxPaid - 0.0001) {
        await sale.update({ status: "REFUNDED" }, { transaction: t });
      }

      return { return_id: returnId };
    });

    return res.json({ ok: true, message: "Devolución registrada", data: out });
  } catch (e) {
    const status = Number(e?.status || 500);
    return res.status(status).json({
      ok: false,
      message: e?.message || "Error registrando devolución",
    });
  }
}

module.exports = { createRefund };
