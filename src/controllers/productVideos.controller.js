// src/controllers/productVideos.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (S3.js + ANTI-CRASH + modelo ProductVideo auto-resolve)
// Videos por producto (YouTube link o Upload S3/MinIO via @aws-sdk/client-s3)
//
// Rutas sugeridas (compat):
// GET    /api/v1/products/:id/videos
// GET    /api/v1/admin/products/:id/videos            (alias via v1.routes)
// POST   /api/v1/products/:id/videos/youtube          { url, title? }
// POST   /api/v1/products/:id/videos/upload           multipart: file + title?
// DELETE /api/v1/products/:id/videos/:videoId
//
// Requiere:
// - src/config/s3.js exporta { s3, s3Config }
// - ProductVideo model exista y esté cargado por Sequelize (sequelize.models)

const crypto = require("crypto");
const path = require("path");
const { PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { s3, s3Config } = require("../config/s3");

// Import flexible de models (depende de tu proyecto)
let models = null;
try {
  models = require("../models");
} catch (e) {
  models = null;
}

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toStr(v) {
  return String(v ?? "").trim();
}

function resolveProductVideoModel() {
  // 1) desde index ../models
  if (models && typeof models === "object") {
    if (models.ProductVideo) return models.ProductVideo;
    if (models.ProductVideos) return models.ProductVideos;
    if (models.productVideo) return models.productVideo;
    if (models.product_videos) return models.product_videos;
    if (models.product_videos_model) return models.product_videos_model;
    if (models.sequelize?.models?.ProductVideo) return models.sequelize.models.ProductVideo;
    if (models.sequelize?.models?.ProductVideos) return models.sequelize.models.ProductVideos;
  }

  // 2) si existe models/index.js con sequelize exportado globalmente
  try {
    const { sequelize } = require("../models");
    if (sequelize?.models?.ProductVideo) return sequelize.models.ProductVideo;
    if (sequelize?.models?.ProductVideos) return sequelize.models.ProductVideos;
  } catch (e) {
    // ignore
  }

  return null;
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
  try {
    const ProductVideo = resolveProductVideoModel();
    if (!ProductVideo || typeof ProductVideo.findAll !== "function") {
      return res.status(500).json({
        ok: false,
        code: "PRODUCT_VIDEO_MODEL_NOT_FOUND",
        message:
          "No se encontró el model ProductVideo (o no tiene findAll). Revisá exports en src/models/index.js y el nombre del model.",
      });
    }

    const productId = toInt(req.params.id, 0);
    if (!productId) return res.status(400).json({ ok: false, message: "Invalid product id" });

    const rows = await ProductVideo.findAll({
      where: { product_id: productId, is_active: true },
      order: [["sort_order", "ASC"], ["id", "DESC"]],
    });

    return res.json({ ok: true, data: rows });
  } catch (e) {
    console.error("[productVideos.list] error:", e);
    return res.status(500).json({ ok: false, code: "VIDEO_LIST_ERROR", message: e.message || "Error" });
  }
}

async function addYoutube(req, res) {
  try {
    const ProductVideo = resolveProductVideoModel();
    if (!ProductVideo || typeof ProductVideo.create !== "function") {
      return res.status(500).json({
        ok: false,
        code: "PRODUCT_VIDEO_MODEL_NOT_FOUND",
        message: "No se encontró el model ProductVideo (o no tiene create).",
      });
    }

    const productId = toInt(req.params.id, 0);
    const url = toStr(req.body?.url);
    const title = toStr(req.body?.title);

    if (!productId) return res.status(400).json({ ok: false, message: "Invalid product id" });
    if (!url) return res.status(400).json({ ok: false, message: "URL requerida" });

    const embed = normalizeYoutubeEmbed(url);
    if (!embed) {
      return res.status(400).json({
        ok: false,
        message: "URL de YouTube inválida (short/watch/youtu.be/embed)",
      });
    }

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
  } catch (e) {
    console.error("[productVideos.addYoutube] error:", e);
    return res.status(500).json({ ok: false, code: "VIDEO_YOUTUBE_ERROR", message: e.message || "Error" });
  }
}

async function upload(req, res) {
  try {
    const ProductVideo = resolveProductVideoModel();
    if (!ProductVideo || typeof ProductVideo.create !== "function") {
      return res.status(500).json({
        ok: false,
        code: "PRODUCT_VIDEO_MODEL_NOT_FOUND",
        message: "No se encontró el model ProductVideo (o no tiene create).",
      });
    }

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

    const bucket = s3Config.bucket; // usa tu S3_BUCKET
    const key = buildVideoKey(productId, f.originalname, mime);

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: f.buffer,
        ContentType: mime || "application/octet-stream",
      })
    );

    const row = await ProductVideo.create({
      product_id: productId,
      provider: s3Config.provider || "s3",
      title: toStr(req.body?.title) || null,
      url: null,
      storage_bucket: bucket,
      storage_key: key,
      mime,
      size_bytes: size || null,
      sort_order: 0,
      is_active: true,
    });

    return res.json({ ok: true, data: row });
  } catch (e) {
    console.error("[productVideos.upload] error:", e);
    return res.status(500).json({ ok: false, code: "VIDEO_UPLOAD_ERROR", message: e.message || "Error" });
  }
}

async function remove(req, res) {
  try {
    const ProductVideo = resolveProductVideoModel();
    if (!ProductVideo || typeof ProductVideo.findOne !== "function") {
      return res.status(500).json({
        ok: false,
        code: "PRODUCT_VIDEO_MODEL_NOT_FOUND",
        message: "No se encontró el model ProductVideo (o no tiene findOne).",
      });
    }

    const productId = toInt(req.params.id, 0);
    const videoId = toInt(req.params.videoId, 0);
    if (!productId || !videoId) return res.status(400).json({ ok: false, message: "Invalid ids" });

    const row = await ProductVideo.findOne({ where: { id: videoId, product_id: productId } });
    if (!row) return res.status(404).json({ ok: false, message: "Not found" });

    // soft-delete
    row.is_active = false;
    await row.save();

    // opcional: borrar del bucket si querés (yo lo dejo safe: solo si tiene key+bucket)
    if (row.storage_bucket && row.storage_key) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: row.storage_bucket,
            Key: row.storage_key,
          })
        );
      } catch (e) {
        // no frenamos: ya quedó inactivo en DB
        console.warn("[productVideos.remove] DeleteObject warning:", e?.message || e);
      }
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("[productVideos.remove] error:", e);
    return res.status(500).json({ ok: false, code: "VIDEO_REMOVE_ERROR", message: e.message || "Error" });
  }
}

module.exports = {
  list,
  addYoutube,
  upload,
  remove,
};
