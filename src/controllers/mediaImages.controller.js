// src/controllers/mediaImages.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Fuente de verdad:
// - Storage: lista de archivos (S3/MinIO) => "galería"
// - DB: product_images.url               => "usos"
//
// Endpoints:
// - GET    /api/v1/admin/media/images?page&limit&q&debug=1
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
const PUBLIC_BASE = (process.env.S3_PUBLIC_BASE_URL || process.env.S3_PUBLIC_URL || "").replace(/\/+$/, "");

const PREFIXES = String(process.env.S3_MEDIA_PREFIXES || "pos360/products,pos360/media")
  .split(",")
  .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
  .filter(Boolean);

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

function runtimeConfig() {
  return {
    bucket: BUCKET || null,
    public_base: PUBLIC_BASE || null,
    prefixes: PREFIXES,
    upload_prefix: UPLOAD_PREFIX || null,
    endpoint: process.env.S3_ENDPOINT || null,
    ssl_enabled: String(process.env.S3_SSL_ENABLED ?? "true"),
    region: process.env.S3_REGION || "us-east-1",
  };
}

// ====== DB: usos por filename ======
// ✅ corta querystring antes de extraer filename (como tu ejemplo)
async function mapUsedCountsByFilename() {
  const rows = await sequelize.query(
    `
    SELECT
      SUBSTRING_INDEX(SUBSTRING_INDEX(url, '?', 1), '/', -1) AS filename,
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

  all.sort((a, b) => String(b.last_modified || "").localeCompare(String(a.last_modified || "")));
  return all;
}

// ✅ Resolver key real por filename (busca en prefixes y devuelve el primer match)
async function resolveKeyByFilename(filename) {
  const s3 = s3Client();
  const needle = `/${filename}`;

  const candidates = [...(UPLOAD_PREFIX ? [UPLOAD_PREFIX] : []), ...PREFIXES].filter(Boolean);

  for (const pref of candidates) {
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

      const found = (resp.Contents || []).find((x) => x?.Key && x.Key.endsWith(needle));
      if (found?.Key) return found.Key;
    }
  }

  return null;
}

// ====== HANDLERS ======

/**
 * GET /api/v1/admin/media/images?page=1&limit=60&q=...&debug=1
 */
exports.listAll = async (req, res) => {
  try {
    if (!BUCKET) {
      return res.status(500).json({
        ok: false,
        message:
          "Falta S3_BUCKET (o S3_BUCKET_PUBLIC / S3_BUCKET_NAME). Sin bucket no se puede listar el storage.",
        config: runtimeConfig(),
      });
    }

    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.max(1, Math.min(200, toInt(req.query.limit, 60)));
    const q = String(req.query.q || "").trim();
    const debug = String(req.query.debug || "") === "1";

    const usedMap = await mapUsedCountsByFilename();
    const all = await listStorageObjects({ q });

    const total = all.length;
    const start = (page - 1) * limit;
    const end = start + limit;

    const pageItems = all.slice(start, end).map((img) => {
      const used_count = usedMap.get(img.filename) || 0;
      return { ...img, used_count, is_used: used_count > 0 };
    });

    const payload = { ok: true, page, limit, total, items: pageItems };

    if (debug) {
      payload.config = runtimeConfig();
      payload.sample_keys = all.slice(0, 10).map((x) => x.key);
    }

    res.json(payload);
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
    if (!BUCKET) {
      return res.status(500).json({
        ok: false,
        message: "Falta S3_BUCKET (o S3_BUCKET_PUBLIC / S3_BUCKET_NAME) en env",
        config: runtimeConfig(),
      });
    }

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
    if (!BUCKET) {
      return res.status(500).json({
        ok: false,
        message: "Falta S3_BUCKET (o S3_BUCKET_PUBLIC / S3_BUCKET_NAME) en env",
        config: runtimeConfig(),
      });
    }

    const raw = String(req.params.id || "").trim();
    if (!raw) return res.status(400).json({ ok: false, message: "Falta id" });

    const filename = pickFilename(raw);

    // ✅ FIX: cortar querystring antes de comparar (consistente con tu SQL)
    const used = await ProductImage.count({
      where: sequelize.where(
        sequelize.fn(
          "SUBSTRING_INDEX",
          sequelize.fn("SUBSTRING_INDEX", sequelize.col("url"), "?", 1),
          "/",
          -1
        ),
        filename
      ),
    });

    if (used > 0) {
      return res.status(409).json({
        ok: false,
        message: `No se puede eliminar: imagen usada en ${used} producto(s)`,
        used_count: used,
        filename,
      });
    }

    let key = null;

    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      key = u.pathname.replace(/^\/+/, "");
    } else if (raw.includes("/") && raw.includes(".")) {
      key = raw.replace(/^\/+/, "");
    } else {
      key = await resolveKeyByFilename(filename);
      if (!key) {
        return res.status(404).json({
          ok: false,
          message: "No se encontró el archivo en el bucket con los prefixes configurados",
          filename,
          config: runtimeConfig(),
        });
      }
    }

    const s3 = s3Client();
    await s3.deleteObject({ Bucket: BUCKET, Key: key }).promise();

    res.json({ ok: true, deleted: true, filename, key });
  } catch (err) {
    console.error("❌ [admin media] removeById:", err);
    res.status(500).json({ ok: false, message: err.message || "Error eliminando imagen" });
  }
};
