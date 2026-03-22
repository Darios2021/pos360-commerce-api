// src/controllers/cashRegisters.controller.js
const {
  sequelize,
  getAuthUserId,
  getAuthBranchId,
  getCurrentOpenCashRegister,
  openCashRegister,
  createManualCashMovement,
  buildCashRegisterSummary,
  closeCashRegister,
} = require("../services/cashRegister.service");

async function getCurrent(req, res, next) {
  try {
    const branch_id = getAuthBranchId(req);

    if (!branch_id) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal activa.",
      });
    }

    const cashRegister = await getCurrentOpenCashRegister({ branch_id });

    return res.json({
      ok: true,
      data: cashRegister || null,
    });
  } catch (e) {
    next(e);
  }
}

async function open(req, res) {
  const t = await sequelize.transaction();
  try {
    const branch_id = getAuthBranchId(req);
    const opened_by = getAuthUserId(req);

    const cashRegister = await openCashRegister({
      branch_id,
      opened_by,
      opening_cash: req.body?.opening_cash,
      opening_note: req.body?.opening_note,
      caja_type: req.body?.caja_type,
      invoice_mode: req.body?.invoice_mode,
      invoice_type: req.body?.invoice_type,
      transaction: t,
    });

    await t.commit();

    return res.status(201).json({
      ok: true,
      message: "Caja abierta correctamente.",
      data: cashRegister,
    });
  } catch (e) {
    try {
      await t.rollback();
    } catch {}
    return res.status(e.status || 500).json({
      ok: false,
      code: e.code || "CASH_REGISTER_OPEN_ERROR",
      message: e.message || "No se pudo abrir la caja.",
      data: e.data || null,
    });
  }
}

async function addMovement(req, res) {
  const t = await sequelize.transaction();
  try {
    const cash_register_id = req.params.id;
    const user_id = getAuthUserId(req);

    const movement = await createManualCashMovement({
      cash_register_id,
      user_id,
      type: req.body?.type,
      reason: req.body?.reason,
      note: req.body?.note,
      amount: req.body?.amount,
      transaction: t,
    });

    await t.commit();

    return res.status(201).json({
      ok: true,
      message: "Movimiento de caja registrado.",
      data: movement,
    });
  } catch (e) {
    try {
      await t.rollback();
    } catch {}
    return res.status(e.status || 500).json({
      ok: false,
      code: e.code || "CASH_MOVEMENT_ERROR",
      message: e.message || "No se pudo registrar el movimiento.",
      data: e.data || null,
    });
  }
}

async function getSummary(req, res) {
  try {
    const cash_register_id = req.params.id;
    const summary = await buildCashRegisterSummary({ cash_register_id });

    return res.json({
      ok: true,
      data: summary,
    });
  } catch (e) {
    return res.status(e.status || 500).json({
      ok: false,
      code: e.code || "CASH_REGISTER_SUMMARY_ERROR",
      message: e.message || "No se pudo obtener el resumen de caja.",
      data: e.data || null,
    });
  }
}

async function close(req, res) {
  const t = await sequelize.transaction();
  try {
    const cash_register_id = req.params.id;
    const closed_by = getAuthUserId(req);

    const out = await closeCashRegister({
      cash_register_id,
      closed_by,
      closing_cash: req.body?.closing_cash,
      closing_note: req.body?.closing_note,
      transaction: t,
    });

    await t.commit();

    return res.json({
      ok: true,
      message: "Caja cerrada correctamente.",
      data: out,
    });
  } catch (e) {
    try {
      await t.rollback();
    } catch {}
    return res.status(e.status || 500).json({
      ok: false,
      code: e.code || "CASH_REGISTER_CLOSE_ERROR",
      message: e.message || "No se pudo cerrar la caja.",
      data: e.data || null,
    });
  }
}

module.exports = {
  getCurrent,
  open,
  addMovement,
  getSummary,
  close,
};