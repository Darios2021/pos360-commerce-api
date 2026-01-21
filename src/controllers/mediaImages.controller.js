// src/controllers/mediaImages.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Este controller NO usa tabla media_images.
// Fuente de verdad:
// - Storage: lista total de archivos (S3/MinIO)   => "galería"
// - DB: product_images.url                       => "usos"
//
// Endpoints:
// - GET    /api/v1/admin/media/images?page&limit&q
// - POST   /api/v1/admin/media/images  (multipart file)
// - DELETE /api/v1/admin/media/images/:id (filename o url o id dummy)

const crypto = require("crypto");
const { Sequelize } = require("sequelize");
const { ProductImage, sequelize } = require("../models");

// ====== CONFIG STORAGE ======
// Si ya tenés un cliente S3 central, cambialo acá.
// Este ejemplo usa aws-sdk v2 (como venías usando).
const AWS = require("aws-sdk");

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
if (!BUCKET) {
  // no tiramos error acá para no crashear en dev si solo querés listar desde FS,
  // pero para subir/borrar lo vas a necesitar.
  console.warn("⚠️ mediaImages.controller: Falta S3_BUCKET (upload/delete no funcionarán).");
}

// Base pública para armar URL (tu dominio storage-files.cingulado.org)
const PUBLIC_BASE =
  (process.env.S3_PUBLIC_BASE_URL || process.env.S3_PUBLIC_URL || "").replace(/\/+$/, "");

// Prefijo de carpeta donde guardás (ej: pos360/products o pos360/media)
const MEDIA_PREFIX = (process.env.S3_MEDIA_PREFIX || "pos360/media").replace(/^\/+|\/+$/g, "");

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
  // fallback: si no hay base pública, devolvemos key
  return key;
}

