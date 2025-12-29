// src/services/auth.service.js
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const env = require("../config/env");
const { Op } = require("sequelize");

const { User, Role, Branch } = require("../models");

function pickPrimaryRole(roles = []) {
  if (roles.includes("super_admin")) return "super_admin";
  if (roles.includes("admin")) return "admin";
  if (roles.includes("cashier")) return "cashier";
  return "user";
}

async function getUserRoles(userId, email) {
  // ✅ compat: admin hardcodeado como antes
  if (String(email || "").toLowerCase() === "admin@360pos.local") return ["admin"];

  // ✅ roles reales desde pivots (user_roles -> roles)
  const u = await User.findByPk(userId, {
    attributes: ["id"],
    include: [
      { model: Role, as: "roles", attributes: ["name"], through: { attributes: [] }, required: false },
    ],
  });

  const roles = (u?.roles || []).map((r) => r.name).filter(Boolean);
  return roles.length ? roles : ["user"];
}

async function getUserBranches(userId, fallbackBranchId) {
  // ✅ branches habilitadas desde pivots (user_branches -> branches)
  const u = await User.findByPk(userId, {
    attributes: ["id"],
    include: [
      { model: Branch, as: "branches", attributes: ["id", "name"], through: { attributes: [] }, required: false },
    ],
  });

  const branches = (u?.branches || []).map((b) => ({ id: b.id, name: b.name }));
  if (branches.length) return branches;

  // fallback: al menos la principal
  if (fallbackBranchId) return [{ id: fallbackBranchId, name: null }];
  return [];
}

function signAccessToken({ user, roles, branches }) {
  if (!env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");

  const role = pickPrimaryRole(roles);
  const branchIds = (branches || []).map((b) => b.id).filter(Boolean);

  const payload = {
    sub: user.id,
    id: user.id,
    email: user.email,
    username: user.username,

    // principal (como hoy)
    branch_id: user.branch_id,

    // ✅ roles reales
    role,   // legacy
    roles,  // array

    // ✅ branches habilitadas (ids)
    branches: branchIds,
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

  // ✅ roles/branches reales
  const roles = await getUserRoles(user.id, user.email);
  const branches = await getUserBranches(user.id, user.branch_id);

  const accessToken = signAccessToken({ user, roles, branches });

  return {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      branch_id: user.branch_id,
      roles,
      branches, // ✅ para poblar selects/guards del frontend
    },
  };
};
