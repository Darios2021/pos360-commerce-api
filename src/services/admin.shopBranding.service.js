// src/services/admin.shopBranding.service.js
// ✅ COPY-PASTE FINAL DEFINITIVO (S3/MinIO + favicon 64x64 + OG 1200x630)
// - kind: "logo"      => sube tal cual (cache largo)  key: shop/<ts>-logo.ext
// - kind: "favicon"   => PNG 64x64, key estable:      shop/favicon.png
// - kind: "og-image"  => JPG 1200x630, key estable:   shop/og-default.jpg
//
// ✅ TU CASO (CONFIRMADO):
// Tu URL pública funciona como: https://storage-files.cingulado.org/<bucket>/<key>
// Ejemplo real: https://storage-files.cingulado.org/pos360/shop/....png
// => Bucket = pos360, Key = shop/....png
//
// Por eso:
// - Key NUNCA debe incluir "pos360/"
// - publicUrlFromKey() SIEMPRE concatena bucket + key

const sharp = require("sharp");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3, s3Config } = require("../config/s3");

function publicUrlFromKey(key) {
  const pub = String(process.env.S3_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const cleanKey = String(key || "").replace(/^\/+/, "");
  if (!pub) return `/${cleanKey}`;
  return `${pub}/${s3Config.bucket}/${cleanKey}`;
}

function extFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("svg")) return "svg";
  if (m.includes("gif")) return "gif";
  if (m.includes("x-icon") || m.includes("ico")) return "ico";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("webm")) return "webm";
  if (m.includes("quicktime") || m.includes("mov")) return "mov";
  return "bin";
}

// Mime-types aceptados para holiday-overlay: imagen estática, GIF animado o video corto.
const HOLIDAY_OVERLAY_ALLOWED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
];

function isAllowedHolidayOverlayMime(mime) {
  const m = String(mime || "").toLowerCase();
  return HOLIDAY_OVERLAY_ALLOWED_MIMES.includes(m);
}

async function putObject({ key, buffer, contentType, cacheControl }) {
  const bucket = s3Config.bucket;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
      CacheControl: cacheControl || "public, max-age=31536000, immutable",
      ACL: "public-read",
    })
  );

  return { key, url: publicUrlFromKey(key), contentType };
}

async function buildFavicon64Png(buffer) {
  return sharp(buffer)
    .rotate()
    .resize(64, 64, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// OG 1200x630: usa la imagen como "logo" centrado con fondo
async function buildOg1200x630Jpg(buffer) {
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

  return bg
    .composite([{ input: logo, gravity: "center" }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

async function uploadShopAsset({ file, kind }) {
  if (!file || !file.buffer) {
    const e = new Error("FILE_REQUIRED");
    e.statusCode = 400;
    throw e;
  }

  const safeKind = String(kind || "").trim();
  const ts = Date.now();

  let key;
  let outBuf = file.buffer;
  let contentType = file.mimetype || "application/octet-stream";
  let cacheControl = "public, max-age=31536000, immutable";

  if (safeKind === "favicon") {
    outBuf = await buildFavicon64Png(file.buffer);
    contentType = "image/png";
    cacheControl = "public, max-age=3600"; // cambia cuando lo reemplazás
    key = "shop/favicon.png"; // ✅ estable (SIN bucket)
  } else if (safeKind === "og-image") {
    outBuf = await buildOg1200x630Jpg(file.buffer);
    contentType = "image/jpeg";
    cacheControl = "public, max-age=3600";
    key = "shop/og-default.jpg"; // ✅ estable (SIN bucket)
  } else if (safeKind === "logo") {
    const ext = extFromMime(file.mimetype);
    key = `shop/${ts}-logo.${ext}`; // versionado
  } else if (safeKind === "holiday-overlay") {
    if (!isAllowedHolidayOverlayMime(file.mimetype)) {
      const e = new Error(
        "HOLIDAY_OVERLAY_INVALID_MIME: Aceptamos PNG, JPG, WebP, GIF, MP4, WebM o MOV."
      );
      e.statusCode = 400;
      throw e;
    }
    const ext = extFromMime(file.mimetype);
    key = `shop/${ts}-holiday.${ext}`; // versionado para evitar caché
    cacheControl = "public, max-age=86400"; // 1 día (más cortito porque es seasonal)
  } else {
    const ext = extFromMime(file.mimetype);
    key = `shop/${ts}-asset.${ext}`;
  }

  const up = await putObject({ key, buffer: outBuf, contentType, cacheControl });
  return { url: up.url, key: up.key, contentType: up.contentType };
}

module.exports = { uploadShopAsset, HOLIDAY_OVERLAY_ALLOWED_MIMES };
