// src/controllers/mediaImages.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Fuente de verdad:
// - Storage: lista de archivos (S3/MinIO) => "galería"
// - DB: product_images.url               => "usos"
//
// Endpoints:
// - GET    /api/v1/admin/media/images?page&limit&q&used&product_id&category_id&subcategory_id
// - POST   /api/v1/admin/media/images  (multipart file)
// - PUT    /api/v1/admin/media/images/:id   (multipart overwrite: key/url/filename -> mismo key)
// - DELETE /api/v1/admin/media/images/:id
// - GET    /api/v1/admin/media/images/used-by/:filename

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
function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === null || v === "") return fallback;
  return String(v).toLowerCase() === "true" || String(v) === "1";
}

const BUCKET = process.env.S3_BUCKET || process.env.S3_BUCKET_PUBLIC || process.env.S3_BUCKET_NAME;
if (!BUCKET) console.warn("⚠️ mediaImages.controller: Falta S3_BUCKET (list/upload/delete dependen de esto).");

const PUBLIC_BASE = (process.env.S3_PUBLIC_BASE_URL || process.env.S3_PUBLIC_URL || "").replace(/\/+$/, "");

// objetos típicos: products/9/xxx.webp + media/xxx.webp
const PREFIXES = String(process.env.S3_MEDIA_PREFIXES || "products,media")
  .split(",")
  .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
  .filter(Boolean);

const UPLOAD_PREFIX = String(process.env.S3_MEDIA_UPLOAD_PREFIX || "media").trim().replace(/^\/+|\/+$/g, "");

function s3Client() {
  const forcePath = envBool("S3_FORCE_PATH_STYLE", true);
  const sslEnabled = envBool("S3_SSL_ENABLED", envBool("S3_SSL", false));

  return new AWS.S3({
    endpoint: mustEnv("S3_ENDPOINT"),
    accessKeyId: mustEnv("S3_ACCESS_KEY"),
    secretAccessKey: mustEnv("S3_SECRET_KEY"),
    s3ForcePathStyle: forcePath,
    signatureVersion: "v4",
    sslEnabled,
    region: process.env.S3_REGION || "us-east-1",
  });
}

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

function normalizeKeyFromRaw(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";

  // URL
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    let key = u.pathname.replace(/^\/+/, ""); // ej: pos360/products/9/x.webp
    if (BUCKET && key.startsWith(`${BUCKET}/`)) key = key.slice((`${BUCKET}/`).length);
    return key;
  }

  // key o "bucket/key"
  let key = s.replace(/^\/+/, "");
  if (BUCKET && key.startsWith(`${BUCKET}/`)) key = key.slice((`${BUCKET}/`).length);
  return key;
}

function buildPublicUrl(key) {
  const cleanKey = String(key || "").replace(/^\/+/, "");
  if (!PUBLIC_BASE) return cleanKey;
  if (BUCKET) return `${PUBLIC_BASE}/${BUCKET}/${cleanKey}`;
  return `${PUBLIC_BASE}/${cleanKey}`;
}

// ====== DB: usos + sample (para filtrar por producto/cat/subcat) ======
async function mapUsedInfoByFilename() {
  const rows = await sequelize.query(
    `
    SELECT
      SUBSTRING_INDEX(pi.url, '/', -1) AS filename,
      COUNT(*) AS used_count,
      MAX(p.id) AS product_id,
      MAX(p.name) AS product_name,
      MAX(p.category_id) AS category_id,
      MAX(c.name) AS category_name,
      MAX(p.subcategory_id) AS subcategory_id,
      MAX(sc.name) AS subcategory_name
    FROM product_images pi
    JOIN products p ON p.id = pi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN subcategories sc ON sc.id = p.subcategory_id
    GROUP BY filename
  `,
    { type: Sequelize.QueryTypes.SELECT }
  );

  const m = new Map();
  for (const r of rows) {
    m.set(String(r.filename), {
      used_count: Number(r.used_count || 0),
      used_sample: {
        product_id: r.product_id,
        product_name: r.product_name,
        category_id: r.category_id,
        category_name: r.category_name,
        subcategory_id: r.subcategory_id,
        subcategory_name: r.subcategory_name,
      },
    });
  }
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

  all.sort((a, b) => String(b.last_modified || "").localeCompare(String(a.last_modified || "")));
  return all;
}

