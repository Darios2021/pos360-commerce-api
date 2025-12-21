// src/routes/upload.routes.js
const router = require("express").Router();
const ctrl = require("../controllers/productImages.controller");
const { upload } = require("../middlewares/upload.middleware");

// upload (frontend usa POST /upload)
router.post("/", upload.single("file"), ctrl.upload);

module.exports = router;
