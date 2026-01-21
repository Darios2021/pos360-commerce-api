// ✅ COPY-PASTE FINAL COMPLETO
// src/routes/publicInstagram.routes.js
const router = require("express").Router();

// 🔒 Resolver exports (named/default/module.exports)
function resolveFn(mod, candidates = []) {
  if (typeof mod === "function") return mod;
  if (!mod || typeof mod !== "object") return null;

  if (typeof mod.default === "function") return mod.default;

  for (const k of candidates) {
    if (typeof mod[k] === "function") return mod[k];
  }

  const fnKeys = Object.keys(mod).filter((k) => typeof mod[k] === "function");
  if (fnKeys.length === 1) return mod[fnKeys[0]];

  return null;
}

const ctrl = require("../controllers/publicInstagram.controller");
const latest = resolveFn(ctrl, ["latest"]);

if (!latest) {
  console.error("❌ publicInstagram.routes: controlador latest inválido");
  console.error("   keys:", ctrl && typeof ctrl === "object" ? Object.keys(ctrl) : null);
  throw new Error("PUBLIC_INSTAGRAM_LATEST_INVALID_EXPORT");
}

// Público (sin auth)
// Montado desde v1 como /public => /api/v1/public/instagram/latest
router.get("/instagram/latest", latest);

module.exports = router;
