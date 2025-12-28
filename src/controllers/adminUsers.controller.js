// src/controllers/admin.users.controller.js
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");

const {
  sequelize,
  User,
  Role,
  Branch,
  Permission,
  UserRole,
  UserBranch,
  RolePermission,
} = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function pickUser(u) {
  return {
    id: u.id,
    branch_id: u.branch_id,
    email: u.email,
    username: u.username,
    first_name: u.first_name ?? null,
    last_name: u.last_name ?? null,
    avatar_url: u.avatar_url ?? null,
    is_active: Boolean(u.is_active),
    last_login_at: u.last_login_at ?? null,
    created_at: u.created_at ?? null,
    updated_at: u.updated_at ?? null,
  };
}

async function listMeta(req, res) {
  try {
    const [roles, branches, permissions] = await Promise.all([
      Role.findAll({ order: [["id", "ASC"]] }),
      Branch.findAll({ order: [["id", "ASC"]] }),
      Permission.findAll({ order: [["id", "ASC"]] }),
    ]);

    return res.json({
      ok: true,
      data: {
        roles: roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description ?? null,
        })),
        branches: branches.map((b) => ({
          id: b.id,
          name: b.name,
          code: b.code ?? null,
          is_active: Boolean(b.is_active),
        })),
        permissions: permissions.map((p) => ({
          id: p.id,
          code: p.code,
          description: p.description ?? null,
        })),
      },
    });
  } catch (err) {
    console.error("❌ [admin.users] meta error:", err?.message || err);
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: err?.message || "Error" });
  }
}

async function listUsers(req, res) {
  try {
    const q = String(req.query.q ?? "").trim();
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 50)));
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
        { model: Role, as: "roles", through: { attributes: [] }, required: false },
        { model: Branch, as: "branches", through: { attributes: [] }, required: false },
      ],
      distinct: true,
    });

    return res.json({
      ok: true,
      data: rows.map((u) => ({
        ...pickUser(u),
        roles: (u.roles || []).map((r) => r.name),
        branches: (u.branches || []).map((b) => ({ id: b.id, name: b.name })),
      })),
      meta: {
        total: count,
        page,
        limit,
        pages: Math.ceil(count / limit) || 1,
      },
    });
  } catch (err) {
    console.error("❌ [admin.users] list error:", err?.message || err);
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: err?.message || "Error" });
  }
}

async function createUser(req, res) {
  const t = await sequelize.transaction();
  try {
    const body = req.body || {};

    const branch_id = toInt(body.branch_id, 0);
    const email = String(body.email ?? "").trim().toLowerCase();
    const username = body.username ? String(body.username).trim() : null;
    const first_name = body.first_name ? String(body.first_name).trim() : null;
    const last_name = body.last_name ? String(body.last_name).trim() : null;
    const password = String(body.password ?? "").trim();
    const is_active = body.is_active === undefined ? true : Boolean(body.is_active);

    const role_ids = Array.isArray(body.role_ids) ? body.role_ids.map((x) => toInt(x, 0)).filter(Boolean) : [];
    const branch_ids = Array.isArray(body.branch_ids) ? body.branch_ids.map((x) => toInt(x, 0)).filter(Boolean) : [];

    if (!branch_id) return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "branch_id requerido" });
    if (!email) return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "email requerido" });
    if (!password || password.length < 6)
      return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "password mínimo 6" });

    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(409).json({ ok: false, code: "DUPLICATE", message: "Email ya existe" });

    const hash = await bcrypt.hash(password, 10);

    const u = await User.create(
      {
        branch_id,
        email,
        username,
        password: hash,
        first_name,
        last_name,
        is_active: is_active ? 1 : 0,
      },
      { transaction: t }
    );

    // roles
    for (const rid of role_ids) {
      await UserRole.create({ user_id: u.id, role_id: rid }, { transaction: t });
    }

    // branches (accesos)
    const uniqueBranchIds = Array.from(new Set([branch_id, ...branch_ids])).filter(Boolean);
    for (const bid of uniqueBranchIds) {
      await UserBranch.create({ user_id: u.id, branch_id: bid }, { transaction: t });
    }

    await t.commit();

    const created = await User.findByPk(u.id, {
      include: [
        { model: Role, as: "roles", through: { attributes: [] }, required: false },
        { model: Branch, as: "branches", through: { attributes: [] }, required: false },
      ],
    });

    return res.status(201).json({
      ok: true,
      data: {
        ...pickUser(created),
        roles: (created.roles || []).map((r) => r.name),
        branches: (created.branches || []).map((b) => ({ id: b.id, name: b.name })),
      },
    });
  } catch (err) {
    await t.rollback();
    console.error("❌ [admin.users] create error:", err?.message || err);
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: err?.message || "Error" });
  }
}

