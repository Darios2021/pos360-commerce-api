// src/controllers/productVideos.controller.js
// ✅ Videos por producto (YouTube link o Upload a MinIO)
// Rutas sugeridas:
// GET    /api/v1/admin/products/:id/videos
// POST   /api/v1/admin/products/:id/videos/youtube   { url, title? }
// POST   /api/v1/admin/products/:id/videos/upload    multipart: file + title?
// DELETE /api/v1/admin/products/:id/videos/:videoId

const crypto = require("crypto");
const path = require("path");
const { ProductVideo } = require("../models");

// ⚠️ AJUSTÁ estos imports a tu proyecto si ya tenés minio client/config
const { minioClient } = require("../config/minio"); // <- si no existe, lo ajustamos
const MINIO_BUCKET_PRODUCTS = process.env.MINIO_BUCKET_PRODUCTS || "products";

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toStr(v) {
  return String(v ?? "").trim();
}

function extractYoutubeId(url) {
  const u = toStr(url);
  if (!u) return null;

  const m1 = u.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{6,})/i);
  if (m1?.[1]) return m1[1];

  const m2 = u.match(/[?&]v=([a-zA-Z0-9_-]{6,})/i);
  if (m2?.[1]) return m2[1];

  const m3 = u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/i);
  if (m3?.[1]) return m3[1];

  const m4 = u.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/i);
  if (m4?.[1]) return m4[1];

  return null;
}

function normalizeYoutubeEmbed(url) {
  const id = extractYoutubeId(url);
  if (!id) return null;
  return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;
}

function safeExtFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("mp4")) return ".mp4";
  if (m.includes("webm")) return ".webm";
  if (m.includes("quicktime")) return ".mov";
  return "";
}

function buildVideoKey(productId, originalName, mime) {
  const ext = path.extname(String(originalName || "")) || safeExtFromMime(mime) || ".mp4";
  const rnd = crypto.randomBytes(10).toString("hex");
  return `products/${productId}/videos/${rnd}${ext}`;
}

async function list(req, res) {
  const productId = toInt(req.params.id, 0);
  if (!productId) return res.status(400).json({ ok: false, message: "Invalid product id" });

  const rows = await ProductVideo.findAll({
    where: { product_id: productId, is_active: true },
    order: [["sort_order", "ASC"], ["id", "DESC"]],
  });

  return res.json({ ok: true, data: rows });
}

async function addYoutube(req, res) {
  const productId = toInt(req.params.id, 0);
  const url = toStr(req.body?.url);
  const title = toStr(req.body?.title);

  if (!productId) return res.status(400).json({ ok: false, message: "Invalid product id" });
  if (!url) return res.status(400).json({ ok: false, message: "URL requerida" });

  const embed = normalizeYoutubeEmbed(url);
  if (!embed) return res.status(400).json({ ok: false, message: "URL de YouTube inválida (short/watch/youtu.be)" });

  const row = await ProductVideo.create({
    product_id: productId,
    provider: "youtube",
    title: title || null,
    url: embed,
    mime: "text/html",
    sort_order: 0,
    is_active: true,
  });

  return res.json({ ok: true, data: row });
}

async function upload(req, res) {
  const productId = toInt(req.params.id, 0);
  if (!productId) return res.status(400).json({ ok: false, message: "Invalid product id" });

  const f = req.file;
  if (!f) return res.status(400).json({ ok: false, message: "Falta archivo (file)" });

  const mime = toStr(f.mimetype);
  const size = toInt(f.size, 0);

  if (!mime.startsWith("video/")) {
    return res.status(400).json({ ok: false, message: "El archivo debe ser video (video/*)" });
  }
  if (size > 80 * 1024 * 1024) {
    return res.status(400).json({ ok: false, message: "Video muy grande (max 80MB)" });
  }

  const key = buildVideoKey(productId, f.originalname, mime);

  // subir a MinIO
  await minioClient.putObject(MINIO_BUCKET_PRODUCTS, key, f.buffer, {
    "Content-Type": mime || "application/octet-stream",
  });

  const row = await ProductVideo.create({
    product_id: productId,
    provider: "minio",
    title: toStr(req.body?.title) || null,
    url: null,
    storage_bucket: MINIO_BUCKET_PRODUCTS,
    storage_key: key,
    mime,
    size_bytes: size || null,
    sort_order: 0,
    is_active: true,
  });

  return res.json({ ok: true, data: row });
}

async function remove(req, res) {
  const productId = toInt(req.params.id, 0);
  const videoId = toInt(req.params.videoId, 0);
  if (!productId || !videoId) return res.status(400).json({ ok: false, message: "Invalid ids" });

  const row = await ProductVideo.findOne({ where: { id: videoId, product_id: productId } });
  if (!row) return res.status(404).json({ ok: false, message: "Not found" });

  row.is_active = false;
  await row.save();

  return res.json({ ok: true });
}

module.exports = {
  list,
  addYoutube,
  upload,
  remove,
};
