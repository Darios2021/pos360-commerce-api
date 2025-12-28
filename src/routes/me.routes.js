// src/routes/me.routes.js
const router = require("express").Router();
const multer = require("multer");

const me = require("../controllers/me.controller");

// ✅ Validación dura (si falla, te imprime qué exportó realmente)
function mustFn(name) {
  const fn = me?.[name];
  if (typeof fn !== "function") {
    const keys = me && typeof me === "object" ? Object.keys(me) : null;
    console.error("❌ [me.routes] Handler inválido:", name);
    console.error("   typeof:", typeof fn);
    console.error("   exports keys:", keys);
    throw new Error(`ME_CONTROLLER_EXPORT_MISSING_${name}`);
  }
  return fn;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

router.get("/", mustFn("getMe"));
router.patch("/", mustFn("updateMe"));
router.post("/avatar", upload.single("file"), mustFn("uploadAvatar"));
router.post("/password", mustFn("changePassword"));

module.exports = router;
