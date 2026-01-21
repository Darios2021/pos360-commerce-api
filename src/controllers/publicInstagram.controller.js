// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/publicInstagram.controller.js
// Node 20+ => fetch nativo. Respuesta SIEMPRE JSON.

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function sanitizeToken(v) {
  let s = String(v ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
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

async function latest(req, res) {
  try {
    const limit = Math.min(Math.max(toInt(req.query.limit, 8), 1), 24);

    const rawToken = mustEnv("IG_ACCESS_TOKEN");
    const accessToken = sanitizeToken(rawToken);

    const igUserId = process.env.IG_USER_ID ? String(process.env.IG_USER_ID).trim() : null;
    const base = (process.env.IG_GRAPH_BASE_URL || "https://graph.facebook.com/v19.0").trim();

    if (!accessToken || accessToken.length < 40) {
      return res.status(500).json({
        ok: false,
        error: "IG_ACCESS_TOKEN inválido (vacío/corto). Pegalo SIN comillas y en 1 sola línea.",
      });
    }

    const fields = [
      "id",
      "caption",
      "media_type",
      "media_url",
      "permalink",
      "thumbnail_url",
      "timestamp",
    ].join(",");

    const url = igUserId
      ? `${base}/${encodeURIComponent(igUserId)}/media`
      : `https://graph.instagram.com/me/media`;

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
      // Instagram devolvió algo raro (HTML, texto)
      return res.status(500).json({
        ok: false,
        error: `Instagram respondió no-JSON (HTTP ${resp.status})`,
        debug: bodyText.slice(0, 250),
      });
    }

    if (!resp.ok) {
      const igMsg =
        data?.error?.message ||
        data?.message ||
        `Instagram HTTP ${resp.status}`;

      return res.status(500).json({
        ok: false,
        error: igMsg,
        ig: data?.error || data,
      });
    }

    const raw = Array.isArray(data?.data) ? data.data : [];
    const items = raw.map(mapMediaItem).filter((it) => !!it.permalink && !!it.thumb_url);

    return res.json({
      ok: true,
      source: igUserId ? "graph" : "basic",
      items,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || "Instagram error",
    });
  }
}

module.exports = { latest };
