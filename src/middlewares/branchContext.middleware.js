// src/middlewares/branchContext.middleware.js
const { UserBranch, Branch, Warehouse } = require("../models");

async function branchContext(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, code: "NO_USER_IN_REQUEST" });
    }

    const ub = await UserBranch.findOne({ where: { user_id: userId } });

    if (!ub) {
      return res.status(409).json({
        ok: false,
        code: "USER_NO_BRANCH",
        message: "El usuario no tiene sucursal asignada (user_branches).",
      });
    }

    const branchId = Number(ub.branch_id);

    const wh = await Warehouse.findOne({
      where: { branch_id: branchId, is_active: 1 },
      order: [["id", "ASC"]],
    });

    if (!wh) {
      return res.status(409).json({
        ok: false,
        code: "BRANCH_NO_WAREHOUSE",
        message: "La sucursal no tiene depósito/warehouse activo.",
        branch_id: branchId,
      });
    }

    const b = await Branch.findByPk(branchId);

    req.ctx = {
      userId,
      branchId,
      branch: b ? { id: b.id, name: b.name, code: b.code } : { id: branchId },
      warehouseId: wh.id,
      warehouse: { id: wh.id, name: wh.name, code: wh.code },
    };

    return next();
  } catch (e) {
    console.error("❌ [branchContext] error:", e);
    return res.status(500).json({
      ok: false,
      code: "BRANCH_CONTEXT_ERROR",
      message: e.message,
    });
  }
}

module.exports = { branchContext };
