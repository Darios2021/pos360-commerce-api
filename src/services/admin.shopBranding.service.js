// src/services/admin.shopBranding.service.js
// ✅ COPY-PASTE FINAL DEFINITIVO (S3/MinIO + favicon 64x64 + OG 1200x630)
// - kind: "logo"      => sube tal cual (cache largo)
// - kind: "favicon"   => PNG 64x64, key estable: pos360/shop/favicon.png
// - kind: "og-image"  => JPG 1200x630, key estable: pos360/shop/og-default.jpg
//
// ⚠️ IMPORTANTE (TU CASO):
// Tu storage público ya sirve como: https://storage-files.cingulado.org/<key>
// (no incluye /<bucket>/ en la URL), porque tus URLs actuales son:
//   https://storage-files.cingulado.org/pos360/shop/....png
// Por eso publicUrlFromKey() NO concatena bucket.

const sharp = require("sharp");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3, s3Config } = require("../config/s3");

function publicUrlFromKey(key) {
  const pub = String(process.env.S3_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const cleanKey = String(key || "").replace(/^\/+/, "");
  if (!pub) return `/${cleanKey}`;
  // ✅ tu storage ya expone directo por key
  return `${pub}/${cleanKey}`;
}

function extFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("svg")) return "svg";
  if (m.includes("x-icon") || m.includes("ico")) return "ico";
  return "bin";
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

  // defaults
  let key;
  let outBuf = file.buffer;
  let contentType = file.mimetype || "application/octet-stream";
  let cacheControl = "public, max-age=31536000, immutable";

  if (safeKind === "favicon") {
    outBuf = await buildFavicon64Png(file.buffer);
    contentType = "image/png";
    cacheControl = "public, max-age=86400";
    key = "pos360/shop/favicon.png"; // ✅ estable
  } else if (safeKind === "og-image") {
    outBuf = await buildOg1200x630Jpg(file.buffer);
    contentType = "image/jpeg";
    cacheControl = "public, max-age=3600";
    key = "pos360/shop/og-default.jpg"; // ✅ estable
  } else if (safeKind === "logo") {
    const ext = extFromMime(file.mimetype);
    key = `pos360/shop/${ts}-logo.${ext}`;
  } else {
    const ext = extFromMime(file.mimetype);
    key = `pos360/shop/${ts}-asset.${ext}`;
  }

  const up = await putObject({ key, buffer: outBuf, contentType, cacheControl });
  return { url: up.url, key: up.key, contentType: up.contentType };
}

module.exports = { uploadShopAsset };
