// ✅ COPY-PASTE FINAL COMPLETO
// src/routes/public.shopAuth.routes.js
//
// Se monta en /api/v1/public
// Endpoints:
// - GET  /public/auth/me
// - POST /public/auth/logout
// - POST /public/auth/google

const router = require("express").Router();

const ctrl = require("../controllers/public.shopAuth.controller");

function mustFn(fn, name) {
  if (typeof fn !== "function") {
    // eslint-disable-next-line no-console
    console.error(`❌ public.shopAuth.routes: handler inválido "${name}" ->`, typeof fn);
    throw new Error(`INVALID_HANDLER_${name}`);
  }
}

// ✅ Acepta controller exportado como:
// module.exports = { me, logout, loginGoogleIdToken }
const me = ctrl?.me;
const logout = ctrl?.logout;
const loginGoogleIdToken = ctrl?.loginGoogleIdToken;

mustFn(me, "me");
mustFn(logout, "logout");
mustFn(loginGoogleIdToken, "loginGoogleIdToken");

router.get("/auth/me", me);
router.post("/auth/logout", logout);
router.post("/auth/google", loginGoogleIdToken);

module.exports = router;
