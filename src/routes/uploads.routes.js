// src/routes/uploads.routes.js
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const { putObject } = require("../services/s3.service");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

function safeExt(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  const ok = [".png", ".jpg", ".jpeg", ".webp"];
  return ok.includes(ext) ? ext : "";
}

// ✅ POST /api/v1/upload  (multipart: file + productId)
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "Missing file (field name: file)" });
    }

    const original = req.file.originalname || "file";
    const ext = safeExt(original) || ".jpg";
    const rand = crypto.randomBytes(12).toString("hex");
    const productId = req.body?.productId ? String(req.body.productId) : null;

    const key = productId
      ? `products/${productId}/${Date.now()}-${rand}${ext}`
      : `uploads/${Date.now()}-${rand}${ext}`;

    const saved = await putObject({
      key,
      body: req.file.buffer,
      contentType: req.file.mimetype,
    });

    return res.json({
      ok: true,
      key: saved.key,
      url: saved.url,
      originalName: original,
      size: req.file.size,
      mime: req.file.mimetype,
    });
  } catch (err) {
    console.error("❌ UPLOAD ERROR:", err);
    return res.status(500).json({
      ok: false,
      code: "UPLOAD_FAILED",
      message: err?.message || "Upload failed",
    });
  }
});

module.exports = router;
