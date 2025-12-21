// src/routes/uploads.routes.js
const router = require("express").Router();
const multer = require("multer");
const ctrl = require("../controllers/productImages.controller");

const upload = multer({ storage: multer.memoryStorage() });

router.post("/", upload.single("file"), ctrl.upload);

module.exports = router;
