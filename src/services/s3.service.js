// src/services/s3.service.js
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const S3_ENDPOINT = required("S3_ENDPOINT");
const S3_REGION = process.env.S3_REGION || "us-east-1";
const S3_BUCKET = required("S3_BUCKET");
const S3_ACCESS_KEY = required("S3_ACCESS_KEY");
const S3_SECRET_KEY = required("S3_SECRET_KEY");
const S3_FORCE_PATH_STYLE = String(process.env.S3_FORCE_PATH_STYLE || "true") === "true";
const S3_SSL = String(process.env.S3_SSL || "true") === "true";
const S3_PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL || S3_ENDPOINT;

const client = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  forcePathStyle: S3_FORCE_PATH_STYLE,
  tls: S3_SSL,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
});

function extFromMime(mime, originalName = "") {
  const lower = String(originalName || "").toLowerCase();
  const last = lower.includes(".") ? lower.split(".").pop() : "";
  if (last) return last;

  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "bin";
}

function joinUrl(base, path) {
  return String(base).replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, "");
}

/**
 * Sube imagen (buffer) a MinIO y devuelve URL pública.
 */
async function uploadProductImage({ productId, buffer, mimeType, originalName }) {
  const rand = crypto.randomBytes(8).toString("hex");
  const ext = extFromMime(mimeType, originalName);
  const key = `products/${productId}/${Date.now()}-${rand}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType || "application/octet-stream",
      ACL: "public-read",
    })
  );

  // Para MinIO con path-style: https://minio-domain/bucket/key
  const url = joinUrl(S3_PUBLIC_BASE_URL, `${S3_BUCKET}/${key}`);
  return { key, url };
}

module.exports = { uploadProductImage };
