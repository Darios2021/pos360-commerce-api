// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/publicInstagramDebug.controller.js

function sanitizeToken(v) {
  let s = String(v ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\r?\n/g, "").trim();
  return s;
}

async function debug(req, res) {
  try {
    const token = sanitizeToken(process.env.IG_ACCESS_TOKEN || "");
    const base = (process.env.IG_GRAPH_BASE_URL || "https://graph.facebook.com/v19.0").trim();

    if (!token) {
      return res.status(500).json({ ok: false, error: "Missing env IG_ACCESS_TOKEN" });
    }

    const url = `${base}/me?access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await r.text();

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!r.ok) {
      return res.status(500).json({ ok: false, error: "Token invalid", ig: data });
    }

    return res.json({
      ok: true,
      me: data,
      token_len: token.length,
      token_prefix: token.slice(0, 6),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "debug error" });
  }
}

module.exports = { debug };
