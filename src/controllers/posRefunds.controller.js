// src/controllers/posRefunds.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (FIX DEFINITIVO return_id vacío)
//
// PROBLEMA REAL:
// - En algunos setups Sequelize+mysql2 NO devuelve insertId de forma consistente.
// - LAST_INSERT_ID() puede dar 0 si no estás exactamente en la misma conexión,
//   o si sequelize te re-mapea el resultado.
// SOLUCIÓN:
// 1) Intentar obtener insertId desde TODOS los formatos posibles (result/meta/okpacket).
// 2) Si sigue vacío -> fallback robusto: buscar el último sale_returns.id recién insertado
//    dentro de la MISMA transacción por (sale_id + created_at ventana corta).
// 3) Transacción atómica y errores claros.

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

async function saleExists(saleId, t) {
  const [rows] = await sequelize.query(
    "SELECT id, branch_id, total, paid_total, status FROM sales WHERE id = ? LIMIT 1",
    { replacements: [saleId], transaction: t }
  );
  return Array.isArray(rows) ? rows[0] : null;
}

// ---------- helpers insertId ----------
function extractInsertId(result, meta) {
  // formatos comunes:
  // - result.insertId (OkPacket)
  // - meta.insertId
  // - result[0].insertId / meta[0].insertId
  // - QueryTypes.INSERT variants
  const candidates = [
    meta?.insertId,
    result?.insertId,
    meta?.[0]?.insertId,
    result?.[0]?.insertId,
    // a veces sequelize devuelve un array [insertId, affectedRows]
    Array.isArray(result) && typeof result[0] === "number" ? result[0] : null,
    Array.isArray(meta) && typeof meta[0] === "number" ? meta[0] : null,
  ].filter((x) => x != null);

  for (const c of candidates) {
    const n = toInt(c, 0);
    if (n > 0) return n;
  }
  return null;
}

async function fallbackFindReturnId({ saleId, amount, createdBy, transaction }) {
  // Ventana corta: el insert fue recién, y estamos dentro de la misma transacción.
  // created_by puede ser null.
  const [rows] = await sequelize.query(
    `
    SELECT id
    FROM sale_returns
    WHERE sale_id = ?
      AND amount = ?
      AND (created_by <=> ?)
      AND created_at >= (NOW() - INTERVAL 2 MINUTE)
    ORDER BY id DESC
    LIMIT 1
    `,
    {
      replacements: [saleId, amount, createdBy],
      transaction,
    }
  );

  const id = Array.isArray(rows) ? rows[0]?.id : null;
  const n = toInt(id, 0);
  return n > 0 ? n : null;
}

async function insertSaleReturn({ saleId, amount, restock, reason, note, createdBy, transaction }) {
  // 1) Insert directo (sin QueryTypes para que mysql2 devuelva OkPacket/metadata real)
  const [result, meta] = await sequelize.query(
    `
    INSERT INTO sale_returns (sale_id, amount, restock, reason, note, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW())
    `,
    {
      replacements: [
        saleId,
        amount,
        restock ? 1 : 0,
        reason || null,
        note || null,
        createdBy ?? null,
      ],
      transaction,
    }
  );

  // 2) Intentar sacar insertId del retorno del INSERT
  let returnId = extractInsertId(result, meta);

  // 3) Si sigue vacío, intentar LAST_INSERT_ID dentro de la transacción
  if (!returnId) {
    const [rows2] = await sequelize.query("SELECT LAST_INSERT_ID() AS id", { transaction });
    const id2 = Array.isArray(rows2) ? rows2[0]?.id : null;
    const n2 = toInt(id2, 0);
    if (n2 > 0) returnId = n2;
  }

  // 4) Fallback ultra robusto: buscar el registro recién creado
  if (!returnId) {
    returnId = await fallbackFindReturnId({
      saleId,
      amount,
      createdBy: createdBy ?? null,
      transaction,
    });
  }

  // 5) Debug si sigue null
  if (!returnId) {
    console.error("❌ insertSaleReturn: no pude obtener returnId", {
      saleId,
      amount,
      restock,
      reason,
      note,
      createdBy,
      insert_result: result,
      insert_meta: meta,
    });
  }

  return returnId;
}

