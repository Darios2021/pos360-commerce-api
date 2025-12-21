// src/modules/pos/pos.routes.js
const express = require("express");
const router = express.Router();

const posCtrl = require("./pos.controller");
const cashCtrl = require("./cash.controller");

// Si ya tenés middleware global de auth, no hace falta.
// Si querés proteger solo POS, descomentá y ajustá el require al tuyo.
// const auth = require("../../middlewares/auth.middleware");
// router.use(auth);

router.get("/cash-registers/open", cashCtrl.getOpenCashRegister);
router.post("/cash-registers/open", cashCtrl.openCashRegister);
router.post("/cash-registers/:id/close", cashCtrl.closeCashRegister);
router.post("/cash-movements", cashCtrl.createCashMovement);

// Ventas
router.post("/sales", posCtrl.createSale);
router.get("/sales", posCtrl.listSales);
router.get("/sales/:id", posCtrl.getSale);

module.exports = router;
