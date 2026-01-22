// src/controllers/mediaImages.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Fuente de verdad:
// - Storage: lista de archivos (S3/MinIO) => "galería"
// - DB: product_images.url               => "usos"
//
// Mejora clave:
// - Subida/overwrite: genera 3 variantes:
//   1) WEBP (UI):          <stem>.webp
//   2) OG Preview (JPG):   <stem>_og.jpg   (1200x630, ideal WhatsApp/Facebook/IG preview)
//   3) Square (JPG):       <stem>_sq.jpg   (1080x1080)
//
// Endpoints:
// - GET    /api/v1/admin/media/images?page&limit&q&used&product_id&category_id&subcategory_id
// - POST   /api/v1/admin/media/images  (multipart file)
// - PUT    /api/v1/admin/media/images/:id   (multipart overwrite: key/url/filename/stem -> regenera variantes)
// - DELETE /api/v1/admin/media/images/:id
// - GET    /api/v1/admin/media/images/used-by/:filename

const crypto = require("crypto");
const { Sequelize } = require("sequelize");
const { ProductImage, sequelize } = require("../models");
const AWS = require("aws-sdk");
const sharp = require("sharp");

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

// ====== S3 CLIENT ======
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
    let key = u.pathname.replace(/^\/+/, "");
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

function isImageKey(key) {
  return /\.(png|jpe?g|webp|gif|avif)$/i.test(String(key || ""));
}

function stripExt(name) {
  return String(name || "").replace(/\.[a-z0-9]+$/i, "");
}

/**
 * Dado cualquier key/filename/url (webp/jpg/_og/_sq),
 * devuelve el "stem" base (sin sufijos) y los keys esperados.
 *
 * Ej:
 *  media/abc.webp    -> stemKey media/abc
 *  media/abc_og.jpg  -> stemKey media/abc
 *  media/abc_sq.jpg  -> stemKey media/abc
 */
function deriveStemFromKey(key) {
  const k = String(key || "");
  const filename = pickFilename(k);
  const dir = k.includes("/") ? k.slice(0, k.lastIndexOf("/") + 1) : "";

  let base = stripExt(filename);
  base = base.replace(/(_og|_sq)$/i, "");

  const stemKey = `${dir}${base}`.replace(/^\/+/, "");

  return {
    stemKey,
    webpKey: `${stemKey}.webp`,
    ogKey: `${stemKey}_og.jpg`,
    sqKey: `${stemKey}_sq.jpg`,
  };
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
        .filter((x) => x.key && !x.key.endsWith("/"))
        .filter((x) => isImageKey(x.key));

      for (const it of items) {
        if (!qLower || it.filename.toLowerCase().includes(qLower)) all.push(it);
      }
    }
  }

  all.sort((a, b) => String(b.last_modified || "").localeCompare(String(a.last_modified || "")));
  return all;
}

// ====== STORAGE: resolver key exacto para overwrite (key/url/filename/stem) ======
async function resolveKeyForOverwrite(rawId) {
  const raw = String(rawId || "").trim();
  if (!raw) return "";

  const s3 = s3Client();

  // 1) Normalizar raw (url/key/bucket/key)
  const maybeKey = normalizeKeyFromRaw(raw);

  // ✅ probar headObject directo SIEMPRE que tengamos algo
  if (maybeKey) {
    try {
      await s3.headObject({ Bucket: BUCKET, Key: maybeKey }).promise();
      return maybeKey;
    } catch {}
  }

  // 2) Si viene "stem" sin extensión -> probar variantes
  // ej: media/abc   -> media/abc.webp / media/abc_og.jpg / media/abc_sq.jpg
  const looksLikeStem =
    maybeKey &&
    !/\.[a-z0-9]+$/i.test(maybeKey) &&
    !maybeKey.endsWith("/") &&
    !maybeKey.includes("?") &&
    !maybeKey.includes("#");

  if (looksLikeStem) {
    const stem = maybeKey.replace(/^\/+/, "");
    const stemCandidates = [`${stem}.webp`, `${stem}_og.jpg`, `${stem}_sq.jpg`];
    for (const k of stemCandidates) {
      try {
        await s3.headObject({ Bucket: BUCKET, Key: k }).promise();
        return k;
      } catch {}
    }
  }

  // 3) Si es filename, probamos ubicaciones comunes
  const filename = pickFilename(raw);
  if (!filename) return "";

  const candidates = [];

  if (UPLOAD_PREFIX) candidates.push(`${UPLOAD_PREFIX}/${filename}`);
  for (const p of PREFIXES) {
    if (!p) continue;
    candidates.push(`${p}/${filename}`);
  }
  candidates.push(filename);

  for (const k of candidates) {
    try {
      await s3.headObject({ Bucket: BUCKET, Key: k }).promise();
      return k;
    } catch {}
  }

  // 4) fallback: búsqueda (caro) por endsWith
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

      const hit = (resp.Contents || []).find(
        (x) => String(x.Key || "").endsWith(`/${filename}`) || String(x.Key || "") === filename
      );
      if (hit?.Key) return hit.Key;
    }
  }

  return "";
}

