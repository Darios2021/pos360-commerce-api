// src/controllers/productVideos.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (DB-column aware + ANTI-CRASH + auto public url for uploads)
// ✅ Incluye FEED público global con mini info del producto (CTA comprar)
//
// Rutas sugeridas (compat):
// GET    /api/v1/products/:id/videos
// GET    /api/v1/admin/products/:id/videos            (alias via v1.routes)
// POST   /api/v1/products/:id/videos/youtube          { url, title? }
// POST   /api/v1/products/:id/videos/upload           multipart: file + title?
// DELETE /api/v1/products/:id/videos/:videoId
//
// ✅ FEED público global:
// GET    /api/v1/public/videos/feed?limit=18
//
// Requiere:
// - src/config/s3.js exporta { s3, s3Config }
// - ProductVideo model exista y esté cargado por Sequelize

const crypto = require("crypto");
const path = require("path");
const { PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { s3, s3Config } = require("../config/s3");

// Import flexible de models (depende de tu proyecto)
let models = null;
try {
  models = require("../models");
} catch (e) {
  models = null;
}

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toStr(v) {
  return String(v ?? "").trim();
}
function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function resolveSequelize() {
  try {
    if (models?.sequelize) return models.sequelize;
  } catch (_) {}
  try {
    const { sequelize } = require("../models");
    return sequelize;
  } catch (_) {}
  return null;
}

function resolveProductVideoModel() {
  if (models && typeof models === "object") {
    if (models.ProductVideo) return models.ProductVideo;
    if (models.ProductVideos) return models.ProductVideos;
    if (models.productVideo) return models.productVideo;
    if (models.product_videos) return models.product_videos;
    if (models.sequelize?.models?.ProductVideo) return models.sequelize.models.ProductVideo;
    if (models.sequelize?.models?.ProductVideos) return models.sequelize.models.ProductVideos;
  }

  try {
    const { sequelize } = require("../models");
    if (sequelize?.models?.ProductVideo) return sequelize.models.ProductVideo;
    if (sequelize?.models?.ProductVideos) return sequelize.models.ProductVideos;
  } catch (e) {
    // ignore
  }
  return null;
}

function resolveProductModel() {
  if (models && typeof models === "object") {
    if (models.Product) return models.Product;
    if (models.Products) return models.Products;
    if (models.product) return models.product;
    if (models.products) return models.products;
    if (models.sequelize?.models?.Product) return models.sequelize.models.Product;
    if (models.sequelize?.models?.Products) return models.sequelize.models.Products;
  }
  try {
    const { sequelize } = require("../models");
    if (sequelize?.models?.Product) return sequelize.models.Product;
    if (sequelize?.models?.Products) return sequelize.models.Products;
  } catch (e) {
    // ignore
  }
  return null;
}

async function getColumns(tableName, transaction) {
  const sequelize = resolveSequelize();
  if (!sequelize) return new Set();

  const [rows] = await sequelize.query(
    `
    SELECT COLUMN_NAME AS name
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t
    `,
    { replacements: { t: tableName }, transaction }
  );

  return new Set((rows || []).map((r) => String(r.name || "").toLowerCase()));
}

function extractYoutubeId(url) {
  const u = toStr(url);
  if (!u) return null;

  const m1 = u.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{6,})/i);
  if (m1?.[1]) return m1[1];

  const m2 = u.match(/[?&]v=([a-zA-Z0-9_-]{6,})/i);
  if (m2?.[1]) return m2[1];

  const m3 = u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/i);
  if (m3?.[1]) return m3[1];

  const m4 = u.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/i);
  if (m4?.[1]) return m4[1];

  return null;
}

function normalizeYoutubeEmbed(url) {
  const id = extractYoutubeId(url);
  if (!id) return null;
  return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;
}

function youtubeThumbFromUrl(url) {
  const id = extractYoutubeId(url);
  if (!id) return null;
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function safeExtFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("mp4")) return ".mp4";
  if (m.includes("webm")) return ".webm";
  if (m.includes("quicktime")) return ".mov";
  return "";
}

function buildVideoKey(productId, originalName, mime) {
  const ext = path.extname(String(originalName || "")) || safeExtFromMime(mime) || ".mp4";
  const rnd = crypto.randomBytes(10).toString("hex");
  return `products/${productId}/videos/${rnd}${ext}`;
}

