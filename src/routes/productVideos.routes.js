// src/routes/productVideos.routes.js
const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/productVideos.controller");

// multer memory
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

// 🔒 poné tu middleware admin real si ya existe
// const { requireAdmin } = require("../middlewares/auth");

router.get("/admin/products/:id/videos", /*requireAdmin,*/ ctrl.list);
router.post("/admin/products/:id/videos/youtube", /*requireAdmin,*/ express.json(), ctrl.addYoutube);
router.post("/admin/products/:id/videos/upload", /*requireAdmin,*/ upload.single("file"), ctrl.upload);
router.delete("/admin/products/:id/videos/:videoId", /*requireAdmin,*/ ctrl.remove);

module.exports = router;
