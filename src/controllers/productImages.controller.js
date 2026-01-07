// src/controllers/productImages.controller.js
const AWS = require("aws-sdk");
const crypto = require("crypto");
const { fileTypeFromBuffer } = require("file-type");
const sharp = require("sharp");
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

function s3Client() {
  return new AWS.S3({
    endpoint: mustEnv("S3_ENDPOINT"),
    accessKeyId: mustEnv("S3_ACCESS_KEY"),
    secretAccessKey: mustEnv("S3_SECRET_KEY"),
    s3ForcePathStyle: true,
    signatureVersion: "v4",
    sslEnabled: String(process.env.S3_SSL_ENABLED ?? "true") === "true",
    region: process.env.S3_REGION || "us-east-1",
  });
}

function publicUrlFor(key) {
  const base = process.env.S3_PUBLIC_BASE_URL || process.env.S3_ENDPOINT;
  const bucket = mustEnv("S3_BUCKET");
  const cleanBase = String(base).replace(/\/$/, "");
  return `${cleanBase}/${bucket}/${key}`;
}

// (opcional) intentar inferir Key desde URL pública
function keyFromPublicUrl(url) {
  if (!url) return null;
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return null;

  try {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/+/, ""); // sin leading slash
    const idx = p.indexOf(`${bucket}/`);
    if (idx === -1) return null;
    return p.substring(idx + `${bucket}/`.length);
  } catch {
    const s = String(url);
    const marker = `/${bucket}/`;
    const i = s.indexOf(marker);
    if (i === -1) return null;
    return s.substring(i + marker.length);
  }
}

/**
 * =========================
 * NORMALIZACIÓN DE IMÁGENES
 * =========================
 * Acepta entrada: JPG/PNG/WebP
 * Guarda SIEMPRE: WebP
 *
 * Env opcionales:
 * - IMG_MAX_UPLOAD_BYTES (default 6MB)
 * - IMG_MAX_WIDTH (default 1200)
 * - IMG_WEBP_QUALITY (default 75)
 */
const IMG_MAX_UPLOAD_BYTES = Number(process.env.IMG_MAX_UPLOAD_BYTES || 6 * 1024 * 1024);
const IMG_MAX_WIDTH = Number(process.env.IMG_MAX_WIDTH || 1200);
const IMG_WEBP_QUALITY = Number(process.env.IMG_WEBP_QUALITY || 75);

const ALLOWED_INPUT_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

async function normalizeToWebp(buffer) {
  // rotate() respeta orientación EXIF
  return sharp(buffer)
    .rotate()
    .resize({ width: IMG_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: IMG_WEBP_QUALITY })
    .toBuffer();
}

async function upload(req, res) {
  try {
    const productId = toInt(req.params.id, 0);
    if (!productId) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "productId inválido",
      });
    }

    // multer.any() => req.files array
    let files = [];
    if (req.files) {
      files = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
    } else if (req.file) {
      files = [req.file];
    }

    if (files.length === 0) {
      return res.status(400).json({
        ok: false,
        code: "NO_FILES",
        message: "No se recibió ningún archivo",
      });
    }

    const s3 = s3Client();
    const bucket = mustEnv("S3_BUCKET");
    const results = [];

    for (const file of files) {
      if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
        return res.status(400).json({
          ok: false,
          code: "BAD_FILE",
          message: "Archivo inválido (sin buffer). Revisá multer memoryStorage().",
        });
      }

      // ✅ límite de tamaño
      if (file.buffer.length > IMG_MAX_UPLOAD_BYTES) {
        return res.status(413).json({
          ok: false,
          code: "IMG_TOO_LARGE",
          message: `Imagen demasiado grande. Máximo ${IMG_MAX_UPLOAD_BYTES} bytes.`,
        });
      }

      // ✅ detectar mime real por bytes (no confiar en extension/mimetype)
      const ft = await fileTypeFromBuffer(file.buffer);
      const realMime = ft?.mime || "";

      if (!ALLOWED_INPUT_MIME.has(realMime)) {
        return res.status(415).json({
          ok: false,
          code: "IMG_FORMAT_NOT_ALLOWED",
          message: `Formato no permitido (${realMime || "unknown"}). Usá JPG/PNG/WebP.`,
        });
      }

      // ✅ convertir SIEMPRE a webp
      const webpBuffer = await normalizeToWebp(file.buffer);

      // ✅ key SIEMPRE .webp
      const key = `products/${productId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.webp`;

      await s3
        .putObject({
          Bucket: bucket,
          Key: key,
          Body: webpBuffer,
          ContentType: "image/webp",
          ACL: "public-read",
          CacheControl: "public, max-age=31536000, immutable",
        })
        .promise();

      const img = await ProductImage.create({
        product_id: productId,
        url: publicUrlFor(key),
        sort_order: 0,
      });

      results.push(img);
    }

    return res.status(201).json({
      ok: true,
      uploaded: results.length,
      items: results,
    });
  } catch (e) {
    console.error("❌ [productImages.upload] ERROR:", e);
    return res.status(500).json({
      ok: false,
      code: "UPLOAD_ERROR",
      message: e.message,
    });
  }
}

async function listByProduct(req, res, next) {
  try {
    const productId = toInt(req.params.id, 0);
    if (!productId) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "productId inválido",
      });
    }

    const items = await ProductImage.findAll({
      where: { product_id: productId },
      order: [["sort_order", "ASC"], ["id", "ASC"]],
    });

    return res.json({ ok: true, items });
  } catch (e) {
    next(e);
  }
}

// ✅ DELETE /products/:id/images/:imageId
// - borra DB
// - opcional: borra también en MinIO si S3_DELETE_ON_REMOVE=true
async function remove(req, res, next) {
  try {
    const productId = toInt(req.params.id, 0);
    const imageId = toInt(req.params.imageId, 0);

    if (!productId || !imageId) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "IDs inválidos",
      });
    }

    const img = await ProductImage.findOne({
      where: { id: imageId, product_id: productId },
    });

    if (!img) {
      return res.status(404).json({
        ok: false,
        code: "NOT_FOUND",
        message: "Imagen no encontrada",
      });
    }

    const doDelete = String(process.env.S3_DELETE_ON_REMOVE ?? "false") === "true";
    if (doDelete) {
      const key = keyFromPublicUrl(img.url);
      if (key) {
        const s3 = s3Client();
        try {
          await s3
            .deleteObject({
              Bucket: mustEnv("S3_BUCKET"),
              Key: key,
            })
            .promise();
        } catch (e) {
          console.warn("⚠️ No se pudo borrar objeto en S3/MinIO:", e?.message || e);
        }
      }
    }

    await img.destroy();
    return res.json({ ok: true, message: "Imagen eliminada" });
  } catch (e) {
    next(e);
  }
}

module.exports = { listByProduct, upload, remove };
