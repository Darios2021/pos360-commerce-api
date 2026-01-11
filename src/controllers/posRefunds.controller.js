// src/controllers/posRefunds.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// FIX CLAVE:
// - Si saleId no existe => 404 (no intenta insertar pagos/items)
// - INSERT sale_returns => toma insertId real (MySQL)
// - INSERT sale_return_payments SIEMPRE con return_id válido
// - Transacción atómica
// - Errores claros (sin "return_id vacío" silencioso)
//
// Requiere: models/index exporte sequelize (ya lo tenés)
// const { sequelize } = require("../models");

const { sequelize } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toFloat(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}
function pickUserId(req) {
  // compat con tus JWTs (id/userId/user_id/uid/etc.)
  const u = req.usuario || req.user || req.auth || null;
  const id =
    u?.id ??
    u?.userId ??
    u?.user_id ??
    u?.usuario_id ??
    u?.uid ??
    req?.usuario?.id ??
    null;

  const n = Number(id || 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeMethod(m) {
  const x = String(m || "CASH").trim().toUpperCase();
  const ok = new Set(["CASH", "TRANSFER", "CARD", "QR", "OTHER"]);
  return ok.has(x) ? x : "CASH";
}

async function saleExistsOrThrow(saleId, t) {
  const [rows] = await sequelize.query(
    "SELECT id, total, paid_total, status FROM sales WHERE id = ? LIMIT 1",
    { replacements: [saleId], transaction: t }
  );
  const sale = Array.isArray(rows) ? rows[0] : null;
  return sale || null;
}

async function insertSaleReturn({
  saleId,
  amount,
  restock,
  reason,
  note,
  createdBy,
  transaction,
}) {
  // MySQL -> result.insertId
  const [result] = await sequelize.query(
    `
    INSERT INTO sale_returns (sale_id, amount, restock, reason, note, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW())
    `,
    {
      replacements: [saleId, amount, restock ? 1 : 0, reason || null, note || null, createdBy],
      transaction,
    }
  );

  const returnId = result?.insertId || null;
  return returnId;
}

async function insertReturnPayment({
  returnId,
  method,
  amount,
  reference,
  note,
  transaction,
}) {
  await sequelize.query(
    `
    INSERT INTO sale_return_payments (return_id, method, amount, reference, note, created_at)
    VALUES (?, ?, ?, ?, ?, NOW())
    `,
    {
      replacements: [returnId, method, amount, reference || null, note || null],
      transaction,
    }
  );
}

async function insertReturnItems({ returnId, items, transaction }) {
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return;

  // valida + normaliza
  const values = [];
  for (const it of arr) {
    const sale_item_id = it?.sale_item_id ? toInt(it.sale_item_id, 0) : null;
    const product_id = toInt(it?.product_id, 0);
    const warehouse_id = toInt(it?.warehouse_id, 0);
    const qty = toFloat(it?.qty, 0);
    const unit_price = toFloat(it?.unit_price, 0);
    const line_total = Number((qty * unit_price).toFixed(2));

    if (!product_id || !warehouse_id) {
      throw new Error("ITEM_INVALID_PRODUCT_OR_WAREHOUSE");
    }
    if (!(qty > 0) || unit_price < 0) {
      throw new Error("ITEM_INVALID_QTY_OR_PRICE");
    }

    values.push([returnId, sale_item_id, product_id, warehouse_id, qty, unit_price, line_total]);
  }

  // bulk insert
  const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?, ?, NOW())").join(", ");
  const flat = values.flat();

  await sequelize.query(
    `
    INSERT INTO sale_return_items
      (return_id, sale_item_id, product_id, warehouse_id, qty, unit_price, line_total, created_at)
    VALUES ${placeholders}
    `,
    { replacements: flat, transaction }
  );
}

// ============================
// POST /pos/sales/:saleId/refunds
// ============================
async function createRefund(req, res, next) {
  const saleId = toInt(req.params.saleId, 0);
  if (!saleId) {
    return res.status(400).json({ ok: false, code: "BAD_SALE_ID", message: "saleId inválido" });
  }

  const amount = toFloat(req.body?.amount, 0);
  const restock = !!req.body?.restock;
  const reason = String(req.body?.reason || "").trim() || null;
  const note = String(req.body?.note || "").trim() || null;

  // aceptar method o refund_method
  const method = normalizeMethod(req.body?.method || req.body?.refund_method || "CASH");
  const reference = String(req.body?.reference || "").trim() || null;

  // opcional: items (si querés registrar items devueltos)
  const items = req.body?.items || req.body?.return_items || req.body?.returnItems || null;

  if (!(amount > 0)) {
    return res.status(400).json({ ok: false, code: "BAD_AMOUNT", message: "Monto inválido" });
  }

  const createdBy = pickUserId(req);

  const t = await sequelize.transaction();
  try {
    // 1) validar venta existe
    const sale = await saleExistsOrThrow(saleId, t);
    if (!sale) {
      await t.rollback();
      return res.status(404).json({
        ok: false,
        code: "SALE_NOT_FOUND",
        message: `No existe la venta id=${saleId} en esta base`,
      });
    }

    // 2) insertar sale_returns
    const returnId = await insertSaleReturn({
      saleId,
      amount,
      restock,
      reason,
      note,
      createdBy,
      transaction: t,
    });

    if (!returnId) {
      throw new Error("RETURN_ID_EMPTY_AFTER_INSERT");
    }

    // 3) insertar pago de reintegro (FK: return_id NOT NULL)
    await insertReturnPayment({
      returnId,
      method,
      amount,
      reference,
      note: reason || note,
      transaction: t,
    });

    // 4) opcional: items
    if (items) {
      await insertReturnItems({ returnId, items, transaction: t });
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
      },
    });
  } catch (err) {
    try {
      await t.rollback();
    } catch {}

    // si querés ver el error real en logs:
    console.error("❌ createRefund error:", err?.message || err);

    // Mensajes más útiles al front
    const msg =
      err?.message === "ITEM_INVALID_PRODUCT_OR_WAREHOUSE"
        ? "Items inválidos: falta product_id o warehouse_id"
        : err?.message === "ITEM_INVALID_QTY_OR_PRICE"
        ? "Items inválidos: qty debe ser > 0 y unit_price >= 0"
        : err?.message === "RETURN_ID_EMPTY_AFTER_INSERT"
        ? "No se pudo obtener return_id luego del INSERT (revisar DB/driver)"
        : err?.message || "Error registrando devolución";

    return res.status(500).json({
      ok: false,
      code: "REFUND_CREATE_FAILED",
      message: msg,
    });
  }
}

