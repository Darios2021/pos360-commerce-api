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

    // 1) branch_id desde users (tu DB real)
    const [[u]] = await sequelize.query(
      `
      SELECT branch_id
      FROM users
      WHERE id = :userId
      LIMIT 1
      `,
      { replacements: { userId } }
    );

    if (!u?.branch_id) {
      return res.status(409).json({
        ok: false,
        code: "USER_WITHOUT_BRANCH",
        message: `El usuario ${userId} no tiene branch_id asignado (users).`,
      });
    }

    const branchId = Number(u.branch_id);

    // 2) Branch
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

    // 3) Warehouse default (primero por sucursal)
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

    // ✅ Contexto
    req.ctx = {
      branchId,
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

module.exports = branchContext;