async function insertReturnPayment({ returnId, method, amount, reference, note, transaction }) {
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

  const values = [];
  for (const it of arr) {
    const sale_item_id = it?.sale_item_id ? toInt(it.sale_item_id, 0) : null;
    const product_id = toInt(it?.product_id, 0);
    const warehouse_id = toInt(it?.warehouse_id, 0);
    const qty = toFloat(it?.qty, 0);
    const unit_price = toFloat(it?.unit_price, 0);
    const line_total = Number((qty * unit_price).toFixed(2));

    if (!product_id || !warehouse_id) throw new Error("ITEM_INVALID_PRODUCT_OR_WAREHOUSE");
    if (!(qty > 0) || unit_price < 0) throw new Error("ITEM_INVALID_QTY_OR_PRICE");

    values.push([returnId, sale_item_id, product_id, warehouse_id, qty, unit_price, line_total]);
  }

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
// POST /pos/sales/:id/refunds
// ============================
async function createRefund(req, res) {
  const saleId = toInt(req.params.id ?? req.params.saleId ?? req.params.sale_id, 0);
  if (!saleId) return res.status(400).json({ ok: false, code: "BAD_SALE_ID", message: "saleId inválido" });

  const amount = toFloat(req.body?.amount, 0);
  if (!(amount > 0)) return res.status(400).json({ ok: false, code: "BAD_AMOUNT", message: "Monto inválido" });

  const restock = req.body?.restock === false ? false : true;
  const reason = String(req.body?.reason || "").trim() || null;
  const note = String(req.body?.note || "").trim() || null;
  const method = normalizeMethod(req.body?.method || req.body?.refund_method || "CASH");
  const reference = String(req.body?.reference || "").trim() || null;
  const items = req.body?.items || req.body?.return_items || req.body?.returnItems || null;

  const createdBy = pickUserId(req);

  const t = await sequelize.transaction();
  try {
    const sale = await saleExists(saleId, t);
    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "SALE_NOT_FOUND", message: `No existe la venta id=${saleId}` });
    }

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

    await insertReturnPayment({
      returnId,
      method,
      amount,
      reference,
      note: reason || note,
      transaction: t,
    });

    if (items) {
      await insertReturnItems({ returnId, items, transaction: t });
    }

    await t.commit();

    return res.json({
      ok: true,
      message: "Devolución registrada",
      data: { return_id: returnId, sale_id: saleId, amount, method, reference },
    });
  } catch (err) {
    try { await t.rollback(); } catch {}

    console.error("❌ createRefund error:", err?.message || err, { saleId, params: req.params, body: req.body });

    const msg =
      err?.message === "ITEM_INVALID_PRODUCT_OR_WAREHOUSE"
        ? "Items inválidos: falta product_id o warehouse_id"
        : err?.message === "ITEM_INVALID_QTY_OR_PRICE"
        ? "Items inválidos: qty debe ser > 0 y unit_price >= 0"
        : err?.message === "RETURN_ID_EMPTY_AFTER_INSERT"
        ? "No se pudo obtener return_id luego del INSERT (driver/Sequelize)."
        : err?.message || "Error registrando devolución";

    return res.status(500).json({ ok: false, code: "RETURN_INSERT_FAILED", message: msg });
  }
}

// ============================
// GET /pos/sales/:id/refunds
// ============================
async function listRefundsBySale(req, res) {
  const saleId = toInt(req.params.id ?? req.params.saleId ?? req.params.sale_id, 0);
  if (!saleId) return res.status(400).json({ ok: false, code: "BAD_SALE_ID", message: "saleId inválido" });

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