async function updateUser(req, res) {
  const t = await sequelize.transaction();
  try {
    const userId = toInt(req.params.id, 0);
    if (!userId) return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "id inválido" });

    const u = await User.findByPk(userId);
    if (!u) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Usuario no encontrado" });

    const body = req.body || {};

    if (body.branch_id !== undefined) u.branch_id = toInt(body.branch_id, u.branch_id);
    if (body.email !== undefined) u.email = String(body.email).trim().toLowerCase();
    if (body.username !== undefined) u.username = body.username ? String(body.username).trim() : null;
    if (body.first_name !== undefined) u.first_name = body.first_name ? String(body.first_name).trim() : null;
    if (body.last_name !== undefined) u.last_name = body.last_name ? String(body.last_name).trim() : null;
    if (body.is_active !== undefined) u.is_active = body.is_active ? 1 : 0;

    await u.save({ transaction: t });

    // roles replace (si viene)
    if (Array.isArray(body.role_ids)) {
      const role_ids = body.role_ids.map((x) => toInt(x, 0)).filter(Boolean);
      await UserRole.destroy({ where: { user_id: userId }, transaction: t });
      for (const rid of role_ids) {
        await UserRole.create({ user_id: userId, role_id: rid }, { transaction: t });
      }
    }

    // branches replace (si viene)
    if (Array.isArray(body.branch_ids)) {
      const branch_ids = body.branch_ids.map((x) => toInt(x, 0)).filter(Boolean);
      const base = u.branch_id ? [toInt(u.branch_id, 0)] : [];
      const unique = Array.from(new Set([...base, ...branch_ids])).filter(Boolean);

      await UserBranch.destroy({ where: { user_id: userId }, transaction: t });
      for (const bid of unique) {
        await UserBranch.create({ user_id: userId, branch_id: bid }, { transaction: t });
      }
    }

    await t.commit();

    const updated = await User.findByPk(userId, {
      include: [
        { model: Role, as: "roles", through: { attributes: [] }, required: false },
        { model: Branch, as: "branches", through: { attributes: [] }, required: false },
      ],
    });

    return res.json({
      ok: true,
      data: {
        ...pickUser(updated),
        roles: (updated.roles || []).map((r) => r.name),
        branches: (updated.branches || []).map((b) => ({ id: b.id, name: b.name })),
      },
    });
  } catch (err) {
    await t.rollback();
    console.error("❌ [admin.users] update error:", err?.message || err);
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: err?.message || "Error" });
  }
}

async function resetUserPassword(req, res) {
  try {
    const userId = toInt(req.params.id, 0);
    const new_password = String(req.body?.new_password ?? "").trim();

    if (!userId) return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "id inválido" });
    if (!new_password || new_password.length < 6)
      return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "new_password mínimo 6" });

    const u = await User.findByPk(userId);
    if (!u) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Usuario no encontrado" });

    u.password = await bcrypt.hash(new_password, 10);
    await u.save();

    return res.json({ ok: true, message: "Password reseteado" });
  } catch (err) {
    console.error("❌ [admin.users] reset password error:", err?.message || err);
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: err?.message || "Error" });
  }
}

module.exports = {
  listMeta,
  listUsers,
  createUser,
  updateUser,
  resetUserPassword,
};
