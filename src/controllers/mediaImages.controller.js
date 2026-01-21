// src/controllers/mediaImages.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Fuente de verdad:
// - Storage: lista de archivos (S3/MinIO) => "galería"
// - DB: product_images.url + products/category/subcategory => "usos y filtros"
//
// Endpoints:
// - GET    /api/v1/admin/media/images?page&limit&q&used&product_id&category_id&subcategory_id
// - POST   /api/v1/admin/media/images  (multipart file)
// - PUT    /api/v1/admin/media/images/:filename  (multipart file overwrite)
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

// ✅ Prefijos que se listan en galería
const PREFIXES = String(process.env.S3_MEDIA_PREFIXES || "products,media")
  .split(",")
  .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
  .filter(Boolean);

// ✅ Prefijo donde se suben/overwrite imágenes del admin
const UPLOAD_PREFIX = String(process.env.S3_MEDIA_UPLOAD_PREFIX || "media")
  .trim()
  .replace(/^\/+|\/+$/g, "");

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

  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    let key = u.pathname.replace(/^\/+/, "");
    if (BUCKET && key.startsWith(`${BUCKET}/`)) key = key.slice((`${BUCKET}/`).length);
    return key;
  }

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

function matchesMetaQuery(usedSample, needleLower) {
  if (!needleLower) return true;
  const s = usedSample || {};
  const parts = [String(s.product_name || ""), String(s.category_name || ""), String(s.subcategory_name || "")]
    .join(" ")
    .toLowerCase();
  return parts.includes(needleLower);
}

/**
 * ✅ DB MAP de usos por filename con sample meta
 */
async function mapUsedMetaByFilename() {
  const rows = await sequelize.query(
    `
    SELECT
      SUBSTRING_INDEX(pi.url, '/', -1) AS filename,
      COUNT(*) AS used_count,
      MAX(p.id) AS sample_product_id,
      MAX(p.name) AS sample_product_name,
      MAX(p.category_id) AS sample_category_id,
      MAX(p.subcategory_id) AS sample_subcategory_id,
      MAX(c.name) AS sample_category_name,
      MAX(s.name) AS sample_subcategory_name
    FROM product_images pi
    JOIN products p ON p.id = pi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN subcategories s ON s.id = p.subcategory_id
    GROUP BY filename
    `,
    { type: Sequelize.QueryTypes.SELECT }
  );

  const m = new Map();
  for (const r of rows) {
    m.set(String(r.filename), {
      used_count: Number(r.used_count || 0),
      used_sample: {
        product_id: r.sample_product_id ?? null,
        product_name: r.sample_product_name ?? null,
        category_id: r.sample_category_id ?? null,
        category_name: r.sample_category_name ?? null,
        subcategory_id: r.sample_subcategory_id ?? null,
        subcategory_name: r.sample_subcategory_name ?? null,
      },
    });
  }
  return m;
}

/**
 * STORAGE: listar objetos por múltiples prefixes
 */
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

// =======================
// HANDLERS
// =======================

/**
 * GET /api/v1/admin/media/images?page&limit&q&used&product_id&category_id&subcategory_id
 */
exports.listAll = async (req, res) => {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.max(1, Math.min(200, toInt(req.query.limit, 60)));

    const q = String(req.query.q || "").trim();
    const used = String(req.query.used || "all").trim(); // all|used|free

    const product_id = toInt(req.query.product_id, 0);
    const category_id = toInt(req.query.category_id, 0);
    const subcategory_id = toInt(req.query.subcategory_id, 0);

    const needleLower = q.toLowerCase();

    const usedMeta = await mapUsedMetaByFilename();

    // 1) list storage (si q matchea filename)
    let out = await listStorageObjects({ q });

    // 2) merge meta
    out = out.map((img) => {
      const meta = usedMeta.get(img.filename) || { used_count: 0, used_sample: null };
      return {
        ...img,
        used_count: meta.used_count || 0,
        is_used: (meta.used_count || 0) > 0,
        used_sample: meta.used_sample || null,
      };
    });

    // 3) filtros usados/no usados
    if (used === "used") out = out.filter((x) => x.is_used);
    if (used === "free") out = out.filter((x) => !x.is_used);

    // 4) filtros por IDs
    if (product_id > 0) out = out.filter((x) => x.used_sample?.product_id === product_id);
    if (category_id > 0) out = out.filter((x) => x.used_sample?.category_id === category_id);
    if (subcategory_id > 0) out = out.filter((x) => x.used_sample?.subcategory_id === subcategory_id);

    // 5) Si q no matcheó filename, permitimos buscar por meta
    if (q && out.length === 0) {
      const allNoQ = await listStorageObjects({ q: "" });

      out = allNoQ
        .map((img) => {
          const meta = usedMeta.get(img.filename) || { used_count: 0, used_sample: null };
          return {
            ...img,
            used_count: meta.used_count || 0,
            is_used: (meta.used_count || 0) > 0,
            used_sample: meta.used_sample || null,
          };
        })
        .filter((x) => {
          if (used === "used" && !x.is_used) return false;
          if (used === "free" && x.is_used) return false;

          if (product_id > 0 && x.used_sample?.product_id !== product_id) return false;
          if (category_id > 0 && x.used_sample?.category_id !== category_id) return false;
          if (subcategory_id > 0 && x.used_sample?.subcategory_id !== subcategory_id) return false;

          return matchesMetaQuery(x.used_sample, needleLower);
        });
    } else if (q) {
      // si hay resultados por filename, también incluimos meta
      out = out.filter((x) => {
        const f = String(x.filename || "").toLowerCase();
        return f.includes(needleLower) || matchesMetaQuery(x.used_sample, needleLower);
      });
    }

    const total = out.length;
    const start = (page - 1) * limit;
    const end = start + limit;

    res.json({ ok: true, page, limit, total, items: out.slice(start, end) });
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
      SELECT
        p.id,
        p.name,
        pi.url
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
 * POST /api/v1/admin/media/images (multipart file)
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
 * ✅ PUT /api/v1/admin/media/images/:filename (overwrite)
 * Reescribe el mismo filename (se guarda en UPLOAD_PREFIX/filename)
 */
exports.overwriteByFilename = async (req, res) => {
  try {
    if (!BUCKET) return res.status(500).json({ ok: false, message: "Falta S3_BUCKET en env" });

    const filename = pickFilename(req.params.filename || "");
    if (!filename) return res.status(400).json({ ok: false, message: "Falta filename" });

    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, message: "Falta archivo (field: file)" });

    if (!/\.webp$/i.test(filename)) {
      return res.status(400).json({ ok: false, message: "Solo se permite overwrite de .webp" });
    }

    const key = UPLOAD_PREFIX ? `${UPLOAD_PREFIX}/${filename}` : filename;

    const s3 = s3Client();
    await s3
      .putObject({
        Bucket: BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: "image/webp",
        ACL: "public-read",
      })
      .promise();

    res.json({ ok: true, key, filename, url: buildPublicUrl(key) });
  } catch (err) {
    console.error("❌ [admin media] overwriteByFilename:", err);
    res.status(500).json({ ok: false, message: err.message || "Error overwrite" });
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
