// ✅ COPY-PASTE FINAL COMPLETO (AJUSTADO)
// src/modules/pos/cash.controller.js
const { QueryTypes } = require("sequelize");
const { initPosModels } = require("./pos.models");

function ok(res, data) {
  return res.json({ ok: true, ...data });
}

function fail(res, err) {
  const status = err?.status || 500;
  return res.status(status).json({
    ok: false,
    code: err?.code || "ERROR",
    message: err?.message || "Error",
  });
}

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round2(n) {
  return Math.round((toNum(n, 0) + Number.EPSILON) * 100) / 100;
}

/**
 * ✅ Calcula expected_cash (server-side) para un cash_register_id
 * expected_cash =
 *   opening_cash
 *   + ventas CASH (payments.method='CASH')
 *   - vuelto entregado (sales.change_total solo ventas que tengan CASH)
 *   - devoluciones CASH (sale_return_payments.method='CASH')
 *   + movimientos IN
 *   - movimientos OUT
 */
async function calcExpectedCash(sequelize, cashRegisterId) {
  // opening_cash
  const [baseRows] = await sequelize.query(
    `
    SELECT id, opening_cash
    FROM cash_registers
    WHERE id = :id
    LIMIT 1
    `,
    { type: QueryTypes.SELECT, replacements: { id: cashRegisterId } }
  );
  const base = baseRows || {};
  const openingCash = round2(base.opening_cash);

  // ventas CASH cobradas
  const [salesCashRows] = await sequelize.query(
    `
    SELECT COALESCE(SUM(p.amount),0) AS v
    FROM sales s
    JOIN payments p ON p.sale_id = s.id
    WHERE s.cash_register_id = :crid
      AND s.status IN ('PAID','REFUNDED')
      AND p.method = 'CASH'
    `,
    { type: QueryTypes.SELECT, replacements: { crid: cashRegisterId } }
  );
  const salesCash = round2(salesCashRows?.v);

  // vuelto entregado (solo ventas con cash)
  const [changeRows] = await sequelize.query(
    `
    SELECT COALESCE(SUM(s.change_total),0) AS v
    FROM sales s
    WHERE s.cash_register_id = :crid
      AND s.status IN ('PAID','REFUNDED')
      AND EXISTS (
        SELECT 1 FROM payments p
        WHERE p.sale_id = s.id AND p.method = 'CASH'
      )
    `,
    { type: QueryTypes.SELECT, replacements: { crid: cashRegisterId } }
  );
  const changeGiven = round2(changeRows?.v);

  // devoluciones CASH
  // OJO: esto depende de que existan sale_returns + sale_return_payments (vos ya las tenés)
  const [refundRows] = await sequelize.query(
    `
    SELECT COALESCE(SUM(rp.amount),0) AS v
    FROM sale_returns r
    JOIN sale_return_payments rp ON rp.return_id = r.id
    JOIN sales s ON s.id = r.sale_id
    WHERE s.cash_register_id = :crid
      AND rp.method = 'CASH'
    `,
    { type: QueryTypes.SELECT, replacements: { crid: cashRegisterId } }
  );
  const refundsCash = round2(refundRows?.v);

  // movimientos IN/OUT
  const [movRows] = await sequelize.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN cm.type='IN'  THEN cm.amount ELSE 0 END),0) AS vin,
      COALESCE(SUM(CASE WHEN cm.type='OUT' THEN cm.amount ELSE 0 END),0) AS vout
    FROM cash_movements cm
    WHERE cm.cash_register_id = :crid
    `,
    { type: QueryTypes.SELECT, replacements: { crid: cashRegisterId } }
  );
  const movementsIn = round2(movRows?.vin);
  const movementsOut = round2(movRows?.vout);

  const expected = round2(openingCash + salesCash - changeGiven - refundsCash + movementsIn - movementsOut);

  return {
    opening_cash: openingCash,
    sales_cash_collected: salesCash,
    change_given: changeGiven,
    refunds_cash_paid: refundsCash,
    movements_in: movementsIn,
    movements_out: movementsOut,
    expected_cash: expected,
  };
}

async function openCashRegister(req, res) {
  try {
    const { CashRegister } = initPosModels();

    const userId = req.user?.id ?? req.body.opened_by ?? null;
    const branchId = req.body.branch_id;

    if (!userId) return res.status(400).json({ ok: false, code: "USER_REQUIRED", message: "Missing user id" });
    if (!branchId) return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED", message: "Missing branch_id" });

    // impedir 2 cajas abiertas por sucursal
    const existing = await CashRegister.findOne({
      where: { branch_id: branchId, status: "OPEN" },
      order: [["id", "DESC"]],
    });
    if (existing) {
      return res.status(409).json({
        ok: false,
        code: "CASH_REGISTER_ALREADY_OPEN",
        message: "Ya existe una caja OPEN para esta sucursal",
        cash_register: existing,
      });
    }

    const cash = await CashRegister.create({
      branch_id: branchId,
      opened_by: userId,
      status: "OPEN",
      opening_cash: req.body.opening_cash ?? 0,
      opening_note: req.body.opening_note ?? null,
      opened_at: new Date(),
    });

    return ok(res, { cash_register: cash });
  } catch (err) {
    return fail(res, err);
  }
}

async function closeCashRegister(req, res) {
  try {
    const { sequelize, CashRegister } = initPosModels();

    const id = req.params.id;
    const userId = req.user?.id ?? req.body.closed_by ?? null;
    if (!userId) return res.status(400).json({ ok: false, code: "USER_REQUIRED", message: "Missing user id" });

    const cash = await CashRegister.findByPk(id);
    if (!cash) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Cash register not found" });
    if (cash.status !== "OPEN") return res.status(409).json({ ok: false, code: "CASH_REGISTER_NOT_OPEN", message: "Cash register no está OPEN" });

    // ✅ contado es requerido en cierre (así no se “cierra vacío” por error)
    const counted = req.body.closing_cash;
    const countedNum = Number(counted);
    if (!Number.isFinite(countedNum)) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "closing_cash requerido (efectivo contado)",
      });
    }

    // ✅ expected_cash calculado server-side
    const breakdown = await calcExpectedCash(sequelize, cash.id);
    const expected = round2(breakdown.expected_cash);
    const difference = round2(countedNum - expected);

    cash.status = "CLOSED";
    cash.closed_by = userId;
    cash.closing_cash = round2(countedNum);
    cash.closing_note = req.body.closing_note ?? null;
    cash.closed_at = new Date();

    cash.expected_cash = expected;
    cash.difference_cash = difference;

    await cash.save();

    return ok(res, {
      cash_register: cash,
      breakdown,
    });
  } catch (err) {
    return fail(res, err);
  }
}

async function createCashMovement(req, res) {
  try {
    const { CashMovement, CashRegister } = initPosModels();

    const userId = req.user?.id ?? req.body.user_id ?? null;
    if (!userId) return res.status(400).json({ ok: false, code: "USER_REQUIRED", message: "Missing user id" });

    const cashRegisterId = req.body.cash_register_id;
    if (!cashRegisterId) return res.status(400).json({ ok: false, code: "CASH_REGISTER_REQUIRED", message: "Missing cash_register_id" });

    const cash = await CashRegister.findByPk(cashRegisterId);
    if (!cash) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Cash register not found" });
    if (cash.status !== "OPEN") return res.status(409).json({ ok: false, code: "CASH_REGISTER_NOT_OPEN", message: "Cash register no está OPEN" });

    const type = String(req.body.type ?? "").toUpperCase();
    if (!["IN", "OUT"].includes(type)) {
      return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "type debe ser IN o OUT" });
    }

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "amount debe ser > 0" });
    }

    const movement = await CashMovement.create({
      cash_register_id: cashRegisterId,
      user_id: userId,
      type,
      reason: req.body.reason ?? "Movimiento",
      note: req.body.note ?? null,
      amount: round2(amount),
      happened_at: req.body.happened_at ?? new Date(),
    });

    return ok(res, { cash_movement: movement });
  } catch (err) {
    return fail(res, err);
  }
}

async function getOpenCashRegister(req, res) {
  try {
    const { CashRegister } = initPosModels();
    const branchId = req.query.branch_id;
    if (!branchId) return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED", message: "Missing branch_id" });

    const cash = await CashRegister.findOne({
      where: { branch_id: branchId, status: "OPEN" },
      order: [["id", "DESC"]],
    });

    return ok(res, { cash_register: cash ?? null });
  } catch (err) {
    return fail(res, err);
  }
}

module.exports = {
  openCashRegister,
  closeCashRegister,
  createCashMovement,
  getOpenCashRegister,
};