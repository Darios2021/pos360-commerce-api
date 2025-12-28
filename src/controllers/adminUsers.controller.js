// src/controllers/adminUsers.controller.js
const { User, Role, Branch } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function pickUserRow(u) {
  const roles = (u.roles || []).map((r) => r.name);
  const branches = (u.branches || []).map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
  }));

  return {
    id: u.id,
    branch_id: u.branch_id,
    email: u.email,
    username: u.username,
    first_name: u.first_name ?? null,
    last_name: u.last_name ?? null,
    avatar_url: u.avatar_url ?? null,
    is_active: Boolean(u.is_active),
    created_at: u.created_at ?? null,
    updated_at: u.updated_at ?? null,
    roles,
    branches,
  };
}

/**
 * GET /api/v1/admin/users
 * Soporta ?q= (email/username/nombre) + paginado simple.
 */
async function listAdminUsers(req, res) {
  const page = Math.max(1, toInt(req.query.page, 1));
  const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 50)));
  const q = String(req.query.q ?? "").trim().toLowerCase();

  const where = {};
  if (q) {
    // LIKE simple sin sequelize.Op para mantenerlo “copy paste” sin importar Op
    // => usamos literal con $like$ a través de Sequelize "where: sequelize.where" sería mejor,
    // pero para no complicar, filtramos post-query si q es chico.
  }

  const offset = (page - 1) * limit;

  const users = await User.findAll({
    where,
    order: [["id", "DESC"]],
    limit,
    offset,
    include: [
      { model: Role, as: "roles", through: { attributes: [] } },
      { model: Branch, as: "branches", through: { attributes: [] } },
    ],
  });

  let rows = users.map(pickUserRow);

  if (q) {
    rows = rows.filter((u) => {
      const hay =
        String(u.email || "").toLowerCase().includes(q) ||
        String(u.username || "").toLowerCase().includes(q) ||
        String(u.first_name || "").toLowerCase().includes(q) ||
        String(u.last_name || "").toLowerCase().includes(q);
      return hay;
    });
  }

  return res.json({
    ok: true,
    data: {
      page,
      limit,
      items: rows,
      total: rows.length, // (simple por ahora)
    },
  });
}

module.exports = { listAdminUsers };
