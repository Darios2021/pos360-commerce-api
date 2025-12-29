// src/middlewares/auth.js
const jwt = require("jsonwebtoken");
const env = require("../config/env");

// ✅ cache del modelo User para evitar require() repetido (y posibles ciclos)
let ModelsCached = null;

function rid(req) {
  return (
    req?.headers?.["x-request-id"] ||
    req?.headers?.["x-correlation-id"] ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function logAuth(req, level, msg, extra = {}) {
  const base = {
    rid: req._rid,
    path: req.originalUrl,
    method: req.method,
    auth_header: req.headers?.authorization ? "present" : "missing",
    user_id: req?.user?.id ?? null,
    user_email: req?.user?.email ?? null,
    user_branch_id: req?.user?.branch_id ?? null,
    user_role: req?.user?.role ?? req?.user?.user_role ?? null,
    user_roles: req?.user?.roles ?? null,
    user_branches: req?.user?.branches ?? null,
  };
  // eslint-disable-next-line no-console
  console[level](`[AUTH] ${msg}`, { ...base, ...extra });
}

function toInt(v, def = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : def;
}

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization;
  if (!h) return null;
  const [type, token] = String(h).split(" ");
  if (type !== "Bearer" || !token) return null;
  return token.trim();
}

/**
 * ✅ Roles robusto:
 * - ["admin","super_admin"]
 * - ["admin"] (strings)
 * - [{name:"admin"}]
 * - "admin" / "admin,super_admin"
 */
function normalizeRoles(raw) {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw
      .map((r) => {
        if (!r) return null;
        if (typeof r === "string") return r.toLowerCase().trim();
        if (typeof r === "object" && r.name) return String(r.name).toLowerCase().trim();
        return null;
      })
      .filter(Boolean);
  }

  // soporta "admin,super_admin"
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * ✅ Branch IDs robusto:
 * - [1,2,3]
 * - ["1","2"]
 * - "1,2,3"
 */
function normalizeBranchIds(raw) {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.map((x) => toInt(x, 0)).filter(Boolean);
  }

  return String(raw || "")
    .split(",")
    .map((s) => toInt(s.trim(), 0))
    .filter(Boolean);
}

/**
 * Obtiene models UNA vez (cache).
 * Si falla el require o no existen, retorna null sin romper.
 */
function getModelsSafe() {
  if (ModelsCached) return ModelsCached;

  try {
    const models = require("../models");
    if (!models) {
      console.warn("⚠️ models no disponible en ../models (auth.js)");
      return null;
    }
    ModelsCached = models;
    return ModelsCached;
  } catch (e) {
    console.warn("⚠️ No pude require('../models') en auth.js:", e?.message || e);
    return null;
  }
}

/**
 * Carga el user real desde DB:
 * - branch_id, is_active
 * - y si existen asociaciones: roles y branches (pivots)
 *
 * Preventivo: si falla, no rompe auth.
 */
async function hydrateUserFromDb(payload) {
  const models = getModelsSafe();
  const User = models?.User;
  if (!User) return null;

  const id = payload?.sub || payload?.id;
  if (!id) return null;

  try {
    const attrs = ["id", "email", "username", "is_active", "branch_id"];

    // ✅ si existen asociaciones en tu Sequelize, intentamos traerlas
    const include = [];
    if (models?.Role) {
      include.push({
        model: models.Role,
        as: "roles",
        attributes: ["name"],
        through: { attributes: [] },
        required: false,
      });
    }
    if (models?.Branch) {
      include.push({
        model: models.Branch,
        as: "branches",
        attributes: ["id", "name"],
        through: { attributes: [] },
        required: false,
      });
    }

    const u = await User.findByPk(id, {
      attributes: attrs,
      include: include.length ? include : undefined,
    });

    if (!u) return null;

    const plain = typeof u.get === "function" ? u.get({ plain: true }) : u;
    return plain;
  } catch (e) {
    console.warn("⚠️ Error consultando User en DB (auth.js):", e?.message || e);
    return null;
  }
}

