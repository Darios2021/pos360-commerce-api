// src/middlewares/branchContext.middleware.js
const { sequelize } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

// ✅ role match case-insensitive y soporta string/obj/array
function hasRole(req, roleName) {
  const target = String(roleName || "").toLowerCase().trim();
  const roles = req.user?.roles;

  if (!roles) return false;

  if (Array.isArray(roles)) {
    return roles.some((r) => {
      if (!r) return false;
      if (typeof r === "string") return r.toLowerCase().trim() === target;
      if (typeof r === "object") {
        const n = String(r.name || r.code || r.role || "").toLowerCase().trim();
        return n === target;
      }
      return false;
    });
  }

  if (typeof roles === "string") return roles.toLowerCase().trim() === target;

  return false;
}

async function branchContext(req, res, next) {
  try {
    const userId = toInt(req.user?.id || req.user?.sub, 0);
    if (!userId) {
      return res.status(401).json({
        ok: false,
        code: "NO_USER_IN_TOKEN",
        message: "Token válido pero no se detectó userId (sub/id).",
      });
    }

    // ✅ Permitir override SOLO super_admin
    const isSuperAdmin = hasRole(req, "super_admin");
    const overrideBranchId = toInt(req.headers["x-branch-id"] || req.query.branchId, 0);

    // 1) Branch activa (default: users.branch_id)
    const [[u]] = await sequelize.query(
      `
      SELECT id, branch_id, email
      FROM users
      WHERE id = :userId
      LIMIT 1
      `,
      { replacements: { userId } }
    );

    let branchId = toInt(u?.branch_id, 0);
    if (!branchId) {
      return res.status(409).json({
        ok: false,
        code: "USER_WITHOUT_BRANCH",
        message: `El usuario ${userId} no tiene sucursal asignada (users.branch_id).`,
      });
    }

    if (isSuperAdmin && overrideBranchId) {
      branchId = overrideBranchId;
    }

    // 2) Validar branch permitida (user_branches)
    const [[allowed]] = await sequelize.query(
      `
      SELECT 1 AS ok
      FROM user_branches
      WHERE user_id = :userId
        AND branch_id = :branchId
      LIMIT 1
      `,
      { replacements: { userId, branchId } }
    );

    if (!allowed?.ok) {
      return res.status(403).json({
        ok: false,
        code: "BRANCH_NOT_ALLOWED",
        message: `Sucursal no permitida para el usuario. userId=${userId} branchId=${branchId}`,
      });
    }

    // 3) Cargar Branch
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

    // 4) Warehouse default
    const [[wh]] = await sequelize.query(
      `
      SELECT id, code, name, branch_id
      FROM warehouses
      WHERE branch_id = :branchId
        AND is_active = 1
      ORDER BY id ASC
      LIMIT 1
      `,
      { replacements: { branchId } }
    );

    if (!wh?.id) {
      return res.status(409).json({
        ok: false,
        code: "WAREHOUSE_NOT_FOUND",
        message: `No hay depósito activo para sucursal id=${branchId} (warehouses).`,
      });
    }

    // ✅ Contexto listo
    req.ctx = {
      userId,
      branchId,
      warehouseId: toInt(wh.id, 0),
      branch,
      warehouse: wh,
      isSuperAdmin,
      overridden: Boolean(isSuperAdmin && overrideBranchId),
    };

    // ✅ compat
    req.branch = branch;
    req.branchId = branchId;
    req.warehouse = wh;
    req.warehouseId = toInt(wh.id, 0);

    req.activeBranchId = branchId;
    req.activeWarehouseId = toInt(wh.id, 0);

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

// ✅ IMPORTANTÍSIMO: exporta UNA FUNCIÓN
module.exports = branchContext;
