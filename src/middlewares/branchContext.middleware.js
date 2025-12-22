// src/middlewares/branchContext.middleware.js
const { sequelize } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

async function branchContext(req, res, next) {
  try {
    const userId = toInt(req.user?.id || req.user?.sub, 0);
    if (!userId) {
      return res.status(401).json({
        ok: false,
        code: "NO_USER_IN_TOKEN",
        message: "Token válido pero no se detectó userId (sub).",
      });
    }

    // 1) Branch del usuario (users.branch_id)
    const [[u]] = await sequelize.query(
      `
      SELECT branch_id
      FROM users
      WHERE id = :userId
      LIMIT 1
      `,
      { replacements: { userId } }
    );

    const branchId = toInt(u?.branch_id, 0);
    if (!branchId) {
      return res.status(409).json({
        ok: false,
        code: "USER_WITHOUT_BRANCH",
        message: `El usuario ${userId} no tiene sucursal asignada (users.branch_id).`,
      });
    }

    // 2) Branch
    const [[branch]] = await sequelize.query(
      `
      SELECT id, name, code, address, city
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

    // 3) Warehouse default de la sucursal (el primero)
    const [[wh]] = await sequelize.query(
      `
      SELECT id, code, name, branch_id
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
      branchId,
      warehouseId: toInt(wh.id, 0),
      branch,
      warehouse: wh,
    };

    // ✅ compat para controladores que miran otros nombres
    req.branch = branch;
    req.branchId = branchId;
    req.warehouse = wh;
    req.warehouseId = toInt(wh.id, 0);

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
