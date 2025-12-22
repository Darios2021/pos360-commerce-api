// src/middlewares/branchContext.middleware.js
const { sequelize } = require("../models");

async function branchContext(req, res, next) {
  try {
    // En tu JWT viene "sub" (lo vemos en el token que pegaste)
    const userId = Number(req.user?.id || req.user?.sub);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        code: "NO_USER_IN_TOKEN",
        message: "Token válido pero sin user id (id/sub).",
      });
    }

    // 1) Buscar branch asignada al usuario (tomamos la primera)
    const [ubRows] = await sequelize.query(
      `
      SELECT branch_id
      FROM user_branches
      WHERE user_id = :userId
      ORDER BY branch_id ASC
      LIMIT 1
      `,
      { replacements: { userId } }
    );

    const ub = ubRows?.[0];
    if (!ub?.branch_id) {
      return res.status(403).json({
        ok: false,
        code: "USER_WITHOUT_BRANCH",
        message: `El usuario ${userId} no tiene branch asignada en user_branches.`,
      });
    }

    const branchId = Number(ub.branch_id);

    // 2) Traer branch (SIN phone)
    const [branchRows] = await sequelize.query(
      `
      SELECT
        id, name, code, address, city, is_active, created_at, updated_at
      FROM branches
      WHERE id = :branchId
      LIMIT 1
      `,
      { replacements: { branchId } }
    );

    const branch = branchRows?.[0];
    if (!branch?.id) {
      return res.status(404).json({
        ok: false,
        code: "BRANCH_NOT_FOUND",
        message: `No existe branch_id=${branchId}.`,
      });
    }

    // 3) Traer depósito (1 depósito por sucursal → tomamos el primero)
    const [whRows] = await sequelize.query(
      `
      SELECT
        id, branch_id, code, name, is_active, created_at, updated_at
      FROM warehouses
      WHERE branch_id = :branchId
      ORDER BY id ASC
      LIMIT 1
      `,
      { replacements: { branchId } }
    );

    const warehouse = whRows?.[0];
    if (!warehouse?.id) {
      return res.status(409).json({
        ok: false,
        code: "WAREHOUSE_MISSING",
        message: `La sucursal ${branchId} no tiene depósito en warehouses.`,
      });
    }

    // Contexto listo para POS/Stock
    req.ctx = {
      userId,
      branchId,
      warehouseId: Number(warehouse.id),
      branch,
      warehouse,
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

module.exports = branchContext;