function buildPublicObjectUrl(bucket, key) {
  const base =
    toStr(process.env.S3_PUBLIC_BASE_URL) ||
    toStr(process.env.MINIO_PUBLIC_BASE_URL) ||
    toStr(process.env.S3_ENDPOINT);

  if (!base || !bucket || !key) return null;

  const b = base.replace(/\/+$/, "");
  const k = String(key).replace(/^\/+/, "");
  return `${b}/${bucket}/${k}`;
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && String(obj[k]).trim() !== "") return obj[k];
  }
  return null;
}

function buildProductMini(p, prodCols) {
  if (!p) return null;
  const obj = p?.toJSON ? p.toJSON() : p;

  const id = Number(obj?.id || obj?.product_id || 0) || null;

  const name = pickFirst(obj, ["name", "title", "nombre", "titulo"]) || null;
  const slug = pickFirst(obj, ["slug", "handle", "permalink"]) || null;

  const price = numOrNull(pickFirst(obj, ["price", "price_list", "list_price", "precio"]));
  const price_discount = numOrNull(
    pickFirst(obj, ["price_discount", "discount", "precio_descuento"])
  );

  const image =
    pickFirst(obj, [
      "image_url",
      "main_image",
      "cover_image",
      "cover_url",
      "thumbnail",
      "thumb",
      "image",
    ]) || null;

  const out = { id, name, slug, image, price, price_discount };

  if (prodCols?.has("is_new")) out.is_new = Boolean(obj.is_new);
  if (prodCols?.has("is_promo")) out.is_promo = Boolean(obj.is_promo);

  return out;
}

/* =========================
   LIST por producto
   ========================= */
async function list(req, res) {
  try {
    const ProductVideo = resolveProductVideoModel();
    if (!ProductVideo || typeof ProductVideo.findAll !== "function") {
      return res.status(500).json({
        ok: false,
        code: "PRODUCT_VIDEO_MODEL_NOT_FOUND",
        message:
          "No se encontró el model ProductVideo (o no tiene findAll). Revisá exports en src/models/index.js y el nombre del model.",
      });
    }

    const productId = toInt(req.params.id, 0);
    if (!productId) return res.status(400).json({ ok: false, message: "Invalid product id" });

    const cols = await getColumns("product_videos");
    const hasIsActive = cols.has("is_active");
    const hasSort = cols.has("sort_order");

    const where = { product_id: productId };
    if (hasIsActive) where.is_active = true;

    const order = [];
    if (hasSort) order.push(["sort_order", "ASC"]);
    order.push(["id", "DESC"]);

    const rows = await ProductVideo.findAll({ where, order });

    const hasBucket = cols.has("storage_bucket");
    const hasKey = cols.has("storage_key");
    const hasUrl = cols.has("url");

    const data = (rows || []).map((r) => {
      const obj = r?.toJSON ? r.toJSON() : r;
      if (hasUrl && !obj.url && hasBucket && hasKey && obj.storage_bucket && obj.storage_key) {
        const pub = buildPublicObjectUrl(obj.storage_bucket, obj.storage_key);
        if (pub) obj.url = pub;
      }
      return obj;
    });

    return res.json({ ok: true, data });
  } catch (e) {
    console.error("[productVideos.list] error:", e);
    return res.status(500).json({ ok: false, code: "VIDEO_LIST_ERROR", message: e.message || "Error" });
  }
}

/* =========================
   ✅ FEED PUBLICO GLOBAL (mejorado)
   - devuelve videos + product mini (name/price/image/slug)
   ========================= */
