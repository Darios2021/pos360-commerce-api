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

function modelHasAttr(model, attr) {
  return Boolean(model?.rawAttributes && model.rawAttributes[attr]);
}

const USER_BASE_ATTRS = ["id", "email", "username", "first_name", "last_name", "is_active"];
const USER_ATTRS = modelHasAttr(User, "avatar_url")
  ? [...USER_BASE_ATTRS, "avatar_url"]
  : USER_BASE_ATTRS;

function safeUserRow(u) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    first_name: u.first_name ?? null,
    last_name: u.last_name ?? null,
    is_active: typeof u.is_active === "boolean" ? u.is_active : Boolean(u.is_active),
    avatar_url: modelHasAttr(User, "avatar_url") ? (u.avatar_url ?? null) : null,
    roles: Array.isArray(u.roles) ? u.roles.map((r) => r.name) : [],
    branches: Array.isArray(u.branches)
      ? u.branches.map((b) => ({ id: b.id, name: b.name }))
      : [],
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
    const names = body.roles
      .map((x) => (typeof x === "string" ? x : x?.name))
      .filter(Boolean);

    const ids = body.roles
      .map((x) => (typeof x === "number" ? x : toInt(x?.id)))
      .filter(Boolean);

    if (ids.length) roleIds = ids;

    if (!roleIds.length && names.length) {
      const found = await Role.findAll({
        where: { name: { [Op.in]: names } },
        attributes: ["id"],
      });
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
      const found = await Branch.findAll({
        where: { name: { [Op.in]: names } },
        attributes: ["id"],
      });
      branchIds = found.map((b) => b.id);
    }
  }

  return { roleIds, branchIds };
}

function errMsg(e) {
  return e?.original?.sqlMessage || e?.original?.message || e?.message || "Error";
}

/**
 * GET /api/v1/admin/users/meta
 */
async function getMeta(req, res) {
  try {
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
  } catch (e) {
    return res.status(500).json({ ok: false, code: "META_FAILED", message: errMsg(e) });
  }
}

/**
 * GET /api/v1/admin/users
 * Query: q, page, limit
 */
async function listUsers(req, res) {
  try {
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
      attributes: USER_ATTRS,
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
  } catch (e) {
    return res.status(500).json({ ok: false, code: "LIST_FAILED", message: errMsg(e) });
  }
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
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "email y username son obligatorios",
      });
    }

    const exists = await User.findOne({
      where: { [Op.or]: [{ email }, { username }] },
      attributes: ["id"],
    });
    if (exists) {
      return res.status(400).json({
        ok: false,
        code: "DUPLICATE",
        message: "email o username ya existe",
      });
    }

    const rawPass = String(body.password ?? "360pos1234");
    if (rawPass.length < 8) {
      return res.status(400).json({
        ok: false,
        code: "WEAK_PASSWORD",
        message: "La contraseña debe tener al menos 8 caracteres",
      });
    }

    const password = await bcrypt.hash(rawPass, 10);
    const { roleIds, branchIds } = await normalizeRoleAndBranchIds(body);

    // ✅ users.branch_id es NOT NULL en tu DB → hay que setearlo sí o sí
    const branch_id = branchIds.length ? branchIds[0] : toInt(body.branch_id, 0);
    if (!branch_id) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "Debés seleccionar al menos una sucursal",
      });
    }

    try {
      const createdId = await sequelize.transaction(async (t) => {
        const payload = { email, username, password, first_name, last_name, is_active, branch_id };

        // si existe avatar_url en model, lo aceptamos
        if (modelHasAttr(User, "avatar_url") && "avatar_url" in body) {
          payload.avatar_url = String(body.avatar_url || "").trim() || null;
        }

        const u = await User.create(payload, { transaction: t });

        if (roleIds.length) {
          await UserRole.bulkCreate(
            roleIds.map((rid) => ({ user_id: u.id, role_id: rid })),
            { transaction: t, ignoreDuplicates: true }
          );
        }

        // ✅ user_branches: guardamos todas las sucursales elegidas + forzamos la principal sin duplicar
        const branchSet = new Set([branch_id, ...(branchIds || [])]);
        const finalBranchIds = Array.from(branchSet).filter(Boolean);

        if (finalBranchIds.length) {
          await UserBranch.bulkCreate(
            finalBranchIds.map((bid) => ({ user_id: u.id, branch_id: bid })),
            { transaction: t, ignoreDuplicates: true }
          );
        }

        return u.id;
      });

      const out = await User.findByPk(createdId, {
        attributes: USER_ATTRS,
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
      return res.status(500).json({
        ok: false,
        code: "CREATE_FAILED",
        message: errMsg(e),
      });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: errMsg(e) });
  }
}