// ====== DB: usos por filename ======
async function mapUsedCountsByFilename() {
  // SELECT SUBSTRING_INDEX(url,'/',-1) filename, COUNT(*) used_count FROM product_images GROUP BY filename
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

// ====== STORAGE: listar objetos ======
async function listStorageObjects({ q, page, limit }) {
  // Listado por S3 ListObjectsV2 (paginado por ContinuationToken)
  const s3 = s3Client();

  const Prefix = MEDIA_PREFIX ? `${MEDIA_PREFIX}/` : "";
  let token = null;

  // Para paginar tipo "page X", caminamos tokens (simple y suficiente para admin)
  // Si querés performance top, lo cambiamos a "cursor".
  const targetPage = Math.max(1, page);
  const perPage = Math.max(1, Math.min(200, limit));

  let currentPage = 1;
  let lastPageItems = [];
  let isTruncated = true;

  while (isTruncated && currentPage <= targetPage) {
    const resp = await s3
      .listObjectsV2({
        Bucket: BUCKET,
        Prefix,
        ContinuationToken: token || undefined,
        MaxKeys: 1000, // traemos "mucho" y luego filtramos
      })
      .promise();

    token = resp.NextContinuationToken || null;
    isTruncated = Boolean(resp.IsTruncated);

    // items
    const items = (resp.Contents || [])
      .map((x) => ({
        key: x.Key,
        filename: pickFilename(x.Key),
        size: Number(x.Size || 0),
        last_modified: x.LastModified ? new Date(x.LastModified).toISOString() : null,
        url: buildPublicUrl(x.Key),
      }))
      .filter((x) => x.key && !x.key.endsWith("/"));

    // filtro por q (filename contiene)
    const filtered = q
      ? items.filter((x) => x.filename.toLowerCase().includes(q.toLowerCase()))
      : items;

    // paginado manual dentro del batch
    // armamos un array global solo de esta página objetivo:
    // - calculamos slice para la página actual sobre el stream acumulado (simple approach)
    // Para no complicarla: juntamos todo y recortamos (admin normalmente no tiene 1M imágenes).
    // Si vos tenés muchísimas, lo pasamos a cursor.
    lastPageItems = lastPageItems.concat(filtered);

    currentPage++;
  }

  // ahora sacamos la página pedida del acumulado
  const start = (targetPage - 1) * perPage;
  const end = start + perPage;

  const pageItems = lastPageItems.slice(start, end);

  // total aproximado = lo acumulado hasta lo que listamos; si querés exacto, hay que listar todo.
  const totalApprox = lastPageItems.length;

  return { items: pageItems, total: totalApprox };
}

// ====== HANDLERS ======

/**
 * GET /api/v1/admin/media/images?page=1&limit=60&q=...
 * Devuelve: { items:[{url,filename,size,last_modified,used_count,is_used}], page, limit, total }
 */
exports.listAll = async (req, res) => {
  try {
    const page = toInt(req.query.page, 1);
    const limit = toInt(req.query.limit, 60);
    const q = String(req.query.q || "").trim();

    const usedMap = await mapUsedCountsByFilename();
    const { items, total } = await listStorageObjects({ q, page, limit });

    const merged = items.map((img) => {
      const used_count = usedMap.get(img.filename) || 0;
      return {
        ...img,
        used_count,
        is_used: used_count > 0,
      };
    });

    res.json({
      ok: true,
      page,
      limit,
      total,
      items: merged,
    });
  } catch (err) {
    console.error("❌ [admin media] listAll:", err);
    res.status(500).json({ ok: false, message: err.message || "Error listando imágenes" });
  }
};

/**
 * POST /api/v1/admin/media/images (multipart/form-data file=...)
 * Guarda en S3/MinIO y devuelve {url, key, filename}
 */
exports.uploadOne = async (req, res) => {
  try {
    if (!BUCKET) return res.status(500).json({ ok: false, message: "Falta S3_BUCKET en env" });

    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, message: "Falta archivo (field: file)" });

    // nombre único
    const ext = (file.originalname || "").split(".").pop()?.toLowerCase() || "bin";
    const stamp = Date.now();
    const rnd = crypto.randomBytes(6).toString("hex");
    const filename = `${stamp}-${rnd}.${ext}`;

    const key = MEDIA_PREFIX ? `${MEDIA_PREFIX}/${filename}` : filename;

    const s3 = s3Client();
    await s3
      .putObject({
        Bucket: BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype || "application/octet-stream",
        ACL: "public-read", // si tu bucket es público
      })
      .promise();

    const url = buildPublicUrl(key);

    res.json({
      ok: true,
      key,
      filename,
      url,
    });
  } catch (err) {
    console.error("❌ [admin media] uploadOne:", err);
    res.status(500).json({ ok: false, message: err.message || "Error subiendo imagen" });
  }
};

/**
 * DELETE /api/v1/admin/media/images/:id
 * Acepta:
 * - filename (ej 1767...webp)
 * - key completo (pos360/media/...)
 * - url completa (https://...)
 *
 * Bloquea si está usada por productos (409).
 */
exports.removeById = async (req, res) => {
  try {
    if (!BUCKET) return res.status(500).json({ ok: false, message: "Falta S3_BUCKET en env" });

    const raw = String(req.params.id || "").trim();
    if (!raw) return res.status(400).json({ ok: false, message: "Falta id" });

    const filename = pickFilename(raw);

    // ✅ bloquear si usada
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

    // Si vino url pública: sacamos path
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      key = u.pathname.replace(/^\/+/, ""); // sin leading /
    } else if (raw.includes("/") && raw.includes(".")) {
      // key completo
      key = raw.replace(/^\/+/, "");
    } else {
      // solo filename
      key = MEDIA_PREFIX ? `${MEDIA_PREFIX}/${filename}` : filename;
    }

    const s3 = s3Client();
    await s3
      .deleteObject({
        Bucket: BUCKET,
        Key: key,
      })
      .promise();

    res.json({ ok: true, deleted: true, filename, key });
  } catch (err) {
    console.error("❌ [admin media] removeById:", err);
    res.status(500).json({ ok: false, message: err.message || "Error eliminando imagen" });
  }
};
