// src/routes/categories.routes.js
const router = require("express").Router();
const ctrl = require("../controllers/categories.controller");

// list
router.get("/", ctrl.list);

// crud básico
router.post("/", ctrl.create);
router.get("/:id", ctrl.getOne);
router.patch("/:id", ctrl.update);

module.exports = router;
