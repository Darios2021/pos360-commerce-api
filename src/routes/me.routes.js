// src/routes/me.routes.js
const router = require("express").Router();
const multer = require("multer");

const { getMe, updateMe, uploadAvatar, changePassword } = require("../controllers/me.controller");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

router.get("/", getMe);
router.patch("/", updateMe);
router.post("/avatar", upload.single("file"), uploadAvatar);
router.post("/password", changePassword);

module.exports = router;
