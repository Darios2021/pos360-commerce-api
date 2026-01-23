// src/middleware/shopHeadInjector.js
const fs = require("fs");
const path = require("path");

/**
 * Carga branding desde DB. Adaptalo a tu modelo real.
 * - Ideal: ShopBranding (1 fila).
 * - Debe devolver: name, favicon_url, og_image_url (o logo_url si querés), updated_at
 */
async function fetchBranding(models) {
  // AJUSTAR segun tu proyecto (ej: models.ShopBranding)
  const { ShopBranding } = models;

  let row = null;
  if (ShopBranding?.findOne) {
    row = await ShopBranding.findOne({ order: [["updated_at", "DESC"]] });
  }

  const safe = (v) => String(v || "").trim();

  // Defaults (por si no hay nada en DB)
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

function createShopHeadInjector({
  distDir,
  models,
  publicBaseUrl, // ej: https://sanjuantecnologia.com
  defaultTitle = "San Juan Tecnología | Electrónica, ecommerce y sistemas POS",
  defaultDescription = "San Juan Tecnología · Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas.",
  cacheSeconds = 60,
}) {
  const indexPath = path.join(distDir, "index.html");
  let indexTemplate = "";

  // Cache del template
  function loadIndexTemplate() {
    indexTemplate = fs.readFileSync(indexPath, "utf8");
  }
  loadIndexTemplate();

  // Cache del branding
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

  // Relee template si cambió en disco (opcional: dev/hot)
  function maybeReloadTemplate() {
    // simple: siempre usar el que cargó al arranque (producción)
    // si querés, podés re-leer cada X seg en dev.
  }

  return async function shopHeadInjector(req, res, next) {
    try {
      // Solo inyectamos en HTML requests de navegación (no assets)
      const accept = String(req.headers.accept || "");
      const isHtml = accept.includes("text/html") || accept.includes("*/*");
      if (!isHtml) return next();

      // Evitar assets /api / archivos
      if (req.path.startsWith("/api")) return next();
      if (req.path.includes(".") && !req.path.endsWith(".html")) return next();

      maybeReloadTemplate();

      const branding = await getBrandingCached();

      const siteName = branding.name || "San Juan Tecnología";

      // Base URLs
      const basePublic = String(publicBaseUrl || "").replace(/\/+$/, "");
      const canonical = `${basePublic}${req.path === "/" ? "/" : req.path}`;

      // Favicon absoluto
      const faviconAbs = absUrl(basePublic, branding.favicon_url);

      // OG image absoluto (ideal 1200x630)
      const ogImageAbs = absUrl(basePublic, branding.og_image_url);

      // Títulos/desc
      const title = siteName ? `${siteName} | Tienda` : defaultTitle;
      const desc = defaultDescription;

      // Reemplazos
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

      // Headers: que no quede pegado por caches intermedios
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
