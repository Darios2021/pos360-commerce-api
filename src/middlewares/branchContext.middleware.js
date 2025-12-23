// src/middlewares/branchContext.middleware.js
const { sequelize } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function hasRole(req, roleName) {
  const roles = req.user?.roles;
  if (!roles) return false;

  // roles puede venir como array de strings o array de objetos
  if (Array.isArray(roles)) {
    return roles.some((r) => {
      if (typeof r === "string") return r === roleName;
      if (r && typeof r === "object") return r.name === roleName || r.code === roleName;
      return false;
    });
  }

  // roles puede venir como string único
  if (typeof roles === "string") return roles === roleName;
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

    // ✅ Permitir override del contexto (solo super_admin)
    // - Header: x-branch-id: 3
    // - Query:  ?branchId=3
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

    // Si es super_admin y mandó overrideBranchId válido, usamos ese contexto (NO persistimos acá)
    if (isSuperAdmin && overrideBranchId) {
      branchId = overrideBranchId;
    }

    // 2) Validar que la branch esté permitida para el usuario (user_branches)
    //    - super_admin: validamos igual (para no dejar branchId a cualquiera accidentalmente),
    //      pero como ya le asignamos todas, pasa.
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

    // 3) Cargar Branch (nota: en tu DB branches parece NO tener code/address/city; lo dejamos a prueba de fallos)
    //    Si esos campos no existen, el query fallaría.
    //    Entonces pedimos SOLO lo seguro: id, name.
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

    // 4) Warehouse default de la sucursal (el primero activo)
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

    // ✅ Contexto listo (nombres estándar)
    req.ctx = {
      userId,
      branchId,
      warehouseId: toInt(wh.id, 0),
      branch,
      warehouse: wh,
      isSuperAdmin,
      overridden: Boolean(isSuperAdmin && overrideBranchId),
    };

    // ✅ compat con controladores existentes
    req.branch = branch;
    req.branchId = branchId;
    req.warehouse = wh;
    req.warehouseId = toInt(wh.id, 0);

    // ✅ nombres “claros” para queries nuevas
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

module.exports = branchContext;
