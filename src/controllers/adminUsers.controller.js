// src/controllers/admin.users.controller.js
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { User, Role, Branch, UserRole, UserBranch } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function safeUserRow(u) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    first_name: u.first_name ?? null,
    last_name: u.last_name ?? null,
    is_active: u.is_active !== false,
    branch_id: u.branch_id ?? null,
    avatar_url: u.avatar_url ?? null,
    roles: (u.roles || []).map((r) => r.name),
    branches: (u.branches || []).map((b) => ({ id: b.id, name: b.name })),
  };
}

// GET /admin/users/meta
async function usersMeta(req, res) {
  const roles = await Role.findAll({ order: [["id", "ASC"]] });
  const branches = await Branch.findAll({ order: [["id", "ASC"]] });

  return res.json({
    ok: true,
    data: {
      roles: roles.map((r) => ({ id: r.id, name: r.name })),
      branches: branches.map((b) => ({ id: b.id, name: b.name })),
    },
  });
}

// GET /admin/users
async function listUsers(req, res) {
  const q = String(req.query.q || "").trim();
  const page = Math.max(1, toInt(req.query.page, 1));
  const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 20)));
  const offset = (page - 1) * limit;

  const where = {};
  if (q) {
    where[Op.or] = [
      { email: { [Op.like]: `%${q}%` } },
      { username: { [Op.like]: `%${q}%` } },
      { first_name: { [Op.like]: `%${q}%` } },
      { last_name: { [Op.like]: `%${q}%` } },
    ];
  }

  const { rows, count } = await User.findAndCountAll({
    where,
    order: [["id", "DESC"]],
    limit,
    offset,
    include: [
      { model: Role, as: "roles", through: { attributes: [] } },
      { model: Branch, as: "branches", through: { attributes: [] } },
    ],
  });

  return res.json({
    ok: true,
    data: {
      items: rows.map(safeUserRow),
      meta: {
        total: count,
        page,
        limit,
        pages: Math.max(1, Math.ceil(count / limit)),
      },
    },
  });
}

// POST /admin/users
async function createUser(req, res) {
  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const username = body.username ? String(body.username).trim() : null;
  const password = String(body.password || "").trim();
  const first_name = body.first_name ? String(body.first_name).trim() : null;
  const last_name = body.last_name ? String(body.last_name).trim() : null;

  const branch_id = toInt(body.branch_id, 0);
  const role_ids = Array.isArray(body.role_ids) ? body.role_ids.map((x) => toInt(x, 0)).filter(Boolean) : [];
  const branch_ids = Array.isArray(body.branch_ids) ? body.branch_ids.map((x) => toInt(x, 0)).filter(Boolean) : [];

  if (!email) return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "email requerido" });
  if (!password || password.length < 8)
    return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "password mínimo 8" });
  if (!branch_id) return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "branch_id requerido" });

  const hash = await bcrypt.hash(password, 10);

  const u = await User.create({
    email,
    username,
    password: hash,
    first_name,
    last_name,
    branch_id,
    is_active: body.is_active !== false,
  });

  // roles
  if (role_ids.length) {
    await UserRole.bulkCreate(role_ids.map((rid) => ({ user_id: u.id, role_id: rid })), { ignoreDuplicates: true });
  }

  // branches
  const finalBranchIds = branch_ids.length ? branch_ids : [branch_id];
  await UserBranch.bulkCreate(finalBranchIds.map((bid) => ({ user_id: u.id, branch_id: bid })), {
    ignoreDuplicates: true,
  });

  const fresh = await User.findByPk(u.id, {
    include: [
      { model: Role, as: "roles", through: { attributes: [] } },
      { model: Branch, as: "branches", through: { attributes: [] } },
    ],
  });

  return res.status(201).json({ ok: true, data: safeUserRow(fresh) });
}

// PATCH /admin/users/:id
async function updateUser(req, res) {
  const id = toInt(req.params.id, 0);
  if (!id) return res.status(400).json({ ok: false, code: "BAD_REQUEST" });

  const u = await User.findByPk(id);
  if (!u) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

  const body = req.body || {};
  if (body.email !== undefined) u.email = String(body.email || "").trim().toLowerCase();
  if (body.username !== undefined) u.username = body.username ? String(body.username).trim() : null;
  if (body.first_name !== undefined) u.first_name = body.first_name ? String(body.first_name).trim() : null;
  if (body.last_name !== undefined) u.last_name = body.last_name ? String(body.last_name).trim() : null;
  if (body.branch_id !== undefined) u.branch_id = toInt(body.branch_id, u.branch_id);
  if (body.is_active !== undefined) u.is_active = body.is_active !== false;

  await u.save();

  // roles
  if (Array.isArray(body.role_ids)) {
    const role_ids = body.role_ids.map((x) => toInt(x, 0)).filter(Boolean);
    await UserRole.destroy({ where: { user_id: id } });
    if (role_ids.length) {
      await UserRole.bulkCreate(role_ids.map((rid) => ({ user_id: id, role_id: rid })), { ignoreDuplicates: true });
    }
  }

  // branches
  if (Array.isArray(body.branch_ids)) {
    const branch_ids = body.branch_ids.map((x) => toInt(x, 0)).filter(Boolean);
    await UserBranch.destroy({ where: { user_id: id } });
    const final = branch_ids.length ? branch_ids : [toInt(u.branch_id, 0)].filter(Boolean);
    if (final.length) {
      await UserBranch.bulkCreate(final.map((bid) => ({ user_id: id, branch_id: bid })), {
        ignoreDuplicates: true,
      });
    }
  }

  const fresh = await User.findByPk(id, {
    include: [
      { model: Role, as: "roles", through: { attributes: [] } },
      { model: Branch, as: "branches", through: { attributes: [] } },
    ],
  });

  return res.json({ ok: true, data: safeUserRow(fresh) });
}

module.exports = { usersMeta, listUsers, createUser, updateUser };
