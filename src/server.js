/**
 * pos360-edge
 * - Sirve HTML con OG/Favicon dinámicos (desde API branding)
 * - Proxy al frontend estático (pos360-frontend) para assets y SPA
 */

const express = require("express");
const fetch = global.fetch || ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// ===== ENV =====
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://sanjuantecnologia.com").replace(/\/+$/, "");
const FRONTEND_INTERNAL = process.env.FRONTEND_INTERNAL || "http://srv-captain--pos360-frontend"; // interno caprover
const API_BASE = (process.env.API_BASE || "https://pos360-commerce-api.cingulado.org/api/v1").replace(/\/+$/, "");
const BRANDING_ENDPOINT = process.env.BRANDING_ENDPOINT || "/admin/shop/branding/public"; // ajustable

function esc(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function absUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return `${PUBLIC_BASE_URL}${s.startsWith("/") ? "" : "/"}${s}`;
}

async function loadBranding() {
  try {
    const r = await fetch(`${API_BASE}${BRANDING_ENDPOINT}`, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`branding http ${r.status}`);
    const j = await r.json();

    // esperables: name, favicon_url, logo_url, og_image_url
    return {
      name: j?.name || "San Juan Tecnología",
      favicon_url: absUrl(j?.favicon_url || ""),
      og_image_url: absUrl(j?.og_image_url || j?.logo_url || j?.favicon_url || ""),
    };
  } catch (e) {
    return {
      name: "San Juan Tecnología",
      favicon_url: "",
      og_image_url: "",
    };
  }
}

// ===== HTML injector =====
async function serveInjectedIndex(req, res) {
  // traer index.html original del frontend
  const indexRes = await fetch(`${FRONTEND_INTERNAL}/`, { headers: { Accept: "text/html" } });
  let html = await indexRes.text();

  const branding = await loadBranding();

  const title = `${branding.name} | Tienda`;
  const desc = "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas.";
  const canonical = `${PUBLIC_BASE_URL}/`;

  const favicon = branding.favicon_url || `${PUBLIC_BASE_URL}/favicon.png`;
  const ogImage = branding.og_image_url || favicon;

  // reemplazar/inyectar dentro de <head>
  const headInject = `
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${esc(canonical)}" />

<link rel="icon" type="image/png" href="${esc(favicon)}" />
<link rel="apple-touch-icon" href="${esc(favicon)}" />

<meta property="og:type" content="website" />
<meta property="og:site_name" content="${esc(branding.name)}" />
<meta property="og:title" content="${esc(branding.name)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${esc(ogImage)}" />
<meta property="og:image:secure_url" content="${esc(ogImage)}" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(branding.name)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${esc(ogImage)}" />
`;

  // borrar tags existentes (si ya vienen) para evitar duplicados
  html = html.replace(/<title>.*?<\/title>/is, "");
  html = html.replace(/<meta\s+name=["']description["'][^>]*>/gi, "");
  html = html.replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "");
  html = html.replace(/<link\s+rel=["']icon["'][^>]*>/gi, "");
  html = html.replace(/<link\s+rel=["']apple-touch-icon["'][^>]*>/gi, "");
  html = html.replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "");
  html = html.replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, "");

  html = html.replace(/<\/head>/i, `${headInject}\n</head>`);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  res.status(200).send(html);
}

// ===== Routes =====
app.get("/", serveInjectedIndex);

// favicon.ico -> al branding (opcional)
app.get("/favicon.ico", async (req, res) => {
  const b = await loadBranding();
  if (b.favicon_url) return res.redirect(302, b.favicon_url);
  return res.status(204).end();
});

// Proxy assets y el resto al frontend
app.use(
  "/",
  createProxyMiddleware({
    target: FRONTEND_INTERNAL,
    changeOrigin: true,
    ws: true,
    // para que el root no lo capture el proxy (ya lo manejamos arriba)
    onProxyReq: (proxyReq, req) => {
      if (req.path === "/") proxyReq.abort?.();
    },
  })
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ pos360-edge on :${PORT}`));
