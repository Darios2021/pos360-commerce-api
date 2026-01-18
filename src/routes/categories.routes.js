// src/routes/categories.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (+ /:id/subcategories)

const router = require("express").Router();
const ctrl = require("../controllers/categories.controller");

router.get("/", ctrl.list);
router.post("/", ctrl.create);

router.get("/:id/subcategories", ctrl.listSubcategories); // ✅ NUEVO

router.get("/:id", ctrl.getOne);
router.patch("/:id", ctrl.update);

module.exports = router;
