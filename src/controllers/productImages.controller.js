// src/controllers/productImages.controller.js
const AWS = require("aws-sdk");
const crypto = require("crypto");
const path = require("path");

const { ProductImage } = require("../models");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

// --- S3/MinIO client (aws-sdk v2) ---
function s3Client() {
  const endpoint = mustEnv("S3_ENDPOINT");
  const accessKeyId = mustEnv("S3_ACCESS_KEY");
  const secretAccessKey = mustEnv("S3_SECRET_KEY");

  const forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE ?? "true") === "true";

  return new AWS.S3({
    endpoint,
    accessKeyId,
    secretAccessKey,
    s3ForcePathStyle: forcePathStyle,
    signatureVersion: "v4",
    sslEnabled: String(process.env.S3_SSL ?? "true") === "true",
    region: process.env.S3_REGION || "us-east-1",
  });
}

function publicUrlFor(key) {
  const base = process.env.S3_PUBLIC_BASE_URL || process.env.S3_ENDPOINT;
  const bucket = mustEnv("S3_BUCKET");
  const forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE ?? "true") === "true";

  // path-style: https://host/bucket/key
  // virtual-hosted style: https://bucket.host/key  (no lo usamos si forcePathStyle=true)
  if (forcePathStyle) return `${base.replace(/\/$/, "")}/${bucket}/${key}`;
  // fallback
  const host = base.replace(/^https?:\/\//, "");
  return `https://${bucket}.${host.replace(/\/.*$/, "")}/${key}`;
}

// GET /api/v1/products/:id/images
exports.listByProduct = async (req, res, next) => {
  try {
    const productId = toInt(req.params.id, 0);
    if (!productId) return res.status(400).json({ ok: false, message: "productId inválido" });

    const items = await ProductImage.findAll({
      where: { product_id: productId },
      order: [["sort_order", "ASC"], ["id", "ASC"]],
    });

    res.json({ ok: true, items });
  } catch (e) {
    next(e);
  }
};

// POST /api/v1/upload  (multipart: file + productId)
exports.upload = async (req, res, next) => {
  try {
    const productId = toInt(req.body?.productId, 0);

    if (!productId) {
      return res.status(400).json({ ok: false, message: "productId es obligatorio" });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, message: "file es obligatorio" });
    }

    const bucket = mustEnv("S3_BUCKET");
    const s3 = s3Client();

    const ext = path.extname(req.file.originalname || "").toLowerCase() || ".jpg";
    const stamp = Date.now();
    const rand = crypto.randomBytes(8).toString("hex");
    const key = `products/${productId}/${stamp}-${rand}${ext}`;

    // 1) subimos a MinIO
    await s3
      .putObject({
        Bucket: bucket,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype || "application/octet-stream",
        ACL: "public-read", // si tu bucket es privado, sacalo y usa proxy/firma.
      })
      .promise();

    const url = publicUrlFor(key);

    // 2) insertamos en DB con el product_id CORRECTO
    const img = await ProductImage.create({
      product_id: productId,
      url,
      sort_order: 0,
    });

    res.status(201).json({ ok: true, item: img });
  } catch (e) {
    next(e);
  }
};
