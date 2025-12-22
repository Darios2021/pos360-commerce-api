const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const env = require("../config/env");
const { User } = require("../models");
const { Op } = require("sequelize");

function getUserRoles(user) {
  // ✅ FIX rápido: si es el admin hardcodeado => admin
  if (String(user?.email || "").toLowerCase() === "admin@360pos.local") return ["admin"];

  // Si en algún futuro guardás roles en DB, acá podés mapearlo.
  // Por ahora default:
  return ["user"];
}

function signAccessToken(user) {
  if (!env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");

  const payload = {
    sub: user.id,
    id: user.id,
    email: user.email,
    username: user.username,
    branch_id: user.branch_id,
    roles: getUserRoles(user),
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES || "1d",
  });
}

exports.login = async ({ identifier, password }) => {
  const user = await User.findOne({
    where: {
      [Op.or]: [{ email: identifier }, { username: identifier }],
    },
  });

  if (!user) {
    const e = new Error("Invalid credentials");
    e.status = 401;
    throw e;
  }

  if (!user.password_hash && !user.password) {
    const e = new Error("User has no password hash set");
    e.status = 500;
    throw e;
  }

  const hash = user.password_hash || user.password;

  const ok = await bcrypt.compare(password, hash);
  if (!ok) {
    const e = new Error("Invalid credentials");
    e.status = 401;
    throw e;
  }

  const accessToken = signAccessToken(user);
  const roles = getUserRoles(user);

  return {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      branch_id: user.branch_id,
      roles,
    },
  };
};
