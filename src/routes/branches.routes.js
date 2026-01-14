// src/routes/branches.routes.js
// ✅ COPY-PASTE FINAL (POST protegido por rol)

const router = require("express").Router();
const ctrl = require("../controllers/branches.controller");
const { requireRole } = require("../middlewares/auth");

router.get("/", ctrl.list);

// 🔒 crear sucursal: solo admin/super_admin
router.post("/", requireRole("admin", "super_admin"), ctrl.create);

module.exports = router;
