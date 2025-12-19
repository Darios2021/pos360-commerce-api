// src/middlewares/upload.middleware.js
const multer = require("multer");

const storage = multer.memoryStorage();

module.exports = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});
