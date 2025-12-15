const router = require("express").Router();
const ctrl = require("../controllers/products.controller");

router.get("/", ctrl.list);
router.post("/", ctrl.create);
router.get("/:id", ctrl.getOne);
router.patch("/:id", ctrl.update);

module.exports = router;
