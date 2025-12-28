// src/controllers/adminUsers.controller.js
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");

const { User, Role, Branch, UserRole, UserBranch } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function isAdminFromReq(req) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  return roles.includes("admin") || roles.includes("super_admin");
}

function pickUserForList(u) {
  const roles = Array.isArray(u.roles) ? u.roles.map((r) => r.name) : [];
  const branches = Array.isArray(u.branches) ? u.branches.map((b) => b.name) : [];
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    first_name: u.first_name ?? null,
    last_name: u.last_name ?? null,
    is_active: u.is_active === undefined ? true : !!u.is_active,
    roles,
    branches,
  };
}

async function meta(req, res) {
  if (!isAdminFromReq(req)) {
    return res.status(403).json({ ok: false, code: "FORBIDDEN" });
  }

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

async function list(req, res) {
  if (!isAdminFromReq(req)) {
    return res.status(403).json({ ok: false, code: "FORBIDDEN" });
  }

  const q = String(req.query.q ?? "").trim();
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
    distinct: true,
    include: [
      { model: Role, as: "roles", through: { attributes: [] }, attributes: ["id", "name"], required: false },
      { model: Branch, as: "branches", through: { attributes: [] }, attributes: ["id", "name"], required: false },
    ],
  });

  const items = rows.map(pickUserForList);

  return res.json({
    ok: true,
    data: items,
    meta: {
      total: count,
      page,
      limit,
      pages: Math.max(1, Math.ceil(count / limit)),
      active_total: items.filter((x) => x.is_active).length,
    },
  });
}

async function create(req, res) {
  if (!isAdminFromReq(req)) {
    return res.status(403).json({ ok: false, code: "FORBIDDEN" });
  }

  const body = req.body || {};
  const email = String(body.email ?? "").trim();
  const username = String(body.username ?? "").trim();
  const first_name = String(body.first_name ?? "").trim() || null;
  const last_name = String(body.last_name ?? "").trim() || null;

  const role_ids = Array.isArray(body.role_ids) ? body.role_ids.map((x) => toInt(x)).filter(Boolean) : [];
  const branch_ids = Array.isArray(body.branch_ids) ? body.branch_ids.map((x) => toInt(x)).filter(Boolean) : [];

  const passwordRaw = String(body.password ?? "").trim();
  if (!email && !username) {
    return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "email o username es obligatorio" });
  }
  if (!passwordRaw || passwordRaw.length < 6) {
    return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "password mínimo 6 caracteres" });
  }

  // evitar duplicados básicos
  if (email) {
    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(400).json({ ok: false, code: "DUP_EMAIL", message: "Email ya existe" });
  }
  if (username) {
    const exists = await User.findOne({ where: { username } });
    if (exists) return res.status(400).json({ ok: false, code: "DUP_USERNAME", message: "Username ya existe" });
  }

  const hash = await bcrypt.hash(passwordRaw, 10);

  const u = await User.create({
    email: email || null,
    username: username || null,
    first_name,
    last_name,
    password: hash,
    is_active: true,
  });

  // roles
  if (role_ids.length) {
    const rows = role_ids.map((role_id) => ({ user_id: u.id, role_id }));
    await UserRole.bulkCreate(rows, { ignoreDuplicates: true });
  }

  // branches
  if (branch_ids.length) {
    const rows = branch_ids.map((branch_id) => ({ user_id: u.id, branch_id }));
    await UserBranch.bulkCreate(rows, { ignoreDuplicates: true });
  }

  const full = await User.findByPk(u.id, {
    include: [
      { model: Role, as: "roles", through: { attributes: [] }, attributes: ["id", "name"], required: false },
      { model: Branch, as: "branches", through: { attributes: [] }, attributes: ["id", "name"], required: false },
    ],
  });

  return res.status(201).json({ ok: true, data: pickUserForList(full) });
}

async function update(req, res) {
  if (!isAdminFromReq(req)) {
    return res.status(403).json({ ok: false, code: "FORBIDDEN" });
  }

  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ ok: false, code: "BAD_ID" });

  const u = await User.findByPk(id);
  if (!u) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

  const body = req.body || {};

  // datos base
  if (body.email !== undefined) u.email = String(body.email ?? "").trim() || null;
  if (body.username !== undefined) u.username = String(body.username ?? "").trim() || null;
  if (body.first_name !== undefined) u.first_name = String(body.first_name ?? "").trim() || null;
  if (body.last_name !== undefined) u.last_name = String(body.last_name ?? "").trim() || null;
  if (body.is_active !== undefined) u.is_active = !!body.is_active;

  // password (opcional)
  const newPass = String(body.password ?? "").trim();
  if (newPass) {
    if (newPass.length < 6) {
      return res.status(400).json({ ok: false, code: "WEAK_PASSWORD", message: "password mínimo 6 caracteres" });
    }
    u.password = await bcrypt.hash(newPass, 10);
  }

  await u.save();

  // roles (replace)
  if (Array.isArray(body.role_ids)) {
    const role_ids = body.role_ids.map((x) => toInt(x)).filter(Boolean);
    await UserRole.destroy({ where: { user_id: id } });
    if (role_ids.length) {
      await UserRole.bulkCreate(role_ids.map((role_id) => ({ user_id: id, role_id })), { ignoreDuplicates: true });
    }
  }

  // branches (replace)
  if (Array.isArray(body.branch_ids)) {
    const branch_ids = body.branch_ids.map((x) => toInt(x)).filter(Boolean);
    await UserBranch.destroy({ where: { user_id: id } });
    if (branch_ids.length) {
      await UserBranch.bulkCreate(branch_ids.map((branch_id) => ({ user_id: id, branch_id })), {
        ignoreDuplicates: true,
      });
    }
  }

  const full = await User.findByPk(id, {
    include: [
      { model: Role, as: "roles", through: { attributes: [] }, attributes: ["id", "name"], required: false },
      { model: Branch, as: "branches", through: { attributes: [] }, attributes: ["id", "name"], required: false },
    ],
  });

  return res.json({ ok: true, data: pickUserForList(full) });
}

async function setStatus(req, res) {
  if (!isAdminFromReq(req)) {
    return res.status(403).json({ ok: false, code: "FORBIDDEN" });
  }

  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ ok: false, code: "BAD_ID" });

  const u = await User.findByPk(id);
  if (!u) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

  const is_active = !!(req.body && req.body.is_active);
  u.is_active = is_active;
  await u.save();

  return res.json({ ok: true, data: { id: u.id, is_active: !!u.is_active } });
}

module.exports = { meta, list, create, update, setStatus };
