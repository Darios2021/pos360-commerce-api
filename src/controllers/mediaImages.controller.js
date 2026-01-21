// src/controllers/mediaImages.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Fuente de verdad:
// - Storage: lista de archivos (S3/MinIO) => "galería"
// - DB: product_images.url               => "usos"
//
// Endpoints:
// - GET    /api/v1/admin/media/images?page&limit&q
// - POST   /api/v1/admin/media/images  (multipart file)
// - DELETE /api/v1/admin/media/images/:id

const crypto = require("crypto");
const { Sequelize } = require("sequelize");
const { ProductImage, sequelize } = require("../models");
const AWS = require("aws-sdk");

// ====== ENV / S3 ======
function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
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

const BUCKET = process.env.S3_BUCKET || process.env.S3_BUCKET_PUBLIC || process.env.S3_BUCKET_NAME;
if (!BUCKET) console.warn("⚠️ mediaImages.controller: Falta S3_BUCKET (list/upload/delete dependen de esto).");

const PUBLIC_BASE =
  (process.env.S3_PUBLIC_BASE_URL || process.env.S3_PUBLIC_URL || "").replace(/\/+$/, "");

// ✅ IMPORTANTE: por defecto listamos products + media
// Podés overridearlo con env: S3_MEDIA_PREFIXES="pos360/products,pos360/media"
const PREFIXES = String(process.env.S3_MEDIA_PREFIXES || "pos360/products,pos360/media")
  .split(",")
  .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
  .filter(Boolean);

// ✅ Donde se suben las imágenes del admin (si no querés subir a products)
const UPLOAD_PREFIX = String(process.env.S3_MEDIA_UPLOAD_PREFIX || "pos360/media")
  .trim()
  .replace(/^\/+|\/+$/g, "");

// ====== HELPERS ======
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function pickFilename(urlOrKey) {
  const s = String(urlOrKey || "");
  const last = s.split("?")[0].split("#")[0];
  return last.substring(last.lastIndexOf("/") + 1) || last;
}

function buildPublicUrl(key) {
  if (PUBLIC_BASE) return `${PUBLIC_BASE}/${key}`;
  return key;
}

// ====== DB: usos por filename ======
async function mapUsedCountsByFilename() {
  const rows = await sequelize.query(
    `
    SELECT
      SUBSTRING_INDEX(url, '/', -1) AS filename,
      COUNT(*) AS used_count
    FROM product_images
    GROUP BY filename
  `,
    { type: Sequelize.QueryTypes.SELECT }
  );

  const m = new Map();
  for (const r of rows) m.set(String(r.filename), Number(r.used_count || 0));
  return m;
}

// ====== STORAGE: listar objetos por múltiples prefixes ======
async function listStorageObjects({ q }) {
  if (!BUCKET) return [];

  const s3 = s3Client();
  const qLower = String(q || "").trim().toLowerCase();

  const all = [];

  for (const pref of PREFIXES) {
    const Prefix = pref ? `${pref}/` : "";
    let token = null;
    let isTruncated = true;

    while (isTruncated) {
      const resp = await s3
        .listObjectsV2({
          Bucket: BUCKET,
          Prefix,
          ContinuationToken: token || undefined,
          MaxKeys: 1000,
        })
        .promise();

      token = resp.NextContinuationToken || null;
      isTruncated = Boolean(resp.IsTruncated);

      const items = (resp.Contents || [])
        .map((x) => ({
          key: x.Key,
          filename: pickFilename(x.Key),
          size: Number(x.Size || 0),
          last_modified: x.LastModified ? new Date(x.LastModified).toISOString() : null,
          url: buildPublicUrl(x.Key),
        }))
        .filter((x) => x.key && !x.key.endsWith("/"));

      for (const it of items) {
        if (!qLower || it.filename.toLowerCase().includes(qLower)) all.push(it);
      }
    }
  }

  // orden newest first (para que tenga sentido en admin)
  all.sort((a, b) => String(b.last_modified || "").localeCompare(String(a.last_modified || "")));

  return all;
}

// ====== HANDLERS ======

/**
 * GET /api/v1/admin/media/images?page=1&limit=60&q=...
 */
exports.listAll = async (req, res) => {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.max(1, Math.min(200, toInt(req.query.limit, 60)));
    const q = String(req.query.q || "").trim();

    const usedMap = await mapUsedCountsByFilename();
    const all = await listStorageObjects({ q });

    const total = all.length;
    const start = (page - 1) * limit;
    const end = start + limit;

    const pageItems = all.slice(start, end).map((img) => {
      const used_count = usedMap.get(img.filename) || 0;
      return { ...img, used_count, is_used: used_count > 0 };
    });

    res.json({ ok: true, page, limit, total, items: pageItems });
  } catch (err) {
    console.error("❌ [admin media] listAll:", err);
    res.status(500).json({ ok: false, message: err.message || "Error listando imágenes" });
  }
};

/**
 * POST /api/v1/admin/media/images (multipart/form-data file=...)
 */
exports.uploadOne = async (req, res) => {
  try {
    if (!BUCKET) return res.status(500).json({ ok: false, message: "Falta S3_BUCKET en env" });

    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, message: "Falta archivo (field: file)" });

    const ext = (file.originalname || "").split(".").pop()?.toLowerCase() || "bin";
    const stamp = Date.now();
    const rnd = crypto.randomBytes(6).toString("hex");
    const filename = `${stamp}-${rnd}.${ext}`;

    const key = UPLOAD_PREFIX ? `${UPLOAD_PREFIX}/${filename}` : filename;

    const s3 = s3Client();
    await s3
      .putObject({
        Bucket: BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype || "application/octet-stream",
        ACL: "public-read",
      })
      .promise();

    res.json({ ok: true, key, filename, url: buildPublicUrl(key) });
  } catch (err) {
    console.error("❌ [admin media] uploadOne:", err);
    res.status(500).json({ ok: false, message: err.message || "Error subiendo imagen" });
  }
};

/**
 * DELETE /api/v1/admin/media/images/:id
 * Bloquea si está usada por productos (409).
 */
exports.removeById = async (req, res) => {
  try {
    if (!BUCKET) return res.status(500).json({ ok: false, message: "Falta S3_BUCKET en env" });

    const raw = String(req.params.id || "").trim();
    if (!raw) return res.status(400).json({ ok: false, message: "Falta id" });

    const filename = pickFilename(raw);

    const used = await ProductImage.count({
      where: sequelize.where(sequelize.fn("SUBSTRING_INDEX", sequelize.col("url"), "/", -1), filename),
    });

    if (used > 0) {
      return res.status(409).json({
        ok: false,
        message: `No se puede eliminar: imagen usada en ${used} producto(s)`,
        used_count: used,
        filename,
      });
    }

    // Resolver key:
    // - si vino URL -> sacamos pathname
    // - si vino key -> lo usamos
    // - si vino filename -> intentamos borrar en upload prefix (media)
    let key = null;

    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      key = u.pathname.replace(/^\/+/, "");
    } else if (raw.includes("/") && raw.includes(".")) {
      key = raw.replace(/^\/+/, "");
    } else {
      key = UPLOAD_PREFIX ? `${UPLOAD_PREFIX}/${filename}` : filename;
    }

    const s3 = s3Client();
    await s3.deleteObject({ Bucket: BUCKET, Key: key }).promise();

    res.json({ ok: true, deleted: true, filename, key });
  } catch (err) {
    console.error("❌ [admin media] removeById:", err);
    res.status(500).json({ ok: false, message: err.message || "Error eliminando imagen" });
  }
};
