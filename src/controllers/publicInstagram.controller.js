// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/publicInstagram.controller.js
// Node 20+ => fetch nativo (SIN axios)

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

// ✅ Quita comillas, espacios, saltos de línea y basura típica de envs
function sanitizeToken(v) {
  let s = String(v ?? "");
  s = s.trim();

  // si quedó pegado con comillas
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }

  // por si CapRover pegó con saltos
  s = s.replace(/\r?\n/g, "").trim();

  return s;
}

function mapMediaItem(x) {
  const media_type = String(x?.media_type || "").toUpperCase();

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

    const rawToken = mustEnv("IG_ACCESS_TOKEN");
    const accessToken = sanitizeToken(rawToken);

    if (!accessToken || accessToken.length < 20) {
      throw new Error("IG_ACCESS_TOKEN inválido (vacío o muy corto)");
    }

    const igUserId = process.env.IG_USER_ID ? String(process.env.IG_USER_ID).trim() : null;

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
      const base = (process.env.IG_GRAPH_BASE_URL || "https://graph.facebook.com/v19.0").trim();
      url = `${base}/${encodeURIComponent(igUserId)}/media`;
    } else {
      url = "https://graph.instagram.com/me/media";
    }

    const qs = new URLSearchParams({
      fields,
      limit: String(limit),
      access_token: accessToken,
    });

    const resp = await fetch(`${url}?${qs.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const bodyText = await resp.text();
    let data = null;
    try {
      data = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      data = null;
    }

    if (!resp.ok) {
      const message =
        data?.error?.message ||
        data?.message ||
        `Instagram HTTP ${resp.status}: ${bodyText.slice(0, 200)}`;

      return res.status(500).json({ ok: false, error: message });
    }

    const raw = Array.isArray(data?.data) ? data.data : [];
    const items = raw.map(mapMediaItem).filter((it) => !!it.permalink && !!it.thumb_url);

    return res.json({ ok: true, items, source: igUserId ? "graph" : "basic" });
  } catch (err) {
    console.error("❌ publicInstagram.latest", err);
    return res.status(500).json({ ok: false, error: err.message || "Instagram error" });
  }
}

module.exports = { latest };
