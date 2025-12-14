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

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, code: "NO_TOKEN" });

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    req.user = payload; // { sub, email, username, roles, iat, exp }
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, code: "INVALID_TOKEN" });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    const roles = req.user?.roles || [];
    if (Array.isArray(roles) && roles.includes(role)) return next();
    return res.status(403).json({ ok: false, code: "FORBIDDEN" });
  };
}

module.exports = {
  requireAuth,
  requireRole,
};
