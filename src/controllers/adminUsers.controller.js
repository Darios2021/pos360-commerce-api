// src/controllers/adminUsers.controller.js
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");

const {
  User,
  Role,
  Permission,
  Branch,
  UserRole,
  UserBranch,
  RolePermission,
  sequelize,
} = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function boolVal(v, d = false) {
  if (v === undefined) return d;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase().trim();
  if (["1", "true", "yes", "y", "si"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return Boolean(v);
}

function safeUserRow(u) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    first_name: u.first_name ?? null,
    last_name: u.last_name ?? null,
    is_active: typeof u.is_active === "boolean" ? u.is_active : Boolean(u.is_active),
    avatar_url: u.avatar_url ?? null,
    roles: Array.isArray(u.roles) ? u.roles.map((r) => r.name) : [],
    branches: Array.isArray(u.branches) ? u.branches.map((b) => ({ id: b.id, name: b.name })) : [],
  };
}

/**
 * Normaliza roles/sucursales:
 * - acepta role_ids / branch_ids como IDs
 * - acepta roles / branches como nombres o ids (por si el frontend manda labels)
 */
async function normalizeRoleAndBranchIds(body) {
  // Roles
  let roleIds = [];
  if (Array.isArray(body.role_ids)) {
    roleIds = body.role_ids.map((x) => toInt(x)).filter(Boolean);
  } else if (Array.isArray(body.roles)) {
    // puede venir ["super_admin"] o [{id,name}]
    const names = body.roles
      .map((x) => (typeof x === "string" ? x : x?.name))
      .filter(Boolean);

    const ids = body.roles
      .map((x) => (typeof x === "number" ? x : toInt(x?.id)))
      .filter(Boolean);

    if (ids.length) roleIds = ids;

    if (!roleIds.length && names.length) {
      const found = await Role.findAll({ where: { name: { [Op.in]: names } }, attributes: ["id"] });
      roleIds = found.map((r) => r.id);
    }
  }

  // Branches
  let branchIds = [];
  if (Array.isArray(body.branch_ids)) {
    branchIds = body.branch_ids.map((x) => toInt(x)).filter(Boolean);
  } else if (Array.isArray(body.branches)) {
    const names = body.branches
      .map((x) => (typeof x === "string" ? x : x?.name))
      .filter(Boolean);

    const ids = body.branches
      .map((x) => (typeof x === "number" ? x : toInt(x?.id)))
      .filter(Boolean);

    if (ids.length) branchIds = ids;

    if (!branchIds.length && names.length) {
      const found = await Branch.findAll({ where: { name: { [Op.in]: names } }, attributes: ["id"] });
      branchIds = found.map((b) => b.id);
    }
  }

  return { roleIds, branchIds };
}

/**
 * GET /api/v1/admin/users/meta
 */
async function getMeta(req, res) {
  const [roles, branches, permissions] = await Promise.all([
    Role.findAll({ order: [["id", "ASC"]], attributes: ["id", "name"] }),
    Branch.findAll({ order: [["id", "ASC"]], attributes: ["id", "name"] }),
    Permission.findAll({ order: [["id", "ASC"]], attributes: ["id", "code", "description"] }),
  ]);

  return res.json({
    ok: true,
    data: {
      roles,
      branches,
      permissions,
      hasRolePermissionsPivot: Boolean(RolePermission),
    },
  });
}

/**
 * GET /api/v1/admin/users
 * Query: q, page, limit
 */
async function listUsers(req, res) {
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
    attributes: ["id", "email", "username", "first_name", "last_name", "is_active", "avatar_url"],
    include: [
      { model: Role, as: "roles", attributes: ["id", "name"], through: { attributes: [] }, required: false },
      { model: Branch, as: "branches", attributes: ["id", "name"], through: { attributes: [] }, required: false },
    ],
  });

  return res.json({
    ok: true,
    data: rows.map(safeUserRow),
    meta: {
      page,
      limit,
      total: count,
      pages: Math.ceil(count / limit) || 1,
    },
  });
}

/**
 * POST /api/v1/admin/users
 * Body:
 * { email, username, password?, first_name?, last_name?, is_active?, role_ids?/roles?, branch_ids?/branches? }
 */
