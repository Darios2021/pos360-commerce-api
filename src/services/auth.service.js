// src/services/auth.service.js (BACKEND - CommonJS)
// Autenticación real contra DB usando Sequelize + bcryptjs + JWT

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../config/env");

// Ajustá el nombre del modelo según tu proyecto.
// Intento cubrir lo típico: User o Usuario.
const { User, Usuario } = require("../models");
const UserModel = User || Usuario;

if (!UserModel) {
  console.warn(
    "⚠️ auth.service.js: No se encontró modelo User/Usuario en ../models. Ajustá el import del modelo."
  );
}

function parseExpires(expires) {
  // jwt.sign acepta strings tipo "1d", "30d", "15m"
  return expires || "1d";
}

function signAccessToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: parseExpires(env.JWT_ACCESS_EXPIRES) });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: parseExpires(env.JWT_REFRESH_EXPIRES) });
}

async function findUserByIdentifier(identifier) {
  if (!UserModel) return null;

  // Ajustá campos a tu tabla real: email / username / identifier
  // Probamos combinaciones comunes.
  return UserModel.findOne({
    where: {
      // Sequelize OR
      [require("sequelize").Op.or]: [
        { email: identifier },
        { username: identifier },
        { identifier: identifier },
      ],
    },
  });
}

function sanitizeUser(userInstance) {
  if (!userInstance) return null;
  const u = userInstance.toJSON ? userInstance.toJSON() : userInstance;

  // sacamos campos sensibles comunes
  delete u.password;
  delete u.password_hash;
  delete u.hash;
  return u;
}

async function login({ identifier, password }) {
  try {
    const user = await findUserByIdentifier(identifier);

    if (!user) {
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }

    // Si tu modelo tiene campo "active"/"enabled"/"disabled"
    if (user.disabled === true || user.enabled === false || user.active === false) {
      return { ok: false, code: "USER_DISABLED" };
    }

    const u = user.toJSON ? user.toJSON() : user;

    // Campos de password comunes (ajustá al tuyo)
    const hash =
      u.password ||
      u.password_hash ||
      u.hash;

    if (!hash) {
      console.error("❌ El usuario no tiene hash de password en DB (password/password_hash/hash).");
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }

    const ok = await bcrypt.compare(password, hash);
    if (!ok) {
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }

    const payload = {
      sub: u.id,
      role: u.role || u.rol || "user",
    };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    return {
      ok: true,
      user: sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  } catch (e) {
    console.error("❌ auth.service login error:", e);
    return { ok: false, code: "LOGIN_ERROR" };
  }
}

module.exports = { login };
