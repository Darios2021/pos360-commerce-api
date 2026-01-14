// src/routes/admin.shopSettings.routes.js
const router = require("express").Router();
const ctrl = require("../controllers/admin.shopSettings.controller");

function allowAdminOnly() {
  return (req, res, next) => {
    const a = req.access || {};
    const roles = Array.isArray(a.roles) ? a.roles : [];

    if (a.is_super_admin) return next();
    if (roles.includes("admin")) return next();

    return res.status(403).json({
      ok: false,
      code: "FORBIDDEN",
      message: "No tenés permisos para administrar settings del shop.",
      roles,
    });
  };
}

router.get("/settings/:key", allowAdminOnly(), ctrl.getSetting);
router.put("/settings/:key", allowAdminOnly(), ctrl.putSetting);

module.exports = router;
