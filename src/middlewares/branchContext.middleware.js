// src/middlewares/branchContext.middleware.js
const { sequelize } = require("../models");

async function branchContext(req, res, next) {
  try {
    const userId = req.user?.id || req.user?.sub;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        code: "NO_USER_IN_TOKEN",
        message: "Token válido pero no se detectó userId (sub).",
      });
    }

    // 1) Branch del usuario (tomamos la primera)
    const [[ub]] = await sequelize.query(
      `
      SELECT branch_id
      FROM user_branches
      WHERE user_id = :userId
      ORDER BY branch_id ASC
      LIMIT 1
      `,
      { replacements: { userId } }
    );

    if (!ub?.branch_id) {
      return res.status(409).json({
        ok: false,
        code: "USER_WITHOUT_BRANCH",
        message: `El usuario ${userId} no tiene sucursal asignada (user_branches).`,
      });
    }

    const branchId = Number(ub.branch_id);

    // 2) Branch (NO pedimos phone)
    const [[branch]] = await sequelize.query(
      `
      SELECT id, name
      FROM branches
      WHERE id = :branchId
      LIMIT 1
      `,
      { replacements: { branchId } }
    );

    if (!branch?.id) {
      return res.status(409).json({
        ok: false,
        code: "BRANCH_NOT_FOUND",
        message: `Sucursal no existe: id=${branchId}`,
      });
    }

    // 3) Warehouse (1 depósito por sucursal => tomamos el primero)
    const [[wh]] = await sequelize.query(
      `
      SELECT id, name, branch_id
      FROM warehouses
      WHERE branch_id = :branchId
      ORDER BY id ASC
      LIMIT 1
      `,
      { replacements: { branchId } }
    );

    if (!wh?.id) {
      return res.status(409).json({
        ok: false,
        code: "WAREHOUSE_NOT_FOUND",
        message: `No hay depósito para sucursal id=${branchId} (warehouses).`,
      });
    }

    // ✅ Contexto listo
    req.ctx = {
      branchId: branchId,
      warehouseId: Number(wh.id),
      branch,
      warehouse: wh,
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
