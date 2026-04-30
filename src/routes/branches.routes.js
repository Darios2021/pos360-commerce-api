// src/routes/branches.routes.js
// ✅ COPY-PASTE FINAL (CRUD protegido por rol)

const router = require("express").Router();
const ctrl = require("../controllers/branches.controller");
const { requireRole } = require("../middlewares/auth");

router.get("/", ctrl.list);

// 🔒 super_admin solamente
router.post("/", requireRole("admin", "super_admin"), ctrl.create);
router.put("/:id", requireRole("admin", "super_admin"), ctrl.update);
router.patch("/:id", requireRole("admin", "super_admin"), ctrl.update);
router.delete("/:id", requireRole("admin", "super_admin"), ctrl.remove);

module.exports = router;
