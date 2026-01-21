// src/controllers/mediaImages.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Fuente de verdad:
// - Storage: lista objetos (S3/MinIO) => "galería"
// - DB: product_images.url           => "usos"
//
// Endpoints:
// - GET    /api/v1/admin/media/images?page&limit&q
// - GET    /api/v1/admin/media/images/used-by/:filename
// - POST   /api/v1/admin/media/images  (multipart file)
// - DELETE /api/v1/admin/media/images/:id

const crypto = require("crypto");
const AWS = require("aws-sdk");
const { Sequelize } = require("sequelize");
const { ProductImage, sequelize } = require("../models");

// ====== HELPERS ======
function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function stripSlashes(s) {
  return String(s || "").replace(/^\/+|\/+$/g, "");
}

function pickFilename(urlOrKey) {
  const s = String(urlOrKey || "");
  const last = s.split("?")[0].split("#")[0];
  return last.substring(last.lastIndexOf("/") + 1) || last;
}

// Evita duplicar "pos360" cuando PUBLIC_BASE ya lo incluye
function ensureNoDoublePrefix(base, key) {
  const b = stripSlashes(base);
  const k = stripSlashes(key);
  if (!b) return k;

  const bLast = b.split("/").slice(-1)[0]; // ej "pos360"
  if (bLast && k.startsWith(`${bLast}/`)) return k.substring(bLast.length + 1);
  return k;
}

// ====== CONFIG STORAGE ======
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
if (!BUCKET) {
  console.warn("⚠️ mediaImages.controller: Falta S3_BUCKET (list/upload/delete no funcionarán).");
}

// ✅ Recomendado: "https://storage-files.cingulado.org" (sin /pos360)
const PUBLIC_BASE = (process.env.S3_PUBLIC_BASE_URL || process.env.S3_PUBLIC_URL || "").replace(/\/+$/, "");

// ✅ Prefijos: por default pos360/products (porque tus imágenes reales están ahí)
// Si querés ambos:
// S3_MEDIA_PREFIXS="pos360/products,pos360/media"
const MEDIA_PREFIXS_RAW = String(process.env.S3_MEDIA_PREFIXS || "").trim();
const MEDIA_PREFIX_RAW = String(process.env.S3_MEDIA_PREFIX || "").trim();

const MEDIA_PREFIXS = (MEDIA_PREFIXS_RAW
  ? MEDIA_PREFIXS_RAW.split(",")
  : [MEDIA_PREFIX_RAW || "pos360/products"]
)
  .map((x) => stripSlashes(x))
  .filter(Boolean);

function buildPublicUrl(key) {
  const k = stripSlashes(key);
  if (!PUBLIC_BASE) return k;
  const safeKey = ensureNoDoublePrefix(PUBLIC_BASE, k);
  return `${PUBLIC_BASE}/${safeKey}`;
}

// ====== DB: usos ======
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

