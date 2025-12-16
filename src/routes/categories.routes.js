const router = require("express").Router();
const ctrl = require("../controllers/categories.controller");

router.get("/", ctrl.list);

module.exports = router;
