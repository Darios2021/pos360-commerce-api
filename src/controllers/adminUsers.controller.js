// src/controllers/adminUsers.controller.js
const bcrypt = require("bcryptjs");
const { sequelize } = require("../models");
const { QueryTypes } = require("sequelize");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function uniqInts(arr) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(arr) ? arr : []) {
    const n = Number(x);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

async function getRoles() {
  return sequelize.query(`SELECT id, name, description FROM roles ORDER BY id`, { type: QueryTypes.SELECT });
}
async function getBranches() {
  return sequelize.query(`SELECT id, name, code, is_active FROM branches ORDER BY id`, { type: QueryTypes.SELECT });
}

async function listUsers(req, res) {
  const q = String(req.query.q || "").trim();
  const role = String(req.query.role || "").trim();
  const branchId = toInt(req.query.branch_id, 0);
  const active = req.query.is_active;

  const where = [];
  const repl = [];

  // scope branches si NO super_admin
  if (!req.access?.is_super_admin) {
    const allowed = req.access?.branch_ids || [];
    if (!allowed.length) return res.json({ ok: true, items: [] });

    where.push(`u.branch_id IN (${allowed.map(() => "?").join(",")})`);
    repl.push(...allowed);
  }

  if (q) {
    where.push(`(u.email LIKE ? OR u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)`);
    repl.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (branchId) {
    where.push(`u.branch_id = ?`);
    repl.push(branchId);
  }
  if (active === "1" || active === "0") {
    where.push(`u.is_active = ?`);
    repl.push(active === "1" ? 1 : 0);
  }
  if (role) {
    where.push(`EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = u.id AND r.name = ?
    )`);
    repl.push(role);
  }

  const sql = `
    SELECT
      u.id, u.branch_id, u.email, u.username, u.first_name, u.last_name,
      u.avatar_url, u.is_active, u.last_login_at, u.created_at, u.updated_at,
      (
        SELECT GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ')
        FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id
      ) AS roles,
      (
        SELECT GROUP_CONCAT(DISTINCT b.name ORDER BY b.name SEPARATOR ', ')
        FROM user_branches ub JOIN branches b ON b.id = ub.branch_id
        WHERE ub.user_id = u.id
      ) AS branches
    FROM users u
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY u.id DESC
    LIMIT 500
  `;

  const items = await sequelize.query(sql, { replacements: repl, type: QueryTypes.SELECT });
  return res.json({ ok: true, items });
}

async function meta(req, res) {
  const roles = await getRoles();
  const branches = await getBranches();
  return res.json({ ok: true, roles, branches });
}

async function createUser(req, res) {
  const body = req.body || {};

  const email = String(body.email || "").trim().toLowerCase();
  const username = body.username ? String(body.username).trim() : null;
  const password = String(body.password || "").trim();

  const first_name = body.first_name ? String(body.first_name).trim() : null;
  const last_name = body.last_name ? String(body.last_name).trim() : null;

  const branch_id = toInt(body.branch_id, 0);
  const is_active = body.is_active === 0 || body.is_active === "0" ? 0 : 1;

  const role_ids = uniqInts(body.role_ids);
  const branch_ids = uniqInts(body.branch_ids);

  if (!email) return res.status(400).json({ ok: false, message: "email required" });
  if (!password || password.length < 6) return res.status(400).json({ ok: false, message: "password min 6" });
  if (!branch_id) return res.status(400).json({ ok: false, message: "branch_id required" });
  if (!role_ids.length) return res.status(400).json({ ok: false, message: "role_ids required" });

  // branches finales: si no manda, al menos la principal
  const finalBranchIds = branch_ids.length ? branch_ids : [branch_id];
  if (!finalBranchIds.includes(branch_id)) finalBranchIds.unshift(branch_id);

  // scope branches si NO super_admin
  if (!req.access?.is_super_admin) {
    const allowed = req.access?.branch_ids || [];
    for (const bid of finalBranchIds) {
      if (!allowed.includes(bid)) {
        return res.status(403).json({ ok: false, message: "branch out of scope", branch_id: bid });
      }
    }
  }

  const hash = await bcrypt.hash(password, 10);
  const t = await sequelize.transaction();

  try {
    // users.branch_id es NOT NULL
    const ins = await sequelize.query(
      `
      INSERT INTO users (branch_id, email, username, password, first_name, last_name, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `,
      {
        replacements: [branch_id, email, username, hash, first_name, last_name, is_active],
        type: QueryTypes.INSERT,
        transaction: t,
      }
    );

    // mysql insertId suele estar en ins[0]
    const newUserId = Number(ins?.[0] || 0);
    if (!newUserId) throw new Error("failed to get insertId");

    for (const rid of role_ids) {
      await sequelize.query(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, {
        replacements: [newUserId, rid],
        type: QueryTypes.INSERT,
        transaction: t,
      });
    }

    for (const bid of finalBranchIds) {
      await sequelize.query(`INSERT INTO user_branches (user_id, branch_id) VALUES (?, ?)`, {
        replacements: [newUserId, bid],
        type: QueryTypes.INSERT,
        transaction: t,
      });
    }

    await t.commit();
    return res.json({ ok: true, id: newUserId });
  } catch (e) {
    await t.rollback();
    return res.status(400).json({ ok: false, message: e?.message || "create failed" });
  }
}

async function updateUser(req, res) {
  const id = toInt(req.params.id, 0);
  if (!id) return res.status(400).json({ ok: false, message: "invalid id" });

  const body = req.body || {};
  const patch = {};

  if (body.email !== undefined) patch.email = String(body.email || "").trim().toLowerCase();
  if (body.username !== undefined) patch.username = body.username ? String(body.username).trim() : null;
  if (body.first_name !== undefined) patch.first_name = body.first_name ? String(body.first_name).trim() : null;
  if (body.last_name !== undefined) patch.last_name = body.last_name ? String(body.last_name).trim() : null;

  if (body.branch_id !== undefined) patch.branch_id = toInt(body.branch_id, 0);
  if (body.is_active !== undefined) patch.is_active = body.is_active ? 1 : 0;

  const role_ids = body.role_ids !== undefined ? uniqInts(body.role_ids) : undefined;
  const branch_ids = body.branch_ids !== undefined ? uniqInts(body.branch_ids) : undefined;

  const newPassword = body.password ? String(body.password).trim() : "";

  // scope sobre el usuario target (por branch principal)
  if (!req.access?.is_super_admin) {
    const rows = await sequelize.query(`SELECT branch_id FROM users WHERE id = ?`, {
      replacements: [id],
      type: QueryTypes.SELECT,
    });
    const targetBranch = Number(rows?.[0]?.branch_id || 0);
    const allowed = req.access?.branch_ids || [];
    if (!allowed.includes(targetBranch)) return res.status(403).json({ ok: false, message: "user out of scope" });
  }

  const t = await sequelize.transaction();
  try {
    if (newPassword) {
      if (newPassword.length < 6) throw new Error("password min 6");
      patch.password = await bcrypt.hash(newPassword, 10);
    }

    const keys = Object.keys(patch);
    if (keys.length) {
      const sets = keys.map((k) => `${k} = ?`).join(", ");
      const repl = keys.map((k) => patch[k]);
      repl.push(id);

      await sequelize.query(`UPDATE users SET ${sets}, updated_at = NOW() WHERE id = ?`, {
        replacements: repl,
        type: QueryTypes.UPDATE,
        transaction: t,
      });
    }

    if (role_ids !== undefined) {
      await sequelize.query(`DELETE FROM user_roles WHERE user_id = ?`, {
        replacements: [id],
        type: QueryTypes.DELETE,
        transaction: t,
      });
      for (const rid of role_ids) {
        await sequelize.query(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, {
          replacements: [id, rid],
          type: QueryTypes.INSERT,
          transaction: t,
        });
      }
    }

    if (branch_ids !== undefined) {
      const finalBranchIds = branch_ids;
      const principal = body.branch_id !== undefined ? toInt(body.branch_id, 0) : 0;
      if (principal && !finalBranchIds.includes(principal)) finalBranchIds.unshift(principal);

      if (!req.access?.is_super_admin) {
        const allowed = req.access?.branch_ids || [];
        for (const bid of finalBranchIds) {
          if (!allowed.includes(bid)) throw new Error("branch out of scope");
        }
      }

      await sequelize.query(`DELETE FROM user_branches WHERE user_id = ?`, {
        replacements: [id],
        type: QueryTypes.DELETE,
        transaction: t,
      });
      for (const bid of finalBranchIds) {
        await sequelize.query(`INSERT INTO user_branches (user_id, branch_id) VALUES (?, ?)`, {
          replacements: [id, bid],
          type: QueryTypes.INSERT,
          transaction: t,
        });
      }
    }

    await t.commit();
    return res.json({ ok: true });
  } catch (e) {
    await t.rollback();
    return res.status(400).json({ ok: false, message: e?.message || "update failed" });
  }
}

async function toggleActive(req, res) {
  const id = toInt(req.params.id, 0);
  if (!id) return res.status(400).json({ ok: false, message: "invalid id" });

  // scope target
  if (!req.access?.is_super_admin) {
    const rows = await sequelize.query(`SELECT branch_id FROM users WHERE id = ?`, {
      replacements: [id],
      type: QueryTypes.SELECT,
    });
    const targetBranch = Number(rows?.[0]?.branch_id || 0);
    const allowed = req.access?.branch_ids || [];
    if (!allowed.includes(targetBranch)) return res.status(403).json({ ok: false, message: "user out of scope" });
  }

  await sequelize.query(`UPDATE users SET is_active = IF(is_active=1,0,1), updated_at = NOW() WHERE id = ?`, {
    replacements: [id],
    type: QueryTypes.UPDATE,
  });

  return res.json({ ok: true });
}

module.exports = { listUsers, meta, createUser, updateUser, toggleActive };
