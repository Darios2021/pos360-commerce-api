// src/middleware/shopHeadInjector.js
const fs = require("fs");
const path = require("path");

/**
 * Carga branding desde DB.
 * - Ideal: ShopBranding (1 fila)
 * - Debe devolver: name, favicon_url, og_image_url (o logo_url), updated_at
 */
async function fetchBranding(models) {
  const { ShopBranding } = models;

  let row = null;
  if (ShopBranding?.findOne) {
    row = await ShopBranding.findOne({ order: [["updated_at", "DESC"]] });
  }

  const safe = (v) => String(v || "").trim();

  const name = safe(row?.name) || "San Juan Tecnología";
  const favicon = safe(row?.favicon_url) || "";
  const ogImage = safe(row?.og_image_url) || safe(row?.logo_url) || favicon || "";

  return {
    name,
    favicon_url: favicon,
    og_image_url: ogImage,
    updated_at: row?.updated_at ? String(row.updated_at) : null,
  };
}

function htmlEscape(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function absUrl(basePublic, u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  const b = String(basePublic || "").replace(/\/+$/, "");
  return `${b}${s.startsWith("/") ? "" : "/"}${s}`;
}

function shouldInjectHtml(req) {
  const accept = String(req.headers.accept || "");
  const xrw = String(req.headers["x-requested-with"] || "");
  const secFetchDest = String(req.headers["sec-fetch-dest"] || "");
  const secFetchMode = String(req.headers["sec-fetch-mode"] || "");

  // ✅ Sólo navegación HTML real
  const wantsHtml =
    accept.includes("text/html") ||
    secFetchDest === "document" ||
    secFetchMode === "navigate";

  // ✅ Evitar XHR/fetch típicos
  if (!wantsHtml) return false;
  if (accept.includes("application/json")) return false;
  if (xrw.toLowerCase() === "xmlhttprequest") return false;

  return true;
}

function isAssetOrFilePath(p) {
  if (p.startsWith("/api")) return true;
  if (p.startsWith("/assets/")) return true;
  if (p.startsWith("/favicon")) return true;
  if (p.startsWith("/robots.txt")) return true;
  if (p.startsWith("/sitemap")) return true;
  if (p.startsWith("/.well-known/")) return true;
  if (/\.[a-z0-9]{2,6}$/i.test(p) && !p.endsWith(".html")) return true;
  return false;
}

function createShopHeadInjector({
  distDir,
  models,
  publicBaseUrl,
  defaultTitle = "San Juan Tecnología | Electrónica, ecommerce y sistemas POS",
  defaultDescription = "San Juan Tecnología · Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas.",
  cacheSeconds = 60,
}) {
  const indexPath = path.join(distDir, "index.html");
  let indexTemplate = fs.readFileSync(indexPath, "utf8");

  // Cache branding
  let cached = null;
  let cachedAt = 0;

  async function getBrandingCached() {
    const now = Date.now();
    if (cached && now - cachedAt < cacheSeconds * 1000) return cached;
    const b = await fetchBranding(models);
    cached = b;
    cachedAt = now;
    return b;
  }

  return async function shopHeadInjector(req, res, next) {
    try {
      // ✅ Sólo HTML real
      if (!shouldInjectHtml(req)) return next();
      if (isAssetOrFilePath(req.path)) return next();

      const branding = await getBrandingCached();
      const siteName = branding.name || "San Juan Tecnología";

      const basePublic = String(publicBaseUrl || "").replace(/\/+$/, "");
      const canonical = `${basePublic}${req.originalUrl || req.path || "/"}`;

      const faviconAbs = absUrl(basePublic, branding.favicon_url);
      const ogImageAbs = absUrl(basePublic, branding.og_image_url);

      const title = siteName ? `${siteName} | Tienda` : defaultTitle;
      const desc = defaultDescription;

      let html = indexTemplate;

      const rep = (k, v) => {
        html = html.replaceAll(k, htmlEscape(v));
      };

      rep("__TITLE__", title);
      rep("__DESCRIPTION__", desc);
      rep("__CANONICAL__", canonical);

      rep("__SITE_NAME__", siteName);
      rep("__OG_TITLE__", siteName);
      rep("__OG_DESCRIPTION__", "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas.");
      rep("__OG_URL__", canonical);
      rep("__OG_IMAGE__", ogImageAbs || faviconAbs || `${basePublic}/fallback-og.png`);
      rep("__OG_IMAGE_ALT__", siteName);

      rep("__FAVICON__", faviconAbs || `${basePublic}/favicon.png`);

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      return res.status(200).send(html);
    } catch (e) {
      return next(e);
    }
  };
}

module.exports = { createShopHeadInjector };
