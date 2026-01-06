// src/services/admin.shopBranding.service.js
// ✅ COPY-PASTE FINAL COMPLETO
// - CommonJS (NO import)
// - Sube a MinIO/S3 usando @aws-sdk/client-s3
// - Devuelve URL pública usando S3_PUBLIC_BASE_URL (como products)

const path = require("path");
const crypto = require("crypto");
const { PutObjectCommand } = require("@aws-sdk/client-s3");

const { s3, s3Config } = require("../config/s3");

function cleanSlash(s) {
  return String(s || "").replace(/\/+$/, "");
}

function getPublicBase() {
  // Preferimos base pública explícita (tu caso: https://storage-files.cingulado.org)
  const pub = cleanSlash(process.env.S3_PUBLIC_BASE_URL || "");
  if (pub) return pub;

  // fallback: endpoint (puede no servir si es interno)
  return cleanSlash(s3Config.endpoint || "");
}

function guessExt(mime, originalName) {
  const name = String(originalName || "").toLowerCase();
  const byName = path.extname(name);
  if (byName && byName.length <= 6) return byName;

  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return ".png";
  if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
  if (m.includes("webp")) return ".webp";
  if (m.includes("svg")) return ".svg";
  if (m.includes("x-icon") || m.includes("ico")) return ".ico";
  return ".png";
}

function buildKey(prefix, ext) {
  const ts = Date.now();
  const rnd = crypto.randomBytes(16).toString("hex");
  const p = String(prefix || "shop").replace(/^\/+|\/+$/g, "");
  return `${p}/${ts}-${rnd}${ext}`;
}

async function uploadBufferToS3({ buffer, contentType, key }) {
  const Bucket = s3Config.bucket;
  if (!Bucket) throw new Error("S3_BUCKET missing");

  await s3.send(
    new PutObjectCommand({
      Bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
      ACL: "public-read", // ⚠️ si tu MinIO no permite ACL, avisame y lo dejamos sin ACL + policy pública.
    })
  );

  const base = getPublicBase();
  // Resultado como tus productos: https://storage-files.cingulado.org/pos360/<key>
  return `${base}/${Bucket}/${key}`;
}

async function uploadShopAsset({ file, kind }) {
  if (!file || !file.buffer) throw new Error("FILE_REQUIRED");

  const ext = guessExt(file.mimetype, file.originalname);
  const key = buildKey("shop", ext);

  const url = await uploadBufferToS3({
    buffer: file.buffer,
    contentType: file.mimetype,
    key,
  });

  return { url, key, kind };
}

module.exports = {
  uploadShopAsset,
};
