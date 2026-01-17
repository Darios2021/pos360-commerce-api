// src/middlewares/branchContext.middleware.js
// ✅ COPY-PASTE FINAL COMPLETO (FIX: users sin users.branch_id pero con user_branches)
// - Determina sucursal activa sin exigir users.branch_id
// - Override por X-Branch-Id:
//    - usuarios normales: solo si pertenece a user_branches
//    - super_admin: puede override a cualquier sucursal existente
// - Usa roles desde req.access.roles si existe (rbac.middleware), sino req.user.roles (token)
// - Valida sucursal existe y que tenga warehouse activo

const { sequelize } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

// ✅ role match case-insensitive y soporta string/obj/array
function rolesFromReq(req) {
  const aRoles = Array.isArray(req.access?.roles) ? req.access.roles : null;
  if (aRoles && aRoles.length) return aRoles;

  const roles = req.user?.roles;
  if (!roles) return [];

  if (Array.isArray(roles)) {
    return roles
      .map((r) => {
        if (!r) return null;
        if (typeof r === "string") return r;
        if (typeof r === "object") return r.name || r.code || r.role || null;
        return null;
      })
      .filter(Boolean);
  }

  if (typeof roles === "string") return [roles];
  return [];
}

function hasRole(req, roleName) {
  const target = String(roleName || "").toLowerCase().trim();
  const roles = rolesFromReq(req).map((r) => String(r || "").toLowerCase().trim());
  return roles.includes(target);
}

function getOverrideBranchId(req) {
  return toInt(req.headers["x-branch-id"] || req.query.branchId || req.query.branch_id, 0);
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

    const overrideBranchId = getOverrideBranchId(req);
    const isSuperAdmin = hasRole(req, "super_admin");

    // 1) Traemos branch_id del user (puede ser null) + email
    const [[u]] = await sequelize.query(
      `
      SELECT id, branch_id, email
      FROM users
      WHERE id = :userId
      LIMIT 1
      `,
      { replacements: { userId } }
    );

    if (!u?.id) {
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "Usuario no encontrado." });
    }

    const userBranchId = toInt(u.branch_id, 0);

    // 2) Branches permitidas (user_branches)
    const [ubRows] = await sequelize.query(
      `
      SELECT branch_id
      FROM user_branches
      WHERE user_id = :userId
      `,
      { replacements: { userId } }
    );

    const allowedBranchIds = (ubRows || [])
      .map((r) => toInt(r.branch_id, 0))
      .filter((x) => x > 0);

    if (!allowedBranchIds.length && !isSuperAdmin) {
      return res.status(409).json({
        ok: false,
        code: "USER_WITHOUT_BRANCHES",
        message: `El usuario ${userId} no tiene sucursales habilitadas (user_branches).`,
      });
    }

    // 3) Elegir branch activa
    // - super_admin: puede override a cualquier sucursal existente
    // - user normal: override solo si está en allowed
    let branchId = 0;

    if (overrideBranchId) {
      if (isSuperAdmin) branchId = overrideBranchId;
      else if (allowedBranchIds.includes(overrideBranchId)) branchId = overrideBranchId;
      else {
        return res.status(403).json({
          ok: false,
          code: "BRANCH_NOT_ALLOWED",
          message: `Sucursal no permitida para el usuario. userId=${userId} branchId=${overrideBranchId}`,
        });
      }
    } else {
      if (userBranchId && allowedBranchIds.includes(userBranchId)) branchId = userBranchId;
      else if (allowedBranchIds.length) branchId = allowedBranchIds[0];
      else branchId = 0; // super_admin sin allowed (lo dejamos pasar si luego existe branch)
    }

    if (!branchId) {
      return res.status(409).json({
        ok: false,
        code: "USER_WITHOUT_ACTIVE_BRANCH",
        message: `No se pudo determinar sucursal activa para userId=${userId}.`,
      });
    }

    // 4) Validar branch existe
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

    // 5) Warehouse default
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
      allowedBranchIds,
      warehouseId: toInt(wh.id, 0),
      branch,
      warehouse: wh,
      isSuperAdmin,
      overridden: Boolean(overrideBranchId),
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

module.exports = branchContext;
