// src/routes/admin.users.routes.js
const router = require("express").Router();

const { usersMeta, listUsers, createUser, updateUser } = require("../controllers/admin.users.controller");
const { attachAccessContext, requireRole } = require("../middlewares/rbac.middleware");

// ✅ Todo admin/users requiere contexto + rol admin/super_admin
router.use(attachAccessContext, requireRole("admin", "super_admin"));

router.get("/meta", usersMeta);
router.get("/", listUsers);
router.post("/", createUser);
router.patch("/:id", updateUser);

module.exports = router;
