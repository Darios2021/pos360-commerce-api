// src/controllers/mediaImages.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Endpoints (adminMedia.routes.js):
// - GET    /api/v1/admin/media/images?page&limit&q&used&product_id&category_id&subcategory_id
// - GET    /api/v1/admin/media/images/used-by/:filename
// - POST   /api/v1/admin/media/images
// - PUT    /api/v1/admin/media/images/:filename         ✅ overwrite (MISMO filename)
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

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === null || v === "") return fallback;
  return String(v).toLowerCase() === "true" || String(v) === "1";
}

const BUCKET = process.env.S3_BUCKET || process.env.S3_BUCKET_PUBLIC || process.env.S3_BUCKET_NAME;
if (!BUCKET) console.warn("⚠️ mediaImages.controller: Falta S3_BUCKET (list/upload/delete/overwrite dependen de esto).");

const PUBLIC_BASE = (process.env.S3_PUBLIC_BASE_URL || process.env.S3_PUBLIC_URL || "").replace(/\/+$/, "");

// Prefijos que se listan (storage)
const PREFIXES = String(process.env.S3_MEDIA_PREFIXES || "products,media")
  .split(",")
  .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
  .filter(Boolean);

// Donde sube el admin
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
    let key = u.pathname.replace(/^\/+/, ""); // ej: pos360/products/9/x.webp
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

// ====== DB: usos + sample por filename (con filtros) ======
async function getUsedStats({ q, product_id, category_id, subcategory_id }) {
  const where = [];
  const repl = {};

  // filtros por producto/categoría/subcategoría (asume products.category_id / products.subcategory_id)
  if (product_id) {
    where.push("p.id = :product_id");
    repl.product_id = Number(product_id);
  }
  if (category_id) {
    where.push("p.category_id = :category_id");
    repl.category_id = Number(category_id);
  }
  if (subcategory_id) {
    where.push("p.subcategory_id = :subcategory_id");
    repl.subcategory_id = Number(subcategory_id);
  }

  // q sobre nombres (producto/categoría/subcategoría) además del filename (filename lo filtramos luego también)
  const qStr = String(q || "").trim().toLowerCase();
  if (qStr) {
    where.push(`(
      LOWER(p.name) LIKE :q
      OR LOWER(c.name) LIKE :q
      OR LOWER(s.name) LIKE :q
      OR LOWER(SUBSTRING_INDEX(pi.url,'/',-1)) LIKE :q
    )`);
    repl.q = `%${qStr}%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await sequelize.query(
    `
    SELECT
      SUBSTRING_INDEX(pi.url, '/', -1) AS filename,
      COUNT(*) AS used_count,
      MAX(pi.id) AS max_pi_id
    FROM product_images pi
    JOIN products p ON p.id = pi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN subcategories s ON s.id = p.subcategory_id
    ${whereSql}
    GROUP BY filename
    `,
    { type: Sequelize.QueryTypes.SELECT, replacements: repl }
  );

  const usedMap = new Map();
  const maxPiByFilename = new Map();
  for (const r of rows) {
    usedMap.set(String(r.filename), Number(r.used_count || 0));
    maxPiByFilename.set(String(r.filename), Number(r.max_pi_id || 0));
  }

  // sample (1 producto por filename, el de max pi.id)
  const sampleIds = Array.from(maxPiByFilename.values()).filter((n) => Number(n) > 0);
  let sampleMap = new Map();

  if (sampleIds.length) {
    const samples = await sequelize.query(
      `
      SELECT
        pi.id AS product_image_id,
        SUBSTRING_INDEX(pi.url, '/', -1) AS filename,
        p.id AS product_id,
        p.name AS product_name,
        c.id AS category_id,
        c.name AS category_name,
        s.id AS subcategory_id,
        s.name AS subcategory_name
      FROM product_images pi
      JOIN products p ON p.id = pi.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN subcategories s ON s.id = p.subcategory_id
      WHERE pi.id IN (:ids)
      `,
      { type: Sequelize.QueryTypes.SELECT, replacements: { ids: sampleIds } }
    );

    sampleMap = new Map(samples.map((x) => [String(x.filename), x]));
  }

  return { usedMap, sampleMap };
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
        // filtro por filename básico (q también lo usamos en DB para búsquedas textuales)
        if (!qLower || it.filename.toLowerCase().includes(qLower)) all.push(it);
      }
    }
  }

  all.sort((a, b) => String(b.last_modified || "").localeCompare(String(a.last_modified || "")));
  return all;
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
    const used = String(req.query.used || "all"); // all | used | free

    const product_id = req.query.product_id ? toInt(req.query.product_id, 0) : 0;
    const category_id = req.query.category_id ? toInt(req.query.category_id, 0) : 0;
    const subcategory_id = req.query.subcategory_id ? toInt(req.query.subcategory_id, 0) : 0;

    // DB stats con filtros (si filtras por producto/cat/subcat, limita el set de filenames "relevantes")
    const { usedMap, sampleMap } = await getUsedStats({
      q,
      product_id: product_id || "",
      category_id: category_id || "",
      subcategory_id: subcategory_id || "",
    });

    // listar storage (siempre), luego cruzar con usedMap
    let all = await listStorageObjects({ q });

    // si hay filtros por producto/cat/subcat => solo mostramos imágenes que están en ese set (usadas por esos filtros)
    const usingHardFilter = !!(product_id || category_id || subcategory_id);
    if (usingHardFilter) {
      const allowed = new Set(Array.from(usedMap.keys())); // filenames que matchean en DB por esos filtros
      all = all.filter((x) => allowed.has(x.filename));
    }

    // aplicar filtro used/free/all
    all = all
      .map((img) => {
        const used_count = usedMap.get(img.filename) || 0;
        const used_sample = sampleMap.get(img.filename) || null;
        return { ...img, used_count, is_used: used_count > 0, used_sample };
      })
      .filter((img) => {
        if (used === "used") return img.is_used;
        if (used === "free") return !img.is_used;
        return true;
      });

    const total = all.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    const pageItems = all.slice(start, end);

    res.json({ ok: true, page, limit, total, items: pageItems });
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
 * ✅ PUT /api/v1/admin/media/images/:filename  (overwrite)
 * Reescribe el MISMO key => UPLOAD_PREFIX/filename
 */
exports.overwriteByFilename = async (req, res) => {
  try {
    if (!BUCKET) return res.status(500).json({ ok: false, message: "Falta S3_BUCKET en env" });

    const filename = pickFilename(req.params.filename || "");
    if (!filename) return res.status(400).json({ ok: false, message: "Falta filename" });

    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, message: "Falta archivo (field: file)" });

    const key = UPLOAD_PREFIX ? `${UPLOAD_PREFIX}/${filename}` : filename;

    const s3 = s3Client();
    await s3
      .putObject({
        Bucket: BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype || "image/webp",
        ACL: "public-read",
      })
      .promise();

    res.json({ ok: true, key, filename, url: buildPublicUrl(key), overwritten: true });
  } catch (err) {
    console.error("❌ [admin media] overwriteByFilename:", err);
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
