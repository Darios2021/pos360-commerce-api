// src/controllers/productImages.controller.js
const AWS = require("aws-sdk");
const crypto = require("crypto");
const path = require("path");
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
    const results = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      const key = `products/${productId}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;

      await s3
        .putObject({
          Bucket: mustEnv("S3_BUCKET"),
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          ACL: "public-read",
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
