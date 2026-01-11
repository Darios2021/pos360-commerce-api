// src/controllers/posRefunds.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (FIX return_id vacío)
//
// FIX:
// - Obtiene el PK real del modelo con SaleReturn.primaryKeyAttribute
// - Soporta PK = "id" o "return_id" o lo que sea
// - Si sigue sin PK, hace fallback a dataValues y si no, revienta ANTES de insertar payments

const { sequelize, Sale, SaleReturn, SaleReturnPayment, SaleReturnItem } = require("../models");

function toFloat(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}

function toBool(v, d = false) {
  if (v === true || v === false) return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "y", "si", "sí"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return d;
}

function normMethod(v) {
  const m = String(v ?? "").trim().toUpperCase();
  const allowed = new Set(["CASH", "TRANSFER", "CARD", "QR", "OTHER"]);
  return allowed.has(m) ? m : "CASH";
}

function getReqUserId(req) {
  return (
    req?.usuario?.id ||
    req?.user?.id ||
    req?.userId ||
    req?.usuario_id ||
    req?.uid ||
    null
  );
}

function getPkValue(instance, Model) {
  if (!instance) return null;

  const pkAttr =
    Model?.primaryKeyAttribute ||
    (Array.isArray(Model?.primaryKeyAttributes) ? Model.primaryKeyAttributes[0] : null) ||
    "id";

  // Intentar por getters/prop directo
  let v =
    instance?.get?.(pkAttr) ??
    instance?.[pkAttr] ??
    instance?.dataValues?.[pkAttr] ??
    null;

  // Fallbacks comunes
  if (v == null) {
    v =
      instance?.get?.("id") ??
      instance?.id ??
      instance?.dataValues?.id ??
      instance?.get?.("return_id") ??
      instance?.return_id ??
      instance?.dataValues?.return_id ??
      null;
  }

  // Normalizar a número si aplica
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;

  // Si no es numérico, igual devolver (por si PK es UUID)
  return v || null;
}

async function createRefund(req, res, next) {
  const t = await sequelize.transaction();
  try {
    const saleId = Number(req.params.id || 0);
    if (!saleId) {
      await t.rollback();
      return res.status(400).json({ ok: false, message: "sale id inválido" });
    }

    const amount = toFloat(req.body?.amount, 0);
    if (!(amount > 0)) {
      await t.rollback();
      return res.status(400).json({ ok: false, message: "Monto inválido" });
    }

    const restock = toBool(req.body?.restock, false);
    const reason = String(req.body?.reason ?? "").trim();
    const note = String(req.body?.note ?? "").trim();

    const method = normMethod(req.body?.method ?? req.body?.refund_method);
    const referenceRaw = req.body?.reference;
    const reference = referenceRaw == null ? null : String(referenceRaw).trim() || null;

    const createdBy = getReqUserId(req);

    const sale = await Sale.findByPk(saleId, { transaction: t });
    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, message: `Venta no encontrada: ${saleId}` });
    }

    // ✅ Crear devolución
    const ret = await SaleReturn.create(
      {
        sale_id: saleId,
        amount,
        restock,
        reason: reason || null,
        note: note || null,
        created_by: createdBy,
      },
      { transaction: t }
    );

    // ✅ PK real del modelo (NO asumir "id")
    const returnId = getPkValue(ret, SaleReturn);

    if (!returnId) {
      // Debug útil (sale en logs de CapRover)
      console.error("❌ SaleReturn creado pero sin PK detectable", {
        pkAttr: SaleReturn?.primaryKeyAttribute,
        pkAttrs: SaleReturn?.primaryKeyAttributes,
        dataValuesKeys: ret?.dataValues ? Object.keys(ret.dataValues) : null,
        dataValues: ret?.dataValues,
      });

      throw new Error("No se pudo crear sale_returns (return_id vacío)");
    }

    // ✅ Payment asociado
    await SaleReturnPayment.create(
      {
        return_id: returnId, // <- clave
        method,
        amount,
        reference,
        note: note || reason || null,
      },
      { transaction: t }
    );

    // ✅ (Opcional) items
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length) {
      for (const it of items) {
        const saleItemId = Number(it.sale_item_id || 0) || null;
        const productId = Number(it.product_id || 0) || null;
        const warehouseId = Number(it.warehouse_id || 0) || null;
        const qty = toFloat(it.qty, 0);
        const unitPrice = toFloat(it.unit_price, 0);
        if (!productId || !warehouseId || !(qty > 0)) continue;

        await SaleReturnItem.create(
          {
            return_id: returnId,
            sale_item_id: saleItemId,
            product_id: productId,
            warehouse_id: warehouseId,
            qty,
            unit_price: unitPrice,
            line_total: Number((qty * unitPrice).toFixed(2)),
          },
          { transaction: t }
        );
      }
    }

    await t.commit();

    return res.json({
      ok: true,
      message: "Devolución registrada",
      data: {
        return_id: returnId,
        sale_id: saleId,
        amount,
        method,
        reference,
        restock,
      },
    });
  } catch (err) {
    try {
      await t.rollback();
    } catch {}
    return next(err);
  }
}

module.exports = { createRefund };
