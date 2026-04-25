// src/utils/accessScope.js
//
// Helper único para resolver el ámbito de acceso de un request.
//
// Roles reconocidos:
//   - super_admin / superadmin / root / owner → ven TODO el sistema (global).
//   - admin                                   → ven TODA su sucursal (branch-scoped).
//                                                Pueden eliminar / modificar dentro
//                                                de las branches habilitadas.
//   - cajero / cashier / vendedor / seller    → ven SOLO sus propios datos
//                                                (sus ventas, su caja, etc.).
//   - cualquier otro rol asume "user" (= cajero) por seguridad.
//
// Notas:
//   - Las branches habilitadas vienen del middleware branchContext
//     (req.ctx.branchId + req.ctx.allowedBranchIds).
//   - super_admin nunca queda atrapado por scope; ve todo.
//   - admin puede tener varias branches en user_branches; ve todas las habilitadas.
//   - Para cajero, se usa req.user.id para filtrar por dueño de la venta/caja.

"use strict";

const SUPER_ADMIN_ROLES = ["super_admin", "superadmin", "root", "owner"];
const BRANCH_ADMIN_ROLES = ["admin"];
const CAJERO_ROLES = ["cajero", "cashier", "vendedor", "seller"];

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function rolesOf(req) {
  const out = new Set();
  const push = (s) => {
    const x = String(s || "").trim().toLowerCase();
    if (x) out.add(x);
  };

  // Roles vienen del rbac middleware (req.access.roles), del token (req.user.roles), o de campos legacy.
  const accessRoles = req?.access?.roles;
  if (Array.isArray(accessRoles)) accessRoles.forEach(push);

  const u = req?.user || req?.auth || {};
  if (typeof u.role === "string") push(u.role);
  if (typeof u.rol === "string") push(u.rol);

  const ur = u.roles;
  if (Array.isArray(ur)) {
    for (const r of ur) {
      if (!r) continue;
      if (typeof r === "string") push(r);
      else if (typeof r === "object") push(r.name || r.code || r.role || r.role_name);
    }
  } else if (typeof ur === "string") {
    ur.split(/[,\s|]+/).forEach(push);
  }

  if (u.is_admin === true || u.isAdmin === true || u.admin === true) out.add("admin");

  return out;
}

function isSuperAdmin(req) {
  if (req?.ctx?.isSuperAdmin === true) return true;
  const r = rolesOf(req);
  return SUPER_ADMIN_ROLES.some((x) => r.has(x));
}

function isBranchAdmin(req) {
  // Cualquier admin (incluyendo super_admin) tiene "poder de admin" sobre su sucursal.
  // super_admin lo trata como global, pero `isBranchAdmin` también devuelve true.
  if (isSuperAdmin(req)) return true;
  const r = rolesOf(req);
  return BRANCH_ADMIN_ROLES.some((x) => r.has(x));
}

function isCajero(req) {
  if (isSuperAdmin(req) || isBranchAdmin(req)) return false;
  const r = rolesOf(req);
  // Si tiene un rol cajero/vendedor explícito → sí. Si no tiene roles claros → asumimos "cajero".
  if (CAJERO_ROLES.some((x) => r.has(x))) return true;
  return r.size === 0; // sin roles → trato como cajero
}

function getUserId(req) {
  return (
    toInt(req?.ctx?.userId, 0) ||
    toInt(req?.user?.id, 0) ||
    toInt(req?.user?.sub, 0) ||
    0
  );
}

function getBranchId(req) {
  return (
    toInt(req?.ctx?.branchId, 0) ||
    toInt(req?.user?.branch_id, 0) ||
    toInt(req?.user?.branchId, 0) ||
    0
  );
}

function getAllowedBranchIds(req) {
  const list = Array.isArray(req?.ctx?.allowedBranchIds)
    ? req.ctx.allowedBranchIds.map((x) => toInt(x, 0)).filter(Boolean)
    : [];

  // Si no vienen del middleware, fallback al branch activo.
  if (!list.length) {
    const bid = getBranchId(req);
    if (bid) return [bid];
    return [];
  }
  return Array.from(new Set(list));
}

