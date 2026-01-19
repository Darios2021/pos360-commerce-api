// src/routes/categories.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (+ CRUD subcategories reales)

const router = require("express").Router();
const ctrl = require("../controllers/categories.controller");

// categories
router.get("/", ctrl.list);
router.post("/", ctrl.create);
router.get("/:id", ctrl.getOne);
router.patch("/:id", ctrl.update);

// subcategories (tabla subcategories) colgadas de categories/:id
router.get("/:id/subcategories", ctrl.listSubcategories);
router.post("/:id/subcategories", ctrl.createSubcategory);
router.patch("/:id/subcategories/:subId", ctrl.updateSubcategory);
router.delete("/:id/subcategories/:subId", ctrl.removeSubcategory);

module.exports = router;
