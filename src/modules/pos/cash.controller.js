// src/modules/pos/cash.controller.js
const { initPosModels } = require("./pos.models");

function ok(res, data) {
  return res.json({ ok: true, ...data });
}

function fail(res, err) {
  const status = err?.status || 500;
  return res.status(status).json({ ok: false, message: err?.message || "Error" });
}

async function openCashRegister(req, res) {
  try {
    const { CashRegister } = initPosModels();

    const userId = req.user?.id ?? req.body.opened_by ?? null;
    const branchId = req.body.branch_id;

    if (!userId) return res.status(400).json({ ok: false, message: "Missing user id" });
    if (!branchId) return res.status(400).json({ ok: false, message: "Missing branch_id" });

    // opcional: impedir 2 cajas abiertas por sucursal
    const existing = await CashRegister.findOne({
      where: { branch_id: branchId, status: "OPEN" },
      order: [["id", "DESC"]],
    });
    if (existing) {
      return res.status(409).json({ ok: false, message: "Ya existe una caja OPEN para esta sucursal", cash_register: existing });
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
    const { CashRegister } = initPosModels();

    const id = req.params.id;
    const userId = req.user?.id ?? req.body.closed_by ?? null;
    if (!userId) return res.status(400).json({ ok: false, message: "Missing user id" });

    const cash = await CashRegister.findByPk(id);
    if (!cash) return res.status(404).json({ ok: false, message: "Cash register not found" });
    if (cash.status !== "OPEN") return res.status(409).json({ ok: false, message: "Cash register no está OPEN" });

    cash.status = "CLOSED";
    cash.closed_by = userId;
    cash.closing_cash = req.body.closing_cash ?? null;
    cash.closing_note = req.body.closing_note ?? null;
    cash.closed_at = new Date();
    cash.expected_cash = req.body.expected_cash ?? cash.expected_cash ?? null;
    cash.difference_cash = req.body.difference_cash ?? cash.difference_cash ?? null;

    await cash.save();

    return ok(res, { cash_register: cash });
  } catch (err) {
    return fail(res, err);
  }
}

async function createCashMovement(req, res) {
  try {
    const { CashMovement, CashRegister } = initPosModels();

    const userId = req.user?.id ?? req.body.user_id ?? null;
    if (!userId) return res.status(400).json({ ok: false, message: "Missing user id" });

    const cashRegisterId = req.body.cash_register_id;
    if (!cashRegisterId) return res.status(400).json({ ok: false, message: "Missing cash_register_id" });

    const cash = await CashRegister.findByPk(cashRegisterId);
    if (!cash) return res.status(404).json({ ok: false, message: "Cash register not found" });
    if (cash.status !== "OPEN") return res.status(409).json({ ok: false, message: "Cash register no está OPEN" });

    const type = String(req.body.type ?? "").toUpperCase();
    if (!["IN", "OUT"].includes(type)) {
      return res.status(400).json({ ok: false, message: "type debe ser IN o OUT" });
    }

    const movement = await CashMovement.create({
      cash_register_id: cashRegisterId,
      user_id: userId,
      type,
      reason: req.body.reason ?? "Movimiento",
      note: req.body.note ?? null,
      amount: req.body.amount ?? 0,
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
    if (!branchId) return res.status(400).json({ ok: false, message: "Missing branch_id" });

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
