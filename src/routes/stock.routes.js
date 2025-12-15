const router = require("express").Router();
const ctrl = require("../controllers/stock.controller");

router.get("/", ctrl.getStock);
router.get("/movements", ctrl.listMovements);
router.post("/movements", ctrl.createMovement);

module.exports = router;