/**
 * PUT /api/v1/admin/users/:id
 * Body: { first_name?, last_name?, is_active?, role_ids?/roles?, branch_ids?/branches?, branch_id? }
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

    // opcional: permitir cambiar sucursal principal
    if ("branch_id" in body) {
      const bid = toInt(body.branch_id, 0);
      if (bid) u.branch_id = bid;
    }

    if (modelHasAttr(User, "avatar_url") && "avatar_url" in body) {
      u.avatar_url = String(body.avatar_url || "").trim() || null;
    }

    const { roleIds, branchIds } = await normalizeRoleAndBranchIds(body);

    try {
      await sequelize.transaction(async (t) => {
        await u.save({ transaction: t });

        if (Array.isArray(body.role_ids) || Array.isArray(body.roles)) {
          await UserRole.destroy({ where: { user_id: id }, transaction: t });
          if (roleIds.length) {
            await UserRole.bulkCreate(
              roleIds.map((rid) => ({ user_id: id, role_id: rid })),
              { transaction: t, ignoreDuplicates: true }
            );
          }
        }

        if (Array.isArray(body.branch_ids) || Array.isArray(body.branches)) {
          await UserBranch.destroy({ where: { user_id: id }, transaction: t });

          // ✅ siempre incluimos la principal dentro de las habilitadas
          const branchSet = new Set([u.branch_id, ...(branchIds || [])]);
          const finalBranchIds = Array.from(branchSet).filter(Boolean);

          if (finalBranchIds.length) {
            await UserBranch.bulkCreate(
              finalBranchIds.map((bid) => ({ user_id: id, branch_id: bid })),
              { transaction: t, ignoreDuplicates: true }
            );
          }
        }
      });

      const out = await User.findByPk(id, {
        attributes: USER_ATTRS,
        include: [
          { model: Role, as: "roles", attributes: ["id", "name"], through: { attributes: [] }, required: false },
          { model: Branch, as: "branches", attributes: ["id", "name"], through: { attributes: [] }, required: false },
        ],
      });

      return res.json({ ok: true, data: safeUserRow(out) });
    } catch (e) {
      return res.status(500).json({ ok: false, code: "UPDATE_FAILED", message: errMsg(e) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: errMsg(e) });
  }
}

/**
 * POST /api/v1/admin/users/:id/reset-password
 * Body: { password }
 */
async function resetPassword(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ ok: false, code: "BAD_ID" });

    const u = await User.findByPk(id, { attributes: ["id"] });
    if (!u) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const rawPass = String(req.body?.password ?? "");
    if (rawPass.length < 8) {
      return res.status(400).json({
        ok: false,
        code: "WEAK_PASSWORD",
        message: "La contraseña debe tener al menos 8 caracteres",
      });
    }

    const hashed = await bcrypt.hash(rawPass, 10);
    await User.update({ password: hashed }, { where: { id } });

    return res.json({ ok: true, message: "✅ Contraseña actualizada" });
  } catch (e) {
    return res.status(500).json({ ok: false, code: "RESET_PASS_FAILED", message: errMsg(e) });
  }
}

/**
 * PATCH /api/v1/admin/users/:id/toggle-active
 * (si tu frontend usa este endpoint)
 */
async function toggleActive(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ ok: false, code: "BAD_ID" });

    const u = await User.findByPk(id);
    if (!u) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    u.is_active = !Boolean(u.is_active);
    await u.save();

    return res.json({
      ok: true,
      data: { id: u.id, is_active: Boolean(u.is_active) },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, code: "TOGGLE_FAILED", message: errMsg(e) });
  }
}

module.exports = {
  getMeta,
  listUsers,
  createUser,
  updateUser,
  resetPassword,
  toggleActive,
};