// ====== STORAGE: resolver key exacto para overwrite ======
async function resolveKeyForOverwrite(rawId) {
  const raw = String(rawId || "").trim();
  if (!raw) return "";

  const s3 = s3Client();

  // 1) si parece key (tiene /), probamos directo
  const maybeKey = normalizeKeyFromRaw(raw);
  if (maybeKey && maybeKey.includes("/")) {
    try {
      await s3.headObject({ Bucket: BUCKET, Key: maybeKey }).promise();
      return maybeKey;
    } catch {}
  }

  // 2) si es filename, probamos ubicaciones comunes:
  const filename = pickFilename(raw);
  if (!filename) return "";

  const candidates = [];

  // primero el upload_prefix
  if (UPLOAD_PREFIX) candidates.push(`${UPLOAD_PREFIX}/${filename}`);

  // después todos los prefixes
  for (const p of PREFIXES) {
    if (!p) continue;
    candidates.push(`${p}/${filename}`);
  }

  // y por si acaso, raíz
  candidates.push(filename);

  for (const k of candidates) {
    try {
      await s3.headObject({ Bucket: BUCKET, Key: k }).promise();
      return k;
    } catch {}
  }

  // 3) fallback: búsqueda (caro pero robusto)
  // buscamos por cada prefix listando y matcheando endsWith
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

      const hit = (resp.Contents || []).find((x) => String(x.Key || "").endsWith(`/${filename}`));
      if (hit?.Key) return hit.Key;
    }
  }

  return "";
}

// ====== HANDLERS ======

/**
 * GET /api/v1/admin/media/images?page&limit&q&used&product_id&category_id&subcategory_id
 */
exports.listAll = async (req, res) => {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.max(1, Math.min(200, toInt(req.query.limit, 60)));

    const q = String(req.query.q || "").trim();
    const used = String(req.query.used || "all"); // all|used|free

    const product_id = toInt(req.query.product_id, 0);
    const category_id = toInt(req.query.category_id, 0);
    const subcategory_id = toInt(req.query.subcategory_id, 0);

    const usedInfoMap = await mapUsedInfoByFilename();
    const all = await listStorageObjects({ q });

    // enrich + filtros por used / product / cat / subcat
    let enriched = all.map((img) => {
      const u = usedInfoMap.get(img.filename) || { used_count: 0, used_sample: null };
      return { ...img, used_count: u.used_count, is_used: u.used_count > 0, used_sample: u.used_sample };
    });

    if (used === "used") enriched = enriched.filter((x) => !!x.is_used);
    if (used === "free") enriched = enriched.filter((x) => !x.is_used);

    if (product_id) enriched = enriched.filter((x) => x.used_sample?.product_id === product_id);
    if (category_id) enriched = enriched.filter((x) => x.used_sample?.category_id === category_id);
    if (subcategory_id) enriched = enriched.filter((x) => x.used_sample?.subcategory_id === subcategory_id);

    const total = enriched.length;
    const start = (page - 1) * limit;
    const end = start + limit;

    res.json({ ok: true, page, limit, total, items: enriched.slice(start, end) });
  } catch (err) {
    console.error("❌ [admin media] listAll:", err);
    res.status(500).json({ ok: false, message: err.message || "Error listando imágenes" });
  }
};

/**
 * GET /api/v1/admin/media/images/used-by/:filename
 */
exports.usedByFilename = async (req, res) => {
  try {
    const filename = pickFilename(req.params.filename || "");
    if (!filename) return res.status(400).json({ ok: false, message: "Falta filename" });

    const rows = await sequelize.query(
      `
      SELECT p.id, p.name, pi.url
      FROM product_images pi
      JOIN products p ON p.id = pi.product_id
      WHERE SUBSTRING_INDEX(pi.url, '/', -1) = :filename
      ORDER BY p.id DESC
      LIMIT 200
      `,
      { type: Sequelize.QueryTypes.SELECT, replacements: { filename } }
    );

    res.json({
      ok: true,
      filename,
      used_count: rows.length,
      products: rows.map((r) => ({ id: r.id, name: r.name, url: r.url })),
    });
  } catch (err) {
    console.error("❌ [admin media] usedByFilename:", err);
    res.status(500).json({ ok: false, message: err.message || "Error buscando usos" });
  }
};

/**
 * POST /api/v1/admin/media/images  (sube nuevo)
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
 * ✅ PUT /api/v1/admin/media/images/:id
 * Overwrite REAL del mismo objeto (no crea copias)
 */
exports.overwriteById = async (req, res) => {
  try {
    if (!BUCKET) return res.status(500).json({ ok: false, message: "Falta S3_BUCKET en env" });

    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, message: "Falta archivo (field: file)" });

    const raw = String(req.params.id || "").trim();
    if (!raw) return res.status(400).json({ ok: false, message: "Falta id" });

    const key = await resolveKeyForOverwrite(raw);
    if (!key) {
      return res.status(404).json({
        ok: false,
        message: "No se encontró el objeto a reemplazar (key/filename no existe en storage).",
      });
    }

    const filename = pickFilename(key);

    const s3 = s3Client();
    await s3
      .putObject({
        Bucket: BUCKET,
        Key: key, // ✅ MISMO KEY = reemplaza
        Body: file.buffer,
        ContentType: "image/webp", // forzamos salida ecommerce
        ACL: "public-read",
        CacheControl: "no-cache",
      })
      .promise();

    res.json({ ok: true, key, filename, url: buildPublicUrl(key) });
  } catch (err) {
    console.error("❌ [admin media] overwriteById:", err);
    res.status(500).json({ ok: false, message: err.message || "Error reemplazando imagen" });
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

    let key = normalizeKeyFromRaw(raw);
    if (!key || (!key.includes("/") && key === filename)) {
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
