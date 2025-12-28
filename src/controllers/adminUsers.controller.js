// src/controllers/admin.users.controller.js
async function listMeta(req, res) {
  return res.json({
    ok: true,
    data: {
      roles: [],
      branches: [],
      permissions: [],
    },
  });
}

async function listUsers(req, res) {
  return res.json({ ok: true, data: [], meta: { total: 0, page: 1, limit: 50, pages: 1 } });
}

async function createUser(req, res) {
  return res.status(501).json({ ok: false, code: "NOT_IMPLEMENTED" });
}

async function updateUser(req, res) {
  return res.status(501).json({ ok: false, code: "NOT_IMPLEMENTED" });
}

async function resetUserPassword(req, res) {
  return res.status(501).json({ ok: false, code: "NOT_IMPLEMENTED" });
}

module.exports = { listMeta, listUsers, createUser, updateUser, resetUserPassword };
