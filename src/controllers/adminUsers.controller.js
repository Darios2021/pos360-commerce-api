// src/controllers/adminUsers.controller.js
const { Op } = require("sequelize");
const { User, Role, Permission, Branch } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function safeUserRow(u) {
  const roles = Array.isArray(u.roles) ? u.roles.map((r) => r.name).filter(Boolean) : [];
  const branches = Array.isArray(u.branches) ? u.branches.map((b) => ({ id: b.id, name: b.name })) : [];

  return {
    id: u.id,
    email: u.email,
    username: u.username,
    first_name: u.first_name ?? null,
    last_name: u.last_name ?? null,
    is_active: Boolean(u.is_active),
    branch_id: u.branch_id ?? null,
    avatar_url: u.avatar_url ?? null,
    roles,
    branches,
  };
}

// GET /api/v1/admin/users/meta
async function getMeta(req, res) {
  const [roles, branches, permissions] = await Promise.all([
    Role.findAll({ order: [["name", "ASC"]] }),
    Branch.findAll({ order: [["name", "ASC"]] }),
    Permission.findAll({ order: [["code", "ASC"]] }),
  ]);

  return res.json({
    ok: true,
    data: {
      roles: roles.map((r) => ({ id: r.id, name: r.name })),
      branches: branches.map((b) => ({ id: b.id, name: b.name })),
      permissions: permissions.map((p) => ({ id: p.id, code: p.code, description: p.description ?? null })),
    },
  });
}

// GET /api/v1/admin/users?q=&page=1&limit=50&branch_id=&role=
async function listUsers(req, res) {
  const q = String(req.query.q ?? "").trim();
  const page = Math.max(1, toInt(req.query.page, 1));
  const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 50)));
  const offset = (page - 1) * limit;

  const branchId = toInt(req.query.branch_id, 0);
  const roleName = String(req.query.role ?? "").trim();

  const where = {};
  if (q) {
    where[Op.or] = [
      { email: { [Op.like]: `%${q}%` } },
      { username: { [Op.like]: `%${q}%` } },
      { first_name: { [Op.like]: `%${q}%` } },
      { last_name: { [Op.like]: `%${q}%` } },
    ];
  }
  if (branchId > 0) where.branch_id = branchId;

  const include = [
    {
      model: Role,
      as: "roles",
      through: { attributes: [] },
      required: !!roleName,
      ...(roleName ? { where: { name: roleName } } : {}),
    },
    { model: Branch, as: "branches", through: { attributes: [] } },
  ];

  const { rows, count } = await User.findAndCountAll({
    where,
    include,
    distinct: true,
    order: [["id", "DESC"]],
    limit,
    offset,
  });

  const pages = Math.max(1, Math.ceil(count / limit));

  return res.json({
    ok: true,
    data: rows.map(safeUserRow),
    meta: { total: count, page, limit, pages },
  });
}

module.exports = { getMeta, listUsers };