// ====== IMAGE PIPELINE ======
async function decodeImage(buffer) {
  // rotate() respeta EXIF orientation -> previene previews “girados”
  return sharp(buffer, { failOn: "none", animated: false }).rotate();
}

function ensureMinimum(meta) {
  const w = toInt(meta?.width, 0);
  const h = toInt(meta?.height, 0);

  if (w < 300 || h < 200) {
    const err = new Error(
      `Imagen demasiado chica (${w}x${h}). Mínimo recomendado: ancho ≥ 300px y alto ≥ 200px.`
    );
    err.status = 400;
    err.friendlyMessage = err.message;
    throw err;
  }
}

async function buildOgJpg(buffer) {
  const W = 1200;
  const H = 630;

  const img = await decodeImage(buffer);

  const bg = await img
    .clone()
    .resize(W, H, { fit: "cover" })
    .blur(28)
    .jpeg({ quality: 72, mozjpeg: true, progressive: true })
    .toBuffer();

  const fg = await img
    .clone()
    .resize(W, H, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  return sharp(bg)
    .composite([{ input: fg, top: 0, left: 0 }])
    .jpeg({ quality: 86, mozjpeg: true, progressive: true })
    .toBuffer();
}

async function buildSquareJpg(buffer) {
  const W = 1080;
  const H = 1080;

  const img = await decodeImage(buffer);

  const bg = await img
    .clone()
    .resize(W, H, { fit: "cover" })
    .blur(28)
    .jpeg({ quality: 72, mozjpeg: true, progressive: true })
    .toBuffer();

  const fg = await img
    .clone()
    .resize(W, H, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  return sharp(bg)
    .composite([{ input: fg, top: 0, left: 0 }])
    .jpeg({ quality: 86, mozjpeg: true, progressive: true })
    .toBuffer();
}

async function buildWebp(buffer) {
  const img = await decodeImage(buffer);
  const meta = await img.metadata();

  const w = toInt(meta.width, 0);
  const h = toInt(meta.height, 0);

  const maxSide = 1600;
  let pipe = img.clone();

  if (w > maxSide || h > maxSide) {
    pipe = pipe.resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });
  }

  return pipe.webp({ quality: 82, effort: 5 }).toBuffer();
}

async function generateVariants(fileBuffer) {
  const base = await decodeImage(fileBuffer);
  const meta = await base.metadata();
  ensureMinimum(meta);

  const og = await buildOgJpg(fileBuffer);
  const sq = await buildSquareJpg(fileBuffer);
  const webp = await buildWebp(fileBuffer);

  return { meta, og, sq, webp };
}

async function putObject({ key, body, contentType, cacheControl }) {
  const s3 = s3Client();

  await s3
    .putObject({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl || "public, max-age=31536000, immutable",
      ACL: "public-read",
    })
    .promise();

  return {
    key,
    filename: pickFilename(key),
    url: buildPublicUrl(key),
    size: Buffer.byteLength(body),
  };
}

async function uploadVariantsToS3({ webpKey, ogKey, sqKey, variants, cacheControl }) {
  const ogUp = await putObject({
    key: ogKey,
    body: variants.og,
    contentType: "image/jpeg",
    cacheControl,
  });

  const sqUp = await putObject({
    key: sqKey,
    body: variants.sq,
    contentType: "image/jpeg",
    cacheControl,
  });

  const webpUp = await putObject({
    key: webpKey,
    body: variants.webp,
    contentType: "image/webp",
    cacheControl,
  });

  return { og: ogUp, sq: sqUp, webp: webpUp };
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
 * ✅ genera variantes y guarda:
 *   <stem>.webp, <stem>_og.jpg, <stem>_sq.jpg
 */
exports.uploadOne = async (req, res) => {
  try {
    if (!BUCKET) return res.status(500).json({ ok: false, message: "Falta S3_BUCKET en env" });

    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, message: "Falta archivo (field: file)" });

    const stamp = Date.now();
    const rnd = crypto.randomBytes(8).toString("hex");

    const stemName = `${stamp}-${rnd}`;
    const stemKey = UPLOAD_PREFIX ? `${UPLOAD_PREFIX}/${stemName}` : stemName;

    const keys = deriveStemFromKey(`${stemKey}.webp`);
    const variants = await generateVariants(file.buffer);

    const uploaded = await uploadVariantsToS3({
      webpKey: keys.webpKey,
      ogKey: keys.ogKey,
      sqKey: keys.sqKey,
      variants,
      cacheControl: "public, max-age=31536000, immutable",
    });

    res.json({
      ok: true,
      stem_key: keys.stemKey,
      webp: uploaded.webp,
      og: uploaded.og,
      sq: uploaded.sq,
      filename: uploaded.webp.filename,
      url: uploaded.webp.url,
      og_url: uploaded.og.url,
      sq_url: uploaded.sq.url,
      meta: { width: variants.meta.width, height: variants.meta.height, format: variants.meta.format },
    });
  } catch (err) {
    console.error("❌ [admin media] uploadOne:", err);
    res
      .status(err.status || 500)
      .json({ ok: false, message: err.friendlyMessage || err.message || "Error subiendo imagen" });
  }
};

