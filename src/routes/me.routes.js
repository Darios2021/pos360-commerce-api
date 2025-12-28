// src/routes/me.routes.js
const router = require("express").Router();
const multer = require("multer");

const { attachAccessContext } = require("../middlewares/rbac.middleware");

const { getMe, updateMe, uploadAvatar, changePassword } = require("../controllers/me.controller");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// OJO: /me ya está protegido con requireAuth en v1.routes.js ✅
// Acá solo adjuntamos access context (roles/perms/branches) para que /me lo devuelva.
router.get("/", attachAccessContext, getMe);
router.patch("/", attachAccessContext, updateMe);
router.post("/avatar", attachAccessContext, upload.single("file"), uploadAvatar);
router.post("/password", attachAccessContext, changePassword);

module.exports = router;