/**
 * requireAuth robusto:
 * - NUNCA tira throw hacia afuera
 * - devuelve 401 en token inválido
 * - hidrata user desde DB sin romper si falla
 * - LOGS para ver branches/roles reales por usuario (Guillermo vs dperez)
 */
async function requireAuth(req, res, next) {
  req._rid = req._rid || rid(req);

  const token = getBearerToken(req);
  if (!token) {
    logAuth(req, "warn", "NO_TOKEN");
    return res.status(401).json({ ok: false, code: "NO_TOKEN" });
  }

  try {
    if (!env.JWT_SECRET) {
      logAuth(req, "error", "JWT_SECRET missing");
      return res.status(500).json({ ok: false, code: "JWT_SECRET_MISSING" });
    }

    const payload = jwt.verify(token, env.JWT_SECRET);

    // payload típico: { sub, email, username, role, roles, branches, iat, exp }
    req.user = payload;

    // ✅ compat: muchos controladores esperan req.user.id
    req.user.id = payload.sub || payload.id;

    // ✅ normalizar roles/branches SIEMPRE
    req.user.roles = normalizeRoles(payload.roles || payload.role || payload.user_role);
    req.user.branches = normalizeBranchIds(payload.branches || payload.branch_ids || payload.branchIds);

    // ✅ hidratar desde DB (si se puede)
    const dbUser = await hydrateUserFromDb(payload);

    if (dbUser) {
      // is_active enforcement
      if (dbUser.is_active === false || dbUser.is_active === 0) {
        logAuth(req, "warn", "USER_DISABLED", { db: { id: dbUser.id } });
        return res.status(401).json({
          ok: false,
          code: "USER_DISABLED",
          message: "Usuario deshabilitado.",
        });
      }

      // merge datos DB
      req.user.email = dbUser.email ?? req.user.email;
      req.user.username = dbUser.username ?? req.user.username;
      req.user.branch_id = dbUser.branch_id;

      // ✅ si DB trae roles/branches por pivots, preferimos DB
      if (Array.isArray(dbUser.roles) && dbUser.roles.length) {
        req.user.roles = normalizeRoles(dbUser.roles);
      }
      if (Array.isArray(dbUser.branches) && dbUser.branches.length) {
        // dbUser.branches viene [{id,name}] → convertimos a ids
        req.user.branches = normalizeBranchIds(dbUser.branches.map((b) => b?.id));
      }
    } else {
      // no romper: branch_id puede ser undefined
      req.user.branch_id = req.user.branch_id || undefined;

      // fallback mínimo: si no hay branches pero hay branch_id, al menos esa
      if (!Array.isArray(req.user.branches) || req.user.branches.length === 0) {
        const bid = toInt(req.user.branch_id, 0);
        req.user.branches = bid ? [bid] : [];
      }
    }

    // ✅ LOG CLAVE para comparar Guillermo vs dperez
    logAuth(req, "info", "AUTH_OK", {
      decoded: {
        id: req.user.id,
        email: req.user.email,
        branch_id: req.user.branch_id,
        role: req.user.role || req.user.user_role || null,
        roles: req.user.roles,
        branches: req.user.branches,
      },
    });

    return next();
  } catch (e) {
    logAuth(req, "warn", "INVALID_TOKEN", { err: e?.message });
    return res.status(401).json({
      ok: false,
      code: "INVALID_TOKEN",
      message: "Invalid token",
    });
  }
}

function requireRole(...allowed) {
  const allowedNorm = allowed.map((x) => String(x).toLowerCase());

  return (req, res, next) => {
    const roles = normalizeRoles(req.user?.roles);
    const ok = roles.some((r) => allowedNorm.includes(r));

    if (ok) return next();

    return res.status(403).json({
      ok: false,
      code: "FORBIDDEN",
      message: "No tenés permisos para esta acción.",
      roles,
      allowed: allowedNorm,
    });
  };
}

module.exports = {
  requireAuth,
  requireRole,
};
