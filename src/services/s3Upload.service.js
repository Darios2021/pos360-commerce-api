// src/services/s3Upload.service.js
// ✅ COPY-PASTE FINAL (backend CommonJS)
// Sube a MinIO/S3 usando config existente en src/config/s3.js
// Devuelve { key, url }
//
// Requiere env:
// - S3_PUBLIC_BASE_URL  (ej: https://storage-files.cingulado.org)
// - (ya tenés: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, etc.)

const crypto = require("crypto");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3, s3Config } = require("../config/s3");

function extFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("x-icon") || m.includes("ico")) return "ico";
  return "png";
}

function buildKey(prefix, filename, mimeType) {
  const id = crypto.randomBytes(10).toString("hex");
  const ext =
    extFromMime(mimeType) ||
    String(filename || "").split(".").pop() ||
    "png";

  const p = String(prefix || "").replace(/^\/+|\/+$/g, "");
  return `${p}/${Date.now()}-${id}.${ext}`;
}

function publicUrlFromKey(key) {
  const pub = String(process.env.S3_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!pub) return `/${String(key || "").replace(/^\/+/, "")}`; // fallback
  return `${pub}/${String(key || "").replace(/^\/+/, "")}`;
}

/**
 * @param {Object} args
 * @param {string} args.keyPrefix e.g. "pos360/shop"
 * @param {Buffer} args.buffer
 * @param {string} args.mimeType
 * @param {string} args.filename
 */
async function uploadBuffer({ keyPrefix, buffer, mimeType, filename }) {
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error("BUFFER_REQUIRED");

  const bucket = s3Config.bucket;
  const key = buildKey(keyPrefix, filename, mimeType);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType || "application/octet-stream",
      ACL: "public-read", // si tu bucket/policy no usa ACL, avisame y lo sacamos
    })
  );

  return { key, url: publicUrlFromKey(key) };
}

module.exports = { uploadBuffer };
