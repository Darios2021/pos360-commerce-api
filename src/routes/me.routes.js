// src/routes/me.routes.js
const router = require("express").Router();
const multer = require("multer");

const me = require("../controllers/me.controller");
const sig = require("../controllers/me.signature.controller");

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

// ✅ Firma personal CRM
router.get("/signature", sig.getSignature);
router.put("/signature", sig.upsertSignature);
router.post("/signature/photo", upload.single("file"), sig.uploadPhoto);
router.delete("/signature/photo", sig.deletePhoto);

module.exports = router;
