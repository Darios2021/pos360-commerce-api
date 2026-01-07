// src/services/s3Upload.service.js
// ✅ COPY-PASTE FINAL (backend CommonJS)
// Sube a MinIO/S3 usando config existente en src/config/s3.js
// Mantiene uploadBuffer() (genérico) y agrega uploadImageAsWebp() (PRO: valida + normaliza).
//
// Requiere env:
// - S3_PUBLIC_BASE_URL  (ej: https://storage-files.cingulado.org)
// - (ya tenés: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, etc.)
//
// Opcional env para imágenes:
// - IMG_MAX_UPLOAD_BYTES=6291456 (6MB default)
// - IMG_WEBP_QUALITY=75
// - IMG_MAX_WIDTH=1200

const crypto = require("crypto");
const sharp = require("sharp");
const { fileTypeFromBuffer } = require("file-type");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3, s3Config } = require("../config/s3");

const IMG_MAX_UPLOAD_BYTES = Number(process.env.IMG_MAX_UPLOAD_BYTES || 6 * 1024 * 1024);
const IMG_WEBP_QUALITY = Number(process.env.IMG_WEBP_QUALITY || 75);
const IMG_MAX_WIDTH = Number(process.env.IMG_MAX_WIDTH || 1200);

// ✅ Permitimos entrada JPG/PNG/WebP pero SIEMPRE guardamos WebP
const ALLOWED_INPUT_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Para funciones genéricas (no normalizadas) */
function extFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("x-icon") || m.includes("ico")) return "ico";
  return "bin";
}

function buildKey(prefix, filename, mimeType) {
  const id = crypto.randomBytes(10).toString("hex");
  const ext =
    extFromMime(mimeType) ||
    String(filename || "").split(".").pop() ||
    "bin";

  const p = String(prefix || "").replace(/^\/+|\/+$/g, "");
  return `${p}/${Date.now()}-${id}.${ext}`;
}

function buildWebpKey(prefix) {
  const id = crypto.randomBytes(10).toString("hex");
  const p = String(prefix || "").replace(/^\/+|\/+$/g, "");
  return `${p}/${Date.now()}-${id}.webp`;
}

/**
 * URL pública consistente:
 * https://storage-files.cingulado.org/<bucket>/<key>
 */
function publicUrlFromKey(key) {
  const pub = String(process.env.S3_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const cleanKey = String(key || "").replace(/^\/+/, "");

  // fallback: si no hay PUBLIC_BASE_URL, devolvemos path
  if (!pub) return `/${cleanKey}`;

  return `${pub}/${s3Config.bucket}/${cleanKey}`;
}

/**
 * ✅ Subida genérica (se mantiene, por compatibilidad)
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
      // ⚠️ Si tu bucket/policy no usa ACL, sacalo (en muchos MinIO modernos no hace falta)
      ACL: "public-read",
    })
  );

  return { key, url: publicUrlFromKey(key) };
}

/**
 * ✅ PRO: valida tipo REAL (magic bytes) + limita tamaño + convierte a WebP + sube.
 * SIEMPRE retorna .webp
 *
 * @param {Object} args
 * @param {string} args.keyPrefix e.g. "products" o "pos360/shop/products"
 * @param {Buffer} args.buffer
 * @param {string} [args.filename]
 */
async function uploadImageAsWebp({ keyPrefix, buffer, filename }) {
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error("BUFFER_REQUIRED");

  if (buffer.length > IMG_MAX_UPLOAD_BYTES) {
    const err = new Error(`IMG_TOO_LARGE_MAX_${IMG_MAX_UPLOAD_BYTES}_BYTES`);
    err.statusCode = 413;
    throw err;
  }

  // ✅ Detecta tipo real por bytes (no confiar en mimetype/ext)
  const ft = await fileTypeFromBuffer(buffer);
  const realMime = ft?.mime || "";

  if (!ALLOWED_INPUT_MIME.has(realMime)) {
    const err = new Error(`IMG_FORMAT_NOT_ALLOWED_${realMime || "unknown"}`);
    err.statusCode = 415;
    throw err;
  }

  // ✅ Normaliza: rotación EXIF + resize + WebP
  const webpBuffer = await sharp(buffer)
    .rotate()
    .resize({ width: IMG_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: IMG_WEBP_QUALITY })
    .toBuffer();

  const bucket = s3Config.bucket;
  const key = buildWebpKey(keyPrefix || "products");

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: webpBuffer,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
      ACL: "public-read",
    })
  );

  return {
    key,
    url: publicUrlFromKey(key),
    bytes: webpBuffer.length,
    contentType: "image/webp",
    originalFilename: filename || null,
    detectedMime: realMime || null,
  };
}

module.exports = { uploadBuffer, uploadImageAsWebp };
