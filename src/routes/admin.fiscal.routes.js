const express = require("express");
const controller = require("../controllers/admin.fiscal.controller");

const router = express.Router();

/*
  Montalo detrás de tus middlewares admin ya existentes.
  Ejemplo:
  app.use("/api/v1/admin/fiscal", requireAuth, requireAdmin, router);
*/

router.get("/config", controller.getConfig);
router.put("/config", controller.putConfig);

router.get("/certificates", controller.listCertificates);
router.post("/certificates", controller.upsertCertificate);

router.post("/test-connection", controller.testConnection);

module.exports = router;