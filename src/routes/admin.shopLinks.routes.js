// ✅ COPY-PASTE FINAL COMPLETO
// src/routes/admin.shopLinks.routes.js

const router = require("express").Router();

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

const ctrl = require("../controllers/adminShopLinks.controller");

const list = resolveFn(ctrl, ["list"]);
const create = resolveFn(ctrl, ["create"]);
const update = resolveFn(ctrl, ["update"]);
const remove = resolveFn(ctrl, ["remove"]);

if (!list || !create || !update || !remove) {
  console.error("❌ admin.shopLinks.routes: exports inválidos. keys:", Object.keys(ctrl || {}));
  throw new Error("ADMIN_SHOP_LINKS_INVALID_EXPORTS");
}

// Montado en v1 como: safeUse("/admin/shop", ..., adminShopLinksRoutes)
// Queda:
// GET    /api/v1/admin/shop/links
// POST   /api/v1/admin/shop/links
// PATCH  /api/v1/admin/shop/links/:id
// DELETE /api/v1/admin/shop/links/:id
router.get("/links", list);
router.post("/links", create);
router.patch("/links/:id", update);
router.delete("/links/:id", remove);

module.exports = router;