/* =========================
   ✅ FEED PUBLICO GLOBAL (paginado)
   GET /api/v1/public/videos/feed?limit=16&offset=0
   Devuelve: { ok:true, data:[...], meta:{ limit, offset, returned, has_more } }
========================= */
async function listPublicFeed(req, res) {
  try {
    const ProductVideo = resolveProductVideoModel();
    if (!ProductVideo || typeof ProductVideo.findAll !== "function") {
      return res.status(500).json({
        ok: false,
        code: "PRODUCT_VIDEO_MODEL_NOT_FOUND",
        message: "No se encontró el model ProductVideo (o no tiene findAll).",
      });
    }

    const Product = resolveProductModel();

    const videoCols = await getColumns("product_videos");
    const prodCols = await getColumns("products");

    const hasIsActive = videoCols.has("is_active");
    const hasSort = videoCols.has("sort_order");
    const hasCreatedAt = videoCols.has("created_at") || videoCols.has("createdat");
    const hasBucket = videoCols.has("storage_bucket");
    const hasKey = videoCols.has("storage_key");
    const hasUrl = videoCols.has("url");

    let limit = toInt(req.query.limit, 16);
    if (!limit || limit < 1) limit = 16;
    if (limit > 60) limit = 60; // cap server-side

    let offset = toInt(req.query.offset, 0);
    if (!offset || offset < 0) offset = 0;

    const where = {};
    if (hasIsActive) where.is_active = true;

    const order = [];
    if (hasSort) order.push(["sort_order", "ASC"]);
    if (hasCreatedAt) order.push(["created_at", "DESC"]);
    order.push(["id", "DESC"]);

    const rows = await ProductVideo.findAll({ where, order, limit, offset });

    const baseData = (rows || []).map((r) => {
      const obj = r?.toJSON ? r.toJSON() : r;

      if (hasUrl && !obj.url && hasBucket && hasKey && obj.storage_bucket && obj.storage_key) {
        const pub = buildPublicObjectUrl(obj.storage_bucket, obj.storage_key);
        if (pub) obj.url = pub;
      }

      let thumb = obj.thumb || obj.thumbnail || obj.cover || null;
      const provider = toStr(obj.provider).toLowerCase();
      if (!thumb && (provider === "youtube" || /youtube\.com|youtu\.be/i.test(toStr(obj.url)))) {
        thumb = youtubeThumbFromUrl(obj.url) || null;
      }

      return {
        id: obj.id,
        product_id: obj.product_id ?? null,
        provider: obj.provider || null,
        title: obj.title || null,
        subtitle: obj.subtitle || null,
        caption: obj.caption || null,
        url: obj.url || null,
        mime: obj.mime || null,
        thumb,
      };
    });

    const ids = Array.from(
      new Set(
        baseData
          .map((x) => Number(x?.product_id || 0))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    );

    const prodMap = new Map();

    if (ids.length) {
      if (Product && typeof Product.findAll === "function") {
        const prows = await Product.findAll({ where: { id: ids } });
        for (const p of prows || []) {
          const obj = p?.toJSON ? p.toJSON() : p;
          const pid = Number(obj?.id || 0);
          if (pid) prodMap.set(pid, obj);
        }
      } else {
        const sequelize = resolveSequelize();
        if (sequelize) {
          const [prows] = await sequelize.query(`SELECT * FROM products WHERE id IN (:ids)`, {
            replacements: { ids },
          });
          for (const p of prows || []) {
            const pid = Number(p?.id || 0);
            if (pid) prodMap.set(pid, p);
          }
        }
      }
    }

    const data = baseData.map((v) => {
      const pid = Number(v?.product_id || 0);
      const p = pid ? prodMap.get(pid) : null;
      return { ...v, product: p ? buildProductMini(p, prodCols) : null };
    });

    // ✅ has_more simple: si devolvió "limit", probablemente haya más
    const has_more = (rows || []).length === limit;

    return res.json({
      ok: true,
      data,
      meta: {
        limit,
        offset,
        returned: data.length,
        has_more,
      },
    });
  } catch (e) {
    console.error("[productVideos.listPublicFeed] error:", e);
    return res.status(500).json({
      ok: false,
      code: "VIDEO_PUBLIC_FEED_ERROR",
      message: e.message || "Error",
    });
  }
}


async function addYoutube(req, res) {
  try {
    const ProductVideo = resolveProductVideoModel();
    if (!ProductVideo || typeof ProductVideo.create !== "function") {
      return res.status(500).json({
        ok: false,
        code: "PRODUCT_VIDEO_MODEL_NOT_FOUND",
        message: "No se encontró el model ProductVideo (o no tiene create).",
      });
    }

    const productId = toInt(req.params.id, 0);
    const url = toStr(req.body?.url);
    const title = toStr(req.body?.title);

    if (!productId) return res.status(400).json({ ok: false, message: "Invalid product id" });
    if (!url) return res.status(400).json({ ok: false, message: "URL requerida" });

    const embed = normalizeYoutubeEmbed(url);
    if (!embed) {
      return res.status(400).json({
        ok: false,
        message: "URL de YouTube inválida (short/watch/youtu.be/embed)",
      });
    }

    const cols = await getColumns("product_videos");
    const payload = {
      product_id: productId,
      provider: "youtube",
      title: title || null,
      url: embed,
    };

    if (cols.has("mime")) payload.mime = "text/html";
    if (cols.has("sort_order")) payload.sort_order = 0;
    if (cols.has("is_active")) payload.is_active = true;

    const row = await ProductVideo.create(payload);
    return res.json({ ok: true, data: row });
  } catch (e) {
    console.error("[productVideos.addYoutube] error:", e);
    return res.status(500).json({ ok: false, code: "VIDEO_YOUTUBE_ERROR", message: e.message || "Error" });
  }
}

async function upload(req, res) {
  try {
    const ProductVideo = resolveProductVideoModel();
    if (!ProductVideo || typeof ProductVideo.create !== "function") {
      return res.status(500).json({
        ok: false,
        code: "PRODUCT_VIDEO_MODEL_NOT_FOUND",
        message: "No se encontró el model ProductVideo (o no tiene create).",
      });
    }

    const productId = toInt(req.params.id, 0);
    if (!productId) return res.status(400).json({ ok: false, message: "Invalid product id" });

    const f = req.file;
    if (!f) return res.status(400).json({ ok: false, message: "Falta archivo (file)" });

    const mime = toStr(f.mimetype);
    const size = toInt(f.size, 0);

    if (!mime.startsWith("video/")) {
      return res.status(400).json({ ok: false, message: "El archivo debe ser video (video/*)" });
    }
    if (size > 80 * 1024 * 1024) {
      return res.status(400).json({ ok: false, message: "Video muy grande (max 80MB)" });
    }

    const bucket = s3Config.bucket;
    const key = buildVideoKey(productId, f.originalname, mime);

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: f.buffer,
        ContentType: mime || "application/octet-stream",
      })
    );

    const cols = await getColumns("product_videos");
    const publicUrl = buildPublicObjectUrl(bucket, key);

    const payload = {
      product_id: productId,
      provider: s3Config.provider || "s3",
      title: toStr(req.body?.title) || null,
    };

    if (cols.has("storage_bucket")) payload.storage_bucket = bucket;
    if (cols.has("storage_key")) payload.storage_key = key;
    if (cols.has("mime")) payload.mime = mime || null;
    if (cols.has("size_bytes")) payload.size_bytes = size || null;
    if (cols.has("sort_order")) payload.sort_order = 0;
    if (cols.has("is_active")) payload.is_active = true;
    if (cols.has("url")) payload.url = publicUrl || null;

    const row = await ProductVideo.create(payload);

    const out = row?.toJSON ? row.toJSON() : row;
    if (!out.url && publicUrl) out.url = publicUrl;

    return res.json({ ok: true, data: out });
  } catch (e) {
    console.error("[productVideos.upload] error:", e);
    return res.status(500).json({ ok: false, code: "VIDEO_UPLOAD_ERROR", message: e.message || "Error" });
  }
}