/**
 * Devuelve el "scope" efectivo para este request:
 *
 *   { kind: "global" }
 *      → super_admin: ve todo.
 *
 *   { kind: "branch", branchIds: number[], userId, isAdmin: true }
 *      → admin de sucursal: ve todo dentro de sus branches habilitadas.
 *
 *   { kind: "user",   branchIds: number[], userId, isAdmin: false }
 *      → cajero/usuario común: ve solo lo suyo (filtrar por userId además de branchIds).
 *
 * Nunca es null. Si no hay branch resoluble y no es super_admin, devuelve un scope
 * "user" con branchIds=[] (a usar para forzar 0 resultados defensivamente).
 */
function getAccessScope(req) {
  if (isSuperAdmin(req)) return { kind: "global" };

  const branchIds = getAllowedBranchIds(req);
  const userId = getUserId(req);

  if (isBranchAdmin(req)) {
    return { kind: "branch", branchIds, userId, isAdmin: true };
  }

  return { kind: "user", branchIds, userId, isAdmin: false };
}

/**
 * Aplica el scope a un objeto `where` de Sequelize.
 * Modifica `where` in-place y lo devuelve.
 *
 * opts:
 *   - branchField:   nombre de columna que contiene branch_id (default "branch_id")
 *   - userField:     nombre de columna del dueño (ej: "seller_id", "opened_by", "user_id")
 *                    Si no se pasa, no se aplica filtro de dueño.
 *   - userFieldsOr:  array de nombres de columna a OR-ear como dueño (alt para userField)
 */
function applyScopeToWhere(where, scope, opts = {}) {
  const { Op } = require("sequelize");
  const w = where || {};
  const {
    branchField = "branch_id",
    userField = null,
    userFieldsOr = null,
  } = opts;

  if (!scope || scope.kind === "global") return w;

  const ids = (scope.branchIds || []).filter(Boolean);

  if (scope.kind === "branch") {
    if (ids.length === 1) w[branchField] = ids[0];
    else if (ids.length > 1) w[branchField] = { [Op.in]: ids };
    else {
      // sin branches resolubles → no debería ver nada
      w[branchField] = -1;
    }
    return w;
  }

  // user (cajero)
  if (ids.length === 1) w[branchField] = ids[0];
  else if (ids.length > 1) w[branchField] = { [Op.in]: ids };
  else w[branchField] = -1;

  if (userField) {
    w[userField] = scope.userId || -1;
  } else if (Array.isArray(userFieldsOr) && userFieldsOr.length) {
    const ors = userFieldsOr.map((f) => ({ [f]: scope.userId || -1 }));
    w[Op.and] = [...(w[Op.and] || []), { [Op.or]: ors }];
  }

  return w;
}

/**
 * Helpers para SQL crudo. Devuelven `{ sql, replacements }` con un fragmento WHERE
 * que aplica scope. Útil cuando el controller arma queries con `sequelize.query`.
 *
 *   const { sql, replacements } = scopeSqlFragment(scope, { table: "s", branchCol: "branch_id" })
 *   → sql: "s.branch_id IN (:branchIds)" o "1=1" si global
 */
function scopeSqlFragment(scope, opts = {}) {
  const {
    table = null,
    branchCol = "branch_id",
    userCol = null,
    userColsOr = null,
  } = opts;

  if (!scope || scope.kind === "global") {
    return { sql: "1=1", replacements: {} };
  }

  const prefix = table ? `${table}.` : "";
  const ids = (scope.branchIds || []).filter(Boolean);

  const parts = [];
  const repl = {};

  if (ids.length) {
    parts.push(`${prefix}${branchCol} IN (:scopeBranchIds)`);
    repl.scopeBranchIds = ids;
  } else {
    parts.push("1=0"); // sin branches
  }

  if (scope.kind === "user") {
    if (userCol) {
      parts.push(`${prefix}${userCol} = :scopeUserId`);
      repl.scopeUserId = scope.userId || -1;
    } else if (Array.isArray(userColsOr) && userColsOr.length) {
      const ors = userColsOr.map((c) => `${prefix}${c} = :scopeUserId`);
      parts.push(`(${ors.join(" OR ")})`);
      repl.scopeUserId = scope.userId || -1;
    }
  }

  return { sql: parts.join(" AND "), replacements: repl };
}

module.exports = {
  rolesOf,
  isSuperAdmin,
  isBranchAdmin,
  isCajero,
  getUserId,
  getBranchId,
  getAllowedBranchIds,
  getAccessScope,
  applyScopeToWhere,
  scopeSqlFragment,
};
