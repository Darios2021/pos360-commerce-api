// src/middlewares/auth.js
const jwt = require("jsonwebtoken");
const env = require("../config/env");

// ✅ cache del modelo User para evitar require() repetido (y posibles ciclos)
let UserModelCached = null;

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization;
  if (!h) return null;
  const [type, token] = String(h).split(" ");
  if (type !== "Bearer" || !token) return null;
  return token.trim();
}

function normalizeRoles(raw) {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];

  return raw
    .map((r) => {
      if (!r) return null;
      if (typeof r === "string") return r.toLowerCase();
      if (typeof r === "object" && r.name) return String(r.name).toLowerCase();
      return null;
    })
    .filter(Boolean);
}

/**
 * Obtiene User model UNA vez (cache).
 * Si falla el require o el modelo no existe, retorna null sin romper.
 */
function getUserModelSafe() {
  if (UserModelCached) return UserModelCached;

  try {
    const models = require("../models");
    const User = models?.User;
    if (!User) {
      console.warn("⚠️ Model User no disponible en ../models (auth.js)");
      return null;
    }
    UserModelCached = User;
    return UserModelCached;
  } catch (e) {
    console.warn("⚠️ No pude require('../models') en auth.js:", e?.message || e);
    return null;
  }
}

/**
 * Carga el user real desde DB (para branch_id, is_active, roles, etc.)
 * Preventivo: si falla la query, no rompe auth.
 */
async function hydrateUserFromDb(payload) {
  const User = getUserModelSafe();
  if (!User) return null;

  const id = payload?.sub || payload?.id;
  if (!id) return null;

  try {
    const attrs = ["id", "email", "username", "is_active", "branch_id"];
    const u = await User.findByPk(id, { attributes: attrs });

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
 */
async function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, code: "NO_TOKEN" });

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);

    // payload típico: { sub, email, username, roles, iat, exp }
    req.user = payload;

    // ✅ compat: muchos controladores esperan req.user.id
    req.user.id = payload.sub || payload.id;

    // roles desde token (si vienen)
    req.user.roles = normalizeRoles(payload.roles);

    // ✅ hidratar desde DB (si se puede)
    const dbUser = await hydrateUserFromDb(payload);

    if (dbUser) {
      // is_active enforcement
      if (dbUser.is_active === false || dbUser.is_active === 0) {
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
    } else {
      // no romper: branch_id puede ser undefined
      req.user.branch_id = req.user.branch_id || undefined;
    }

    return next();
  } catch (e) {
    // ✅ nunca 500 por auth
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