/**
 * PUT /api/v1/admin/media/images/:id
 * ✅ Overwrite real: resuelve key existente (key/url/filename/stem), deriva stem, regenera y pisa:
 *   .webp + _og.jpg + _sq.jpg
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
        message: "No se encontró el objeto a reemplazar (key/filename/stem no existe en storage).",
      });
    }

    const keys = deriveStemFromKey(key);
    const variants = await generateVariants(file.buffer);

    // overwrite: no-cache para que scrapers y browser no te claven el viejo por horas
    const uploaded = await uploadVariantsToS3({
      webpKey: keys.webpKey,
      ogKey: keys.ogKey,
      sqKey: keys.sqKey,
      variants,
      cacheControl: "no-cache",
    });

    res.json({
      ok: true,
      replaced_from: key,
      stem_key: keys.stemKey,
      webp: uploaded.webp,
      og: uploaded.og,
      sq: uploaded.sq,
      filename: uploaded.webp.filename,
      url: uploaded.webp.url,
      og_url: uploaded.og.url,
      sq_url: uploaded.sq.url,
      meta: { width: variants.meta.width, height: variants.meta.height, format: variants.meta.format },
    });
  } catch (err) {
    console.error("❌ [admin media] overwriteById:", err);
    res
      .status(err.status || 500)
      .json({ ok: false, message: err.friendlyMessage || err.message || "Error reemplazando imagen" });
  }
};

/**
 * DELETE /api/v1/admin/media/images/:id
 * Bloquea si está usada por productos (409).
 * ✅ Borra el paquete completo (webp + og + sq), aunque le pases og/sq como id.
 */
exports.removeById = async (req, res) => {
  try {
    if (!BUCKET) return res.status(500).json({ ok: false, message: "Falta S3_BUCKET en env" });

    const raw = String(req.params.id || "").trim();
    if (!raw) return res.status(400).json({ ok: false, message: "Falta id" });

    // ✅ Bloqueo por STEM:
    // Si piden borrar abc_og.jpg o abc_sq.jpg, igual bloqueamos mirando abc.webp
    const keyForCheck = normalizeKeyFromRaw(raw) || raw;
    const fn = pickFilename(keyForCheck);
    const base = stripExt(fn).replace(/(_og|_sq)$/i, "");
    const baseWebpFilename = `${base}.webp`;

    const used = await ProductImage.count({
      where: sequelize.where(
        sequelize.fn("SUBSTRING_INDEX", sequelize.col("url"), "/", -1),
        baseWebpFilename
      ),
    });

    if (used > 0) {
      return res.status(409).json({
        ok: false,
        message: `No se puede eliminar: imagen usada en ${used} producto(s)`,
        used_count: used,
        filename: baseWebpFilename,
      });
    }

    const s3 = s3Client();

    // resolvemos el key real si existe
    let key = await resolveKeyForOverwrite(raw);
    if (!key) key = normalizeKeyFromRaw(raw);

    if (!key) {
      // fallback por filename en upload_prefix
      const fallbackKey = UPLOAD_PREFIX ? `${UPLOAD_PREFIX}/${fn}` : fn;
      await s3.deleteObject({ Bucket: BUCKET, Key: fallbackKey }).promise();
      return res.json({ ok: true, deleted: true, filename: fn, key: fallbackKey });
    }

    const keys = deriveStemFromKey(key);
    const targets = [keys.webpKey, keys.ogKey, keys.sqKey];

    for (const k of targets) {
      try {
        await s3.deleteObject({ Bucket: BUCKET, Key: k }).promise();
      } catch {}
    }

    res.json({ ok: true, deleted: true, stem_key: keys.stemKey, deleted_keys: targets });
  } catch (err) {
    console.error("❌ [admin media] removeById:", err);
    res.status(500).json({ ok: false, message: err.message || "Error eliminando imagen" });
  }
};