async function getUsedByProducts(filename) {
  const safe = String(filename || "").trim();
  if (!safe) return [];

  // join simple (si querés más fields del producto, los agregamos)
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
  `,
    {
      type: Sequelize.QueryTypes.SELECT,
      replacements: { filename: safe },
    }
  );

  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    url: r.url,
  }));
}

// ====== STORAGE: listar objetos ======
async function listAllFromStorage({ q }) {
  if (!BUCKET) throw new Error("Falta S3_BUCKET en env");

  const s3 = s3Client();
  const all = [];

  for (const pref of MEDIA_PREFIXS) {
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

      const batch = (resp.Contents || [])
        .map((x) => ({
          key: x.Key,
          filename: pickFilename(x.Key),
          size: Number(x.Size || 0),
          last_modified: x.LastModified ? new Date(x.LastModified).toISOString() : null,
          url: buildPublicUrl(x.Key),
        }))
        .filter((x) => x.key && !x.key.endsWith("/"));

      all.push(...batch);

      // safety
      if (all.length > 200000) break;
    }
  }

  const filtered = q
    ? all.filter((x) => x.filename.toLowerCase().includes(String(q).toLowerCase()))
    : all;

  // más nuevo primero
  filtered.sort((a, b) => {
    const da = a.last_modified ? new Date(a.last_modified).getTime() : 0;
    const db = b.last_modified ? new Date(b.last_modified).getTime() : 0;
    return db - da;
  });

  return filtered;
}

function paginate(items, page, limit) {
  const p = Math.max(1, page);
  const l = Math.max(1, Math.min(200, limit));
  const start = (p - 1) * l;
  const end = start + l;
  return { page: p, limit: l, slice: items.slice(start, end), total: items.length };
}

// ====== HANDLERS ======

exports.listAll = async (req, res) => {
  try {
    const page = toInt(req.query.page, 1);
    const limit = toInt(req.query.limit, 60);
    const q = String(req.query.q || "").trim();

    // 👇 debug útil para ver en logs qué está usando
    console.log("🖼️ [admin media] listAll", {
      bucket: BUCKET,
      prefixes: MEDIA_PREFIXS,
      public_base: PUBLIC_BASE,
      page,
      limit,
      q,
    });

    const usedMap = await mapUsedCountsByFilename();
    const all = await listAllFromStorage({ q });

    const { slice, total, page: p, limit: l } = paginate(all, page, limit);

    const merged = slice.map((img) => {
      const used_count = usedMap.get(img.filename) || 0;
      return { ...img, used_count, is_used: used_count > 0 };
    });

    res.json({ ok: true, page: p, limit: l, total, items: merged });
  } catch (err) {
    console.error("❌ [admin media] listAll:", err);
    res.status(500).json({ ok: false, message: err.message || "Error listando imágenes" });
  }
};

// ✅ Endpoint que tu frontend ya llama
exports.usedBy = async (req, res) => {
  try {
    const filename = String(req.params.filename || "").trim();
    if (!filename) return res.status(400).json({ ok: false, message: "Falta filename" });

    const products = await getUsedByProducts(filename);

    res.json({
      ok: true,
      filename,
      used_count: products.length,
      products,
    });
  } catch (err) {
    console.error("❌ [admin media] usedBy:", err);
    res.status(500).json({ ok: false, message: err.message || "Error obteniendo usos" });
  }
};

exports.uploadOne = async (req, res) => {
  try {
    if (!BUCKET) return res.status(500).json({ ok: false, message: "Falta S3_BUCKET en env" });

    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, message: "Falta archivo (field: file)" });

    const ext = (file.originalname || "").split(".").pop()?.toLowerCase() || "bin";
    const stamp = Date.now();
    const rnd = crypto.randomBytes(6).toString("hex");
    const filename = `${stamp}-${rnd}.${ext}`;

    // sube al primer prefijo
    const basePrefix = MEDIA_PREFIXS[0] || "pos360/products";
    const key = basePrefix ? `${basePrefix}/${filename}` : filename;

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

    const url = buildPublicUrl(key);

    res.json({ ok: true, key, filename, url });
  } catch (err) {
    console.error("❌ [admin media] uploadOne:", err);
    res.status(500).json({ ok: false, message: err.message || "Error subiendo imagen" });
  }
};

exports.removeById = async (req, res) => {
  try {
    if (!BUCKET) return res.status(500).json({ ok: false, message: "Falta S3_BUCKET en env" });

    const raw = String(req.params.id || "").trim();
    if (!raw) return res.status(400).json({ ok: false, message: "Falta id" });

    const filename = pickFilename(raw);

    // bloquear si usada
    const used = await ProductImage.count({
      where: sequelize.where(
        sequelize.fn("SUBSTRING_INDEX", sequelize.col("url"), "/", -1),
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

    // resolver key
    let key = null;

    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      key = u.pathname.replace(/^\/+/, "");
    } else if (raw.includes("/") && raw.includes(".")) {
      key = raw.replace(/^\/+/, "");
    } else {
      const basePrefix = MEDIA_PREFIXS[0] || "pos360/products";
      key = basePrefix ? `${basePrefix}/${filename}` : filename;
    }

    const s3 = s3Client();
    await s3.deleteObject({ Bucket: BUCKET, Key: key }).promise();

    res.json({ ok: true, deleted: true, filename, key });
  } catch (err) {
    console.error("❌ [admin media] removeById:", err);
    res.status(500).json({ ok: false, message: err.message || "Error eliminando imagen" });
  }
};
