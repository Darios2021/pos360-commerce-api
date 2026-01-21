// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/publicInstagram.controller.js
const axios = require("axios");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function mapMediaItem(x) {
  const media_type = String(x?.media_type || "").toUpperCase();

  // VIDEO => preferir thumbnail_url
  const thumb =
    media_type === "VIDEO"
      ? x?.thumbnail_url || x?.media_url || null
      : x?.media_url || x?.thumbnail_url || null;

  return {
    id: x?.id ?? null,
    media_type,
    caption: x?.caption ?? "",
    permalink: x?.permalink ?? null,
    media_url: x?.media_url ?? null,
    thumbnail_url: x?.thumbnail_url ?? null,
    thumb_url: thumb,
    timestamp: x?.timestamp ?? null,
  };
}

// GET /api/v1/public/instagram/latest?limit=8
async function latest(req, res) {
  try {
    const limit = Math.min(Math.max(toInt(req.query.limit, 8), 1), 24);

    const accessToken = mustEnv("IG_ACCESS_TOKEN");
    const igUserId = process.env.IG_USER_ID ? String(process.env.IG_USER_ID) : null;

    const fields = [
      "id",
      "caption",
      "media_type",
      "media_url",
      "permalink",
      "thumbnail_url",
      "timestamp",
    ].join(",");

    let url;

    if (igUserId) {
      const base = process.env.IG_GRAPH_BASE_URL || "https://graph.facebook.com/v19.0";
      url = `${base}/${encodeURIComponent(igUserId)}/media`;
    } else {
      url = "https://graph.instagram.com/me/media";
    }

    const { data } = await axios.get(url, {
      params: { fields, limit, access_token: accessToken },
      timeout: 15000,
    });

    const raw = Array.isArray(data?.data) ? data.data : [];
    const items = raw
      .map(mapMediaItem)
      .filter((it) => !!it.permalink && !!it.thumb_url);

    return res.json({ ok: true, items, source: igUserId ? "graph" : "basic" });
  } catch (err) {
    console.error("❌ publicInstagram.latest", err?.response?.data || err);

    const msg =
      err?.response?.data?.error?.message ||
      err?.response?.data?.message ||
      err?.message ||
      "Instagram error";

    return res.status(500).json({ ok: false, error: msg });
  }
}

module.exports = { latest };
