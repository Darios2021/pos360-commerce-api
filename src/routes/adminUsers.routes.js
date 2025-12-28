// src/routes/adminUsers.routes.js
const router = require("express").Router();

const { requireAuth } = require("../middlewares/auth.middleware");
const { attachAccessContext, requirePermission } = require("../middlewares/rbac.middleware");

const c = require("../controllers/adminUsers.controller");

// meta
router.get("/meta", requireAuth, attachAccessContext, requirePermission("users.read"), c.meta);

// list
router.get("/", requireAuth, attachAccessContext, requirePermission("users.read"), c.listUsers);

// create
router.post("/", requireAuth, attachAccessContext, requirePermission("users.create"), c.createUser);

// update
router.put("/:id", requireAuth, attachAccessContext, requirePermission("users.update"), c.updateUser);

// toggle active
router.patch("/:id/toggle-active", requireAuth, attachAccessContext, requirePermission("users.update"), c.toggleActive);

module.exports = router;
