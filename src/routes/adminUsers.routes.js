// src/routes/adminUsers.routes.js
const router = require("express").Router();

const { listAdminUsers } = require("../controllers/adminUsers.controller");
const { loadRbac, requirePermission } = require("../middlewares/rbac.middleware");

// RBAC en este router
router.use(loadRbac);

// Listar usuarios (admin)
router.get("/", requirePermission("users.read"), listAdminUsers);

module.exports = router;