async function createUser(req, res) {
  try {
    const body = req.body || {};

    const email = String(body.email ?? "").trim();
    const username = String(body.username ?? "").trim();
    const first_name = (body.first_name ?? "").toString().trim() || null;
    const last_name = (body.last_name ?? "").toString().trim() || null;
    const is_active = boolVal(body.is_active, true);

    if (!email || !username) {
      return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "email y username son obligatorios" });
    }

    const exists = await User.findOne({
      where: { [Op.or]: [{ email }, { username }] },
      attributes: ["id"],
    });
    if (exists) {
      return res.status(400).json({ ok: false, code: "DUPLICATE", message: "email o username ya existe" });
    }

    const rawPass = String(body.password ?? "360pos1234");
    if (rawPass.length < 8) {
      return res.status(400).json({ ok: false, code: "WEAK_PASSWORD", message: "La contraseña debe tener al menos 8 caracteres" });
    }
    const password = await bcrypt.hash(rawPass, 10);

    const { roleIds, branchIds } = await normalizeRoleAndBranchIds(body);

    const t = await sequelize.transaction();
    try {
      const u = await User.create(
        { email, username, password, first_name, last_name, is_active },
        { transaction: t }
      );

      if (roleIds.length) {
        await UserRole.bulkCreate(
          roleIds.map((rid) => ({ user_id: u.id, role_id: rid })),
          { transaction: t, ignoreDuplicates: true }
        );
      }

      if (branchIds.length) {
        await UserBranch.bulkCreate(
          branchIds.map((bid) => ({ user_id: u.id, branch_id: bid })),
          { transaction: t, ignoreDuplicates: true }
        );
      }

      await t.commit();

      const out = await User.findByPk(u.id, {
        attributes: ["id", "email", "username", "first_name", "last_name", "is_active", "avatar_url"],
        include: [
          { model: Role, as: "roles", attributes: ["id", "name"], through: { attributes: [] }, required: false },
          { model: Branch, as: "branches", attributes: ["id", "name"], through: { attributes: [] }, required: false },
        ],
      });

      return res.status(201).json({
        ok: true,
        data: safeUserRow(out),
        temp_password: rawPass,
      });
    } catch (e) {
      await t.rollback();
      return res.status(500).json({
        ok: false,
        code: "CREATE_FAILED",
        message: e?.message || "Error",
      });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: e?.message || "Error" });
  }
}

/**
 * PATCH/PUT /api/v1/admin/users/:id
 * Body: { first_name?, last_name?, is_active?, role_ids?/roles?, branch_ids?/branches? }
 */
async function updateUser(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ ok: false, code: "BAD_ID" });

    const u = await User.findByPk(id);
    if (!u) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const body = req.body || {};

    if ("first_name" in body) u.first_name = (body.first_name ?? "").toString().trim() || null;
    if ("last_name" in body) u.last_name = (body.last_name ?? "").toString().trim() || null;
    if ("is_active" in body) u.is_active = boolVal(body.is_active, Boolean(u.is_active));

    const { roleIds, branchIds } = await normalizeRoleAndBranchIds(body);

    const t = await sequelize.transaction();
    try {
      await u.save({ transaction: t });

      // Roles: solo si mandan algo relacionado
      if (Array.isArray(body.role_ids) || Array.isArray(body.roles)) {
        await UserRole.destroy({ where: { user_id: id }, transaction: t });
        if (roleIds.length) {
          await UserRole.bulkCreate(
            roleIds.map((rid) => ({ user_id: id, role_id: rid })),
            { transaction: t, ignoreDuplicates: true }
          );
        }
      }

      // Branches: solo si mandan algo relacionado
      if (Array.isArray(body.branch_ids) || Array.isArray(body.branches)) {
        await UserBranch.destroy({ where: { user_id: id }, transaction: t });
        if (branchIds.length) {
          await UserBranch.bulkCreate(
            branchIds.map((bid) => ({ user_id: id, branch_id: bid })),
            { transaction: t, ignoreDuplicates: true }
          );
        }
      }

      await t.commit();

      const out = await User.findByPk(id, {
        attributes: ["id", "email", "username", "first_name", "last_name", "is_active", "avatar_url"],
        include: [
          { model: Role, as: "roles", attributes: ["id", "name"], through: { attributes: [] }, required: false },
          { model: Branch, as: "branches", attributes: ["id", "name"], through: { attributes: [] }, required: false },
        ],
      });

      return res.json({ ok: true, data: safeUserRow(out) });
    } catch (e) {
      await t.rollback();
      return res.status(500).json({
        ok: false,
        code: "UPDATE_FAILED",
        message: e?.message || "Error",
      });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: e?.message || "Error" });
  }
}

module.exports = {
  getMeta,
  listUsers,
  createUser,
  updateUser,
};
