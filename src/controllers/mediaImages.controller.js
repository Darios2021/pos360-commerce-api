// src/controllers/mediaImages.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
// Galería global (Admin): listar y eliminar imágenes (DB ProductImage) + opcional borrar MinIO

const AWS = require("aws-sdk");
const { Op } = require("sequelize");
const { ProductImage } = require("../models");

/* =====================
   Helpers
   ===================== */
function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

/* =====================
   S3 / MinIO
   ===================== */
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

// inferir Key desde URL pública (para delete)
function keyFromPublicUrl(url) {
  if (!url) return null;
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return null;

  try {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/+/, "");
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

/* =====================
   LIST GLOBAL
   GET /api/v1/admin/media/images?page=&limit=&q=&product_id=
   ===================== */
async function listAll(req, res) {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(200, Math.max(12, toInt(req.query.limit, 60)));
    const q = String(req.query.q ?? "").trim();
    const productId = toInt(req.query.product_id, 0);

    const where = {};
    if (productId) where.product_id = productId;

    if (q) {
      const qNum = toInt(q, 0);
      where[Op.or] = [
        { url: { [Op.like]: `%${q}%` } },
        ...(qNum ? [{ id: qNum }] : []),
      ];
    }

    const offset = (page - 1) * limit;

    const { rows, count } = await ProductImage.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
    });

    return res.json({
      ok: true,
      page,
      limit,
      total: count,
      pages: Math.ceil(count / limit),
      items: rows,
    });
  } catch (e) {
    console.error("❌ [mediaImages.listAll]", e);
    return res.status(500).json({
      ok: false,
      code: "MEDIA_LIST_ERROR",
      message: e.message,
    });
  }
}

/* =====================
   DELETE GLOBAL
   DELETE /api/v1/admin/media/images/:id
   (si S3_DELETE_ON_REMOVE=true también borra en MinIO)
   ===================== */
async function removeById(req, res) {
  try {
    const imageId = toInt(req.params.id, 0);
    if (!imageId) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "imageId inválido",
      });
    }

    const img = await ProductImage.findByPk(imageId);
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
          console.warn("⚠️ No se pudo borrar objeto S3:", e?.message || e);
        }
      }
    }

    await img.destroy();
    return res.json({ ok: true, message: "Imagen eliminada" });
  } catch (e) {
    console.error("❌ [mediaImages.removeById]", e);
    return res.status(500).json({
      ok: false,
      code: "MEDIA_DELETE_ERROR",
      message: e.message,
    });
  }
}

module.exports = {
  listAll,
  removeById,
};
