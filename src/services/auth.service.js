// src/services/auth.service.js (BACKEND - CommonJS)

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");

const env = require("../config/env");
const { User } = require("../models");

// helpers
const asExpires = (v, fallback) => (v && String(v).trim()) || fallback;

function sanitizeUser(userInstance) {
  if (!userInstance) return null;
  const u = userInstance.toJSON ? userInstance.toJSON() : userInstance;
  delete u.password;
  return u;
}

function signAccessToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: asExpires(env.JWT_ACCESS_EXPIRES, "1d"),
  });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: asExpires(env.JWT_REFRESH_EXPIRES, "30d"),
  });
}

async function findUserByIdentifier(identifier) {
  // ✅ SOLO columnas que existen: email / username
  return User.findOne({
    where: {
      [Op.or]: [{ email: identifier }, { username: identifier }],
    },
  });
}

async function login({ identifier, password }) {
  try {
    const user = await findUserByIdentifier(identifier);

    if (!user) return { ok: false, code: "INVALID_CREDENTIALS" };

    const u = user.toJSON ? user.toJSON() : user;

    // ✅ tu tabla usa is_active
    if (u.is_active === false) return { ok: false, code: "USER_DISABLED" };

    if (!u.password) {
      console.error("❌ Usuario sin campo password en DB");
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }

    const ok = await bcrypt.compare(password, u.password);
    if (!ok) return { ok: false, code: "INVALID_CREDENTIALS" };

    const payload = {
      sub: u.id,
      // si no tenés role en DB, queda fijo
      role: u.role || "user",
    };

    return {
      ok: true,
      user: sanitizeUser(user),
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
    };
  } catch (e) {
    console.error("❌ auth.service login error:", e);
    return { ok: false, code: "LOGIN_ERROR" };
  }
}

module.exports = { login };
