// src/routes/uploads.routes.js
const express = require("express");
const multer = require("multer");
const { buildObjectKey, putObject } = require("../services/s3.service");

const router = express.Router();

// Multer en memoria (simple y directo)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Missing file (field name: file)" });
    }

    const key = buildObjectKey({
      prefix: "pos360",
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
    });

    const url = await putObject({
      key,
      body: req.file.buffer,
      contentType: req.file.mimetype,
    });

    return res.json({
      ok: true,
      bucket: process.env.S3_BUCKET,
      key,
      url,
      size: req.file.size,
      mime: req.file.mimetype,
      originalName: req.file.originalname,
    });
  } catch (err) {
    console.error("UPLOAD_ERROR:", err);
    return res.status(500).json({ message: "Upload failed", error: String(err?.message || err) });
  }
});

module.exports = router;
