// ✅ COPY-PASTE FINAL COMPLETO
// src/routes/public.shopAuth.routes.js

const router = require("express").Router();
const { me, logout, loginGoogleIdToken } = require("../controllers/public.shopAuth.controller");

router.get("/auth/me", me);
router.post("/auth/logout", logout);
router.post("/auth/google", loginGoogleIdToken);

module.exports = router;