// ============================
// GET /pos/sales/:saleId/refunds
// ============================
async function listRefundsBySale(req, res, next) {
  const saleId = toInt(req.params.saleId, 0);
  if (!saleId) {
    return res.status(400).json({ ok: false, code: "BAD_SALE_ID", message: "saleId inválido" });
  }

  try {
    const [rows] = await sequelize.query(
      `
      SELECT
        sr.id,
        sr.sale_id,
        sr.amount,
        sr.restock,
        sr.reason,
        sr.note,
        sr.created_by,
        sr.created_at,
        -- payment “principal” (si hay varios, trae el de mayor amount)
        (
          SELECT srp.method
          FROM sale_return_payments srp
          WHERE srp.return_id = sr.id
          ORDER BY srp.amount DESC, srp.id DESC
          LIMIT 1
        ) AS refund_method,
        (
          SELECT srp.reference
          FROM sale_return_payments srp
          WHERE srp.return_id = sr.id
          ORDER BY srp.amount DESC, srp.id DESC
          LIMIT 1
        ) AS reference
      FROM sale_returns sr
      WHERE sr.sale_id = ?
      ORDER BY sr.id DESC
      `,
      { replacements: [saleId] }
    );

    return res.json({ ok: true, data: rows || [] });
  } catch (err) {
    console.error("❌ listRefundsBySale error:", err?.message || err);
    return res.status(500).json({ ok: false, code: "REFUND_LIST_FAILED", message: "Error listando devoluciones" });
  }
}

module.exports = {
  createRefund,
  listRefundsBySale,
};
