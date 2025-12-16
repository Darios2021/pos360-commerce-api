const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const env = require("../config/env");
const { User } = require("../models");
const { Op } = require("sequelize");

function signAccessToken(user) {
  if (!env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  const payload = {
    sub: user.id,
    roles: user.roles ? user.roles : ["user"],
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES || "1d" });
}

exports.login = async ({ identifier, password }) => {
  // Busca por email o username
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

  return {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      roles: user.roles || ["user"],
    },
  };
};
