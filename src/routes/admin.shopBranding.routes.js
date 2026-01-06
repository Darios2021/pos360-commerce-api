const router = require("express").Router();
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

const ctrl = require("../controllers/admin.shopBranding.controller");

router.get("/branding", ctrl.get);
router.put("/branding", ctrl.update);

router.post("/branding/logo", upload.single("file"), ctrl.uploadLogo);
router.post("/branding/favicon", upload.single("file"), ctrl.uploadFavicon);

module.exports = router;
