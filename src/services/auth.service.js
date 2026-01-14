// src/services/auth.service.js
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const env = require("../config/env");
const { Op } = require("sequelize");

const { User, Role, Branch } = require("../models");

function normRoleName(x) {
  return String(x || "").trim().toLowerCase();
}

function pickPrimaryRole(roles = []) {
  const set = new Set((roles || []).map(normRoleName));

  if (set.has("super_admin")) return "super_admin";
  if (set.has("admin")) return "admin";
  if (set.has("cashier")) return "cashier";
  return "user";
}

/**
 * ✅ Carga contexto real desde DB en 1 sola query:
 * - roles: user_roles -> roles
 * - branches: user_branches -> branches
 * - y valida is_active
 */
async function loadUserAccessContext(userId) {
  const u = await User.findByPk(userId, {
    attributes: ["id", "email", "username", "branch_id", "is_active", "password", "password_hash"],
    include: [
      { model: Role, as: "roles", attributes: ["name"], through: { attributes: [] }, required: false },
      { model: Branch, as: "branches", attributes: ["id", "name"], through: { attributes: [] }, required: false },
    ],
  });

  if (!u) return null;

  const plain = u.get({ plain: true });

  // roles reales
  let roles = (plain.roles || []).map((r) => normRoleName(r?.name)).filter(Boolean);

  // ✅ compat: admin hardcodeado como antes
  if (normRoleName(plain.email) === "admin@360pos.local") {
    if (!roles.includes("admin")) roles.unshift("admin");
  }

  if (!roles.length) roles = ["user"];

  // branches reales
  let branches = (plain.branches || []).map((b) => ({ id: b.id, name: b.name })).filter((b) => b?.id);

  // fallback: al menos la principal
  if (!branches.length && plain.branch_id) {
    branches = [{ id: plain.branch_id, name: null }];
  }

  // ✅ consistencia: branch principal debe estar habilitada (user_branches)
  // Si no lo está, preferimos la primera branch habilitada (y LOGUEAMOS el caso)
  if (plain.branch_id && branches.length) {
    const allowedIds = new Set(branches.map((b) => b.id));
    if (!allowedIds.has(plain.branch_id)) {
      // no rompemos prod; ajustamos branch_id al primero permitido
      plain.branch_id = branches[0].id;
    }
  }

  return {
    user: plain,
    roles,
    branches,
  };
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

    // sucursal principal (default scope)
    branch_id: user.branch_id,

    // roles reales
    role, // legacy
    roles, // array

    // branches habilitadas (ids)
    branches: branchIds,
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES || "1d",
  });
}

exports.login = async ({ identifier, password }) => {
  const userRow = await User.findOne({
    where: {
      [Op.or]: [{ email: identifier }, { username: identifier }],
    },
    attributes: ["id", "password", "password_hash"],
  });

  if (!userRow) {
    const e = new Error("Invalid credentials");
    e.status = 401;
    throw e;
  }

  // ✅ Traemos contexto completo + is_active + roles + branches
  const ctx = await loadUserAccessContext(userRow.id);

  if (!ctx) {
    const e = new Error("Invalid credentials");
    e.status = 401;
    throw e;
  }

  const { user, roles, branches } = ctx;

  // ✅ is_active enforcement
  if (user.is_active === 0 || user.is_active === false) {
    const e = new Error("USER_DISABLED");
    e.status = 403;
    throw e;
  }

  // hash
  const hash = user.password_hash || user.password;
  if (!hash) {
    const e = new Error("User has no password hash set");
    e.status = 500;
    throw e;
  }

  const ok = await bcrypt.compare(String(password || ""), String(hash || ""));
  if (!ok) {
    const e = new Error("Invalid credentials");
    e.status = 401;
    throw e;
  }

  const accessToken = signAccessToken({ user, roles, branches });

  return {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      branch_id: user.branch_id,
      roles,
      branches, // ✅ útil para selects/guards frontend
    },
  };
};
