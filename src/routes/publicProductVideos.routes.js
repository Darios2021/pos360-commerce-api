// src/routes/publicProductVideos.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
// PUBLIC: videos por producto
// GET /api/v1/public/products/:id/videos
//
// Devuelve: { ok:true, data:[...] }

const router = require("express").Router();
const { sequelize } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

async function hasColumn(table, col) {
  const [rows] = await sequelize.query(
    `
    SELECT COUNT(*) AS c
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = :t
      AND COLUMN_NAME = :c
    LIMIT 1
    `,
    { replacements: { t: table, c: col } }
  );
  return Number(rows?.[0]?.c || 0) > 0;
}

router.get("/products/:id/videos", async (req, res) => {
  try {
    const pid = toInt(req.params.id, 0);
    if (!pid) return res.status(400).json({ ok: false, message: "Invalid product id" });

    const table = "product_videos";
    const hasIsActive = await hasColumn(table, "is_active");
    const hasSort = await hasColumn(table, "sort_order");
    const hasBucket = await hasColumn(table, "storage_bucket");
    const hasKey = await hasColumn(table, "storage_key");
    const hasMime = await hasColumn(table, "mime");
    const hasSize = await hasColumn(table, "size_bytes");
    const hasUrl = await hasColumn(table, "url");
    const hasTitle = await hasColumn(table, "title");
    const hasProvider = await hasColumn(table, "provider");

    const cols = [
      "id",
      "product_id",
      hasProvider ? "provider" : "NULL AS provider",
      hasTitle ? "title" : "NULL AS title",
      hasUrl ? "url" : "NULL AS url",
      hasBucket ? "storage_bucket" : "NULL AS storage_bucket",
      hasKey ? "storage_key" : "NULL AS storage_key",
      hasMime ? "mime" : "NULL AS mime",
      hasSize ? "size_bytes" : "NULL AS size_bytes",
      hasSort ? "sort_order" : "0 AS sort_order",
    ].join(", ");

    const where = [`product_id = :pid`];
    if (hasIsActive) where.push("is_active = 1");

    const order = [];
    if (hasSort) order.push("sort_order ASC");
    order.push("id DESC");

    const [rows] = await sequelize.query(
      `
      SELECT ${cols}
      FROM ${table}
      WHERE ${where.join(" AND ")}
      ORDER BY ${order.join(", ")}
      `,
      { replacements: { pid } }
    );

    return res.json({ ok: true, data: rows || [] });
  } catch (e) {
    console.error("[publicProductVideos] error:", e);
    return res
      .status(500)
      .json({ ok: false, code: "PUBLIC_PRODUCT_VIDEOS_ERROR", message: e.message || "Error" });
  }
});

module.exports = router;
