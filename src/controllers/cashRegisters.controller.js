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

    const user_id = getAuthUserId(req);
    const cashRegister = await getCurrentOpenCashRegister({
      branch_id,
      user_id,
    });

    // Otras cajas abiertas del mismo usuario (zombies al cambiar de sucursal).
    // El frontend las usa para avisar que hay cajas pendientes de cerrar.
    const { CashRegister } = require("../models");
    const { Op } = require("sequelize");
    const otherOpen = user_id
      ? await CashRegister.findAll({
          where: {
            opened_by: user_id,
            status: "OPEN",
            ...(cashRegister?.id
              ? { id: { [Op.ne]: cashRegister.id } }
              : {}),
          },
          attributes: ["id", "branch_id", "opened_at", "opening_cash"],
          order: [["opened_at", "ASC"]],
        })
      : [];

    // Cajas abiertas en la sucursal actual (supervisión).
    // El usuario actual las ve en modo lectura para saber quién está operando.
    // Se excluye la propia si tuviera una.
    const branchOpenRows = await sequelize.query(
      `
        SELECT
          cr.id,
          cr.branch_id,
          cr.opened_by,
          cr.opened_at,
          cr.opening_cash,
          cr.caja_type,
          cr.invoice_mode,
          cr.invoice_type,
          NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS opened_by_name,
          u.email    AS opened_by_email,
          u.username AS opened_by_username
        FROM cash_registers cr
        LEFT JOIN users u ON u.id = cr.opened_by
        WHERE cr.status = 'OPEN'
          AND cr.branch_id = :bid
          ${cashRegister?.id ? "AND cr.id <> :ownId" : ""}
        ORDER BY cr.opened_at ASC
      `,
      {
        replacements: {
          bid: branch_id,
          ...(cashRegister?.id ? { ownId: cashRegister.id } : {}),
        },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    const branchOpen = (branchOpenRows || []).map((r) => ({
      id: Number(r.id),
      branch_id: Number(r.branch_id),
      opened_by: Number(r.opened_by),
      opened_at: r.opened_at,
      opening_cash: Number(r.opening_cash || 0),
      caja_type: r.caja_type || null,
      invoice_mode: r.invoice_mode || null,
      invoice_type: r.invoice_type || null,
      opened_by_name:
        r.opened_by_name ||
        r.opened_by_username ||
        r.opened_by_email ||
        `Usuario #${r.opened_by}`,
      opened_by_email: r.opened_by_email || null,
    }));

    return res.json({
      ok: true,
      data: cashRegister || null,
      other_open_registers: otherOpen,
      branch_open_registers: branchOpen,
    });
  } catch (e) {
    console.error("[cashRegisters.getCurrent] error:", e);
    next(e);
  }
}

async function open(req, res) {
  const t = await sequelize.transaction();
  try {
    const branch_id = getAuthBranchId(req);
    const opened_by = getAuthUserId(req);

    console.log("[cashRegisters.open] input:", {
      branch_id,
      opened_by,
      body: req.body,
    });

    const opening_ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      null;

    const cashRegister = await openCashRegister({
      branch_id,
      opened_by,
      opening_cash: req.body?.opening_cash,
      opening_note: req.body?.opening_note,
      opening_ip,
      caja_type:    req.body?.caja_type,
      invoice_mode: req.body?.invoice_mode,
      invoice_type: req.body?.invoice_type,
      transaction:  t,
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

    console.error("[cashRegisters.open] error:", {
      message: e?.message,
      code: e?.code,
      status: e?.status,
      data: e?.data,
      stack: e?.stack,
      body: req.body,
    });

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

    console.log("[cashRegisters.addMovement] input:", {
      cash_register_id,
      user_id,
      body: req.body,
    });

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

    console.error("[cashRegisters.addMovement] error:", {
      message: e?.message,
      code: e?.code,
      status: e?.status,
      data: e?.data,
      stack: e?.stack,
      body: req.body,
      params: req.params,
    });

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

    console.log("[cashRegisters.getSummary] input:", {
      cash_register_id,
    });

    const summary = await buildCashRegisterSummary({ cash_register_id });

    return res.json({
      ok: true,
      data: summary,
    });
  } catch (e) {
    console.error("[cashRegisters.getSummary] error:", {
      message: e?.message,
      code: e?.code,
      status: e?.status,
      data: e?.data,
      stack: e?.stack,
      params: req.params,
    });

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

    console.log("[cashRegisters.close] input:", {
      cash_register_id,
      closed_by,
      body: req.body,
    });

    const out = await closeCashRegister({
      cash_register_id,
      closed_by,
      closing_cash:     req.body?.closing_cash,
      closing_note:     req.body?.closing_note,
      closing_declared: req.body?.closing_declared ?? null,
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

    console.error("[cashRegisters.close] error:", {
      message: e?.message,
      code: e?.code,
      status: e?.status,
      data: e?.data,
      stack: e?.stack,
      body: req.body,
      params: req.params,
    });

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