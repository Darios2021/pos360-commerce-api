// src/middlewares/auth.js
const jwt = require("jsonwebtoken");
const env = require("../config/env");

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

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, code: "NO_TOKEN" });

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);

    // payload típico: { sub, email, username, roles, iat, exp }
    // ✅ normalizamos para que SIEMPRE exista req.user.id numérico
    const userId = Number(payload?.sub || payload?.id || 0);

    req.user = {
      ...payload,
      id: Number.isFinite(userId) && userId > 0 ? userId : undefined,
      roles: normalizeRoles(payload?.roles),
    };

    if (!req.user.id) {
      return res.status(401).json({
        ok: false,
        code: "INVALID_TOKEN_PAYLOAD",
        message: "Token válido pero sin sub/id de usuario.",
      });
    }

    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, code: "INVALID_TOKEN" });
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
