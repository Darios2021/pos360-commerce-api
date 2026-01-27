// src/services/s3Upload.service.js
// ✅ COPY-PASTE FINAL (backend CommonJS)
// Sube a MinIO/S3 usando config existente en src/config/s3.js
// Mantiene uploadBuffer() (genérico) y uploadImageAsWebp() (PRO)
// + NUEVO: uploadOgDefaultJpg1200x630() => genera OG 1200x630 y guarda key ESTABLE "og-default.jpg"

const crypto = require("crypto");
const sharp = require("sharp");
const { fileTypeFromBuffer } = require("file-type");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3, s3Config } = require("../config/s3");

const IMG_MAX_UPLOAD_BYTES = Number(process.env.IMG_MAX_UPLOAD_BYTES || 6 * 1024 * 1024);
const IMG_WEBP_QUALITY = Number(process.env.IMG_WEBP_QUALITY || 75);
const IMG_MAX_WIDTH = Number(process.env.IMG_MAX_WIDTH || 1200);

// ✅ Permitimos entrada JPG/PNG/WebP pero SIEMPRE guardamos WebP en uploadImageAsWebp()
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
  const ext = extFromMime(mimeType) || String(filename || "").split(".").pop() || "bin";
  const p = String(prefix || "").replace(/^\/+|\/+$/g, "");
  return `${p}/${Date.now()}-${id}.${ext}`;
}

function buildWebpKey(prefix) {
  const id = crypto.randomBytes(10).toString("hex");
  const p = String(prefix || "").replace(/^\/+|\/+$/g, "");
  return `${p}/${Date.now()}-${id}.webp`;
}

function buildStableKey(prefix, filename) {
  const p = String(prefix || "").replace(/^\/+|\/+$/g, "");
  const f = String(filename || "").replace(/^\/+/, "");
  return `${p}/${f}`;
}

/**
 * URL pública consistente:
 * https://storage-files.cingulado.org/<bucket>/<key>
 */
function publicUrlFromKey(key) {
  const pub = String(process.env.S3_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const cleanKey = String(key || "").replace(/^\/+/, "");
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
 * @param {string} [args.cacheControl]
 */
async function uploadBuffer({ keyPrefix, buffer, mimeType, filename, cacheControl }) {
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error("BUFFER_REQUIRED");

  const bucket = s3Config.bucket;
  const key = buildKey(keyPrefix, filename, mimeType);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType || "application/octet-stream",
      CacheControl: cacheControl || "public, max-age=31536000, immutable",
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

  const ft = await fileTypeFromBuffer(buffer);
  const realMime = ft?.mime || "";

  if (!ALLOWED_INPUT_MIME.has(realMime)) {
    const err = new Error(`IMG_FORMAT_NOT_ALLOWED_${realMime || "unknown"}`);
    err.statusCode = 415;
    throw err;
  }

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

/**
 * ✅ NUEVO: OG default 1200x630 (JPG) con key ESTABLE: <prefix>/og-default.jpg
 * - Entrada: cualquier imagen (png/jpg/webp)
 * - Salida: JPG 1200x630 (fondo oscuro + logo centrado)
 *
 * @param {Object} args
 * @param {string} args.keyPrefix  e.g. "pos360/shop"
 * @param {Buffer} args.buffer
 */
async function uploadOgDefaultJpg1200x630({ keyPrefix, buffer }) {
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error("BUFFER_REQUIRED");

  // Validación por magic bytes
  const ft = await fileTypeFromBuffer(buffer);
  const realMime = ft?.mime || "";
  if (!ALLOWED_INPUT_MIME.has(realMime)) {
    const err = new Error(`IMG_FORMAT_NOT_ALLOWED_${realMime || "unknown"}`);
    err.statusCode = 415;
    throw err;
  }

  const W = 1200;
  const H = 630;

  const logo = await sharp(buffer)
    .rotate()
    .resize(520, 520, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  const bg = sharp({
    create: { width: W, height: H, channels: 3, background: "#0f1115" },
  });

  const ogJpg = await bg
    .composite([{ input: logo, gravity: "center" }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  const bucket = s3Config.bucket;
  const key = buildStableKey(keyPrefix || "pos360/shop", "og-default.jpg");

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: ogJpg,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=3600", // OG puede cambiar; no conviene immutable
      ACL: "public-read",
    })
  );

  return {
    key,
    url: publicUrlFromKey(key),
    bytes: ogJpg.length,
    contentType: "image/jpeg",
    detectedMime: realMime || null,
  };
}

module.exports = {
  uploadBuffer,
  uploadImageAsWebp,
  uploadOgDefaultJpg1200x630, // ✅ nuevo
};