async function remove(req, res) {
  try {
    const ProductVideo = resolveProductVideoModel();
    if (!ProductVideo || typeof ProductVideo.findOne !== "function") {
      return res.status(500).json({
        ok: false,
        code: "PRODUCT_VIDEO_MODEL_NOT_FOUND",
        message: "No se encontró el model ProductVideo (o no tiene findOne).",
      });
    }

    const productId = toInt(req.params.id, 0);
    const videoId = toInt(req.params.videoId, 0);
    if (!productId || !videoId) return res.status(400).json({ ok: false, message: "Invalid ids" });

    const row = await ProductVideo.findOne({ where: { id: videoId, product_id: productId } });
    if (!row) return res.status(404).json({ ok: false, message: "Not found" });

    const cols = await getColumns("product_videos");
    const hasIsActive = cols.has("is_active");

    if (hasIsActive) {
      row.is_active = false;
      await row.save();
    } else {
      await row.destroy();
    }

    const obj = row?.toJSON ? row.toJSON() : row;
    if (obj.storage_bucket && obj.storage_key) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: obj.storage_bucket,
            Key: obj.storage_key,
          })
        );
      } catch (e) {
        console.warn("[productVideos.remove] DeleteObject warning:", e?.message || e);
      }
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("[productVideos.remove] error:", e);
    return res.status(500).json({ ok: false, code: "VIDEO_REMOVE_ERROR", message: e.message || "Error" });
  }
}

module.exports = {
  list,
  listPublicFeed, // ✅ ahora devuelve product mini
  addYoutube,
  upload,
  remove,
};
