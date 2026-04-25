// src/services/messaging/emailLayout.service.js
//
// Envuelve el body de un email en un layout HTML responsive con header (logo
// + nombre del negocio) y footer (datos de contacto + redes). Está pensado
// para Gmail/Outlook/Apple Mail (CSS inline, tablas anidadas, fonts seguras).
//
// FUENTES DE BRANDING (en orden de prioridad):
//   1) Tabla `shop_branding` (id=1) → name, logo_url
//   2) Tabla `shop_settings` (key='theme') → primary, secondary (colores)
//   3) Tabla `shop_links` (kind=instagram/facebook/whatsapp/website)
//   4) Env vars como fallback (BUSINESS_NAME, BUSINESS_PHONE, etc.)
//
// Cuando el usuario actualiza branding/tema/links desde el admin, los emails
// reflejan los cambios automáticamente (cache de 60 segundos).
//
// Env vars de fallback (todas opcionales):
//   BUSINESS_NAME, BUSINESS_LOGO_URL, BUSINESS_WEBSITE, BUSINESS_PHONE,
//   BUSINESS_EMAIL, BUSINESS_ADDRESS, BUSINESS_INSTAGRAM, BUSINESS_FACEBOOK,
//   BUSINESS_WHATSAPP, BRAND_PRIMARY_COLOR, BRAND_ACCENT_COLOR,
//   EMAIL_FOOTER_NOTE.

"use strict";

const { sequelize } = require("../../models");

// Cache simple para no pegarle a la DB en cada email del bulk.
let _brandingCache = null;
let _brandingCacheAt = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minuto

async function loadBrandingFromDb() {
  // shop_branding: name + logo_url
  let name = null, logoUrl = null;
  try {
    const [rows] = await sequelize.query(
      `SELECT name, logo_url FROM shop_branding WHERE id = 1 LIMIT 1`
    );
    const r = rows?.[0];
    name = r?.name || null;
    logoUrl = r?.logo_url || null;
  } catch (_) {}

  // shop_settings: theme
  let primary = null, secondary = null;
  try {
    const [rows] = await sequelize.query(
      `SELECT value_json FROM shop_settings WHERE \`key\` = 'theme' LIMIT 1`
    );
    const v = rows?.[0]?.value_json || null;
    if (v) {
      const parsed = typeof v === "string" ? JSON.parse(v) : v;
      primary = parsed?.primary || null;
      secondary = parsed?.secondary || null;
    }
  } catch (_) {}

  // shop_links activos
  let links = [];
  try {
    const [rows] = await sequelize.query(
      `SELECT kind, label, url FROM shop_links
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    );
    links = rows || [];
  } catch (_) {}

  return { name, logoUrl, primary, secondary, links };
}

async function getDbBranding() {
  if (_brandingCache && (Date.now() - _brandingCacheAt) < CACHE_TTL_MS) {
    return _brandingCache;
  }
  const data = await loadBrandingFromDb();
  _brandingCache = data;
  _brandingCacheAt = Date.now();
  return data;
}

// Permite invalidar el cache desde fuera (ej: cuando el admin guarda branding).
function invalidateBrandingCache() {
  _brandingCache = null;
  _brandingCacheAt = 0;
}

function s(v, fallback = "") {
  const x = String(v ?? "").trim();
  return x || fallback;
}

function escHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Detecta si un string ya es un HTML "completo" (con <html> o <body>).
// Si lo es, NO lo envolvemos — asumimos que el caller ya armó el layout.
function isFullHtmlDocument(body) {
  if (!body) return false;
  const lower = String(body).toLowerCase();
  return /<html[\s>]/i.test(lower) || /<!doctype/i.test(lower);
}

// Detecta si un body parece HTML parcial (tiene tags) vs texto plano.
function isHtmlSnippet(body) {
  return /<\/?[a-z][\s\S]*>/i.test(String(body || ""));
}

// Convierte texto plano a HTML mínimo: escapa, convierte saltos en <br>.
function plainToHtml(body) {
  return escHtml(body).replace(/\n/g, "<br/>");
}

// Devuelve el branding combinando DB (preferente) + env (fallback).
async function getBranding() {
  const db = await getDbBranding().catch(() => ({}));

  // Construir links sociales desde shop_links (DB) si hay, sino desde env.
  const dbLinks = Array.isArray(db.links) ? db.links : [];
  const dbSocialByKind = {};
  for (const l of dbLinks) {
    const kind = String(l.kind || "").toLowerCase();
    if (kind && !dbSocialByKind[kind]) dbSocialByKind[kind] = l.url;
  }

  return {
    name:    db.name || s(process.env.BUSINESS_NAME, "Mi Negocio"),
    logoUrl: db.logoUrl || s(process.env.BUSINESS_LOGO_URL),

    website:  dbSocialByKind.website  || s(process.env.BUSINESS_WEBSITE),
    instagram: dbSocialByKind.instagram || s(process.env.BUSINESS_INSTAGRAM),
    facebook:  dbSocialByKind.facebook  || s(process.env.BUSINESS_FACEBOOK),
    whatsapp:  dbSocialByKind.whatsapp  || s(process.env.BUSINESS_WHATSAPP),

    phone:   s(process.env.BUSINESS_PHONE),
    email:   s(process.env.BUSINESS_EMAIL) || s(process.env.SMTP_FROM_EMAIL),
    address: s(process.env.BUSINESS_ADDRESS),

    primary: normalizeHex(db.primary || process.env.BRAND_PRIMARY_COLOR, "#02498b"),
    accent:  normalizeHex(db.secondary || process.env.BRAND_ACCENT_COLOR, "#0ea5e9"),

    footerNote: s(process.env.EMAIL_FOOTER_NOTE),

    // Por si más adelante queremos usar links extra (kind no estándar).
    extraLinks: dbLinks.filter((l) => {
      const k = String(l.kind || "").toLowerCase();
      return !["website", "instagram", "facebook", "whatsapp"].includes(k);
    }),
  };
}

function normalizeHex(v, fallback) {
  const x = String(v || "").trim();
  if (!x) return fallback;
  const hex = x.startsWith("#") ? x : `#${x}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : fallback;
}

// Mapeo de "kind" → ícono SVG inline. Usamos SVG inline (data: URI no funciona
// bien en Gmail; los SVGs externos sí). Los íconos vienen de simpleicons.org
// que es un CDN público con SVGs de marca consistentes y monocromos. La key
// es el slug que usa simpleicons (ej: "instagram", "facebook", "whatsapp").
//
// Para que se vean bien en clientes que sí cargan SVG, los pintamos del color
// primario del negocio. Outlook clásico no muestra SVG, así que el alt text
// sirve de fallback ("Instagram", "Facebook", etc.).
const SOCIAL_ICONS = {
  instagram: { slug: "instagram", label: "Instagram", color: "E4405F", urlBuilder: (v) =>
    /^https?:/i.test(v) ? v : `https://instagram.com/${String(v).replace(/^@/, "")}` },
  facebook:  { slug: "facebook",  label: "Facebook",  color: "1877F2", urlBuilder: (v) =>
    /^https?:/i.test(v) ? v : `https://facebook.com/${v}` },
  whatsapp:  { slug: "whatsapp",  label: "WhatsApp",  color: "25D366", urlBuilder: (v) =>
    /^https?:/i.test(v) ? v : `https://wa.me/${String(v).replace(/[^\d]/g, "")}` },
  twitter:   { slug: "x",         label: "X (Twitter)", color: "000000", urlBuilder: (v) =>
    /^https?:/i.test(v) ? v : `https://x.com/${String(v).replace(/^@/, "")}` },
  x:         { slug: "x",         label: "X",         color: "000000", urlBuilder: (v) =>
    /^https?:/i.test(v) ? v : `https://x.com/${String(v).replace(/^@/, "")}` },
  tiktok:    { slug: "tiktok",    label: "TikTok",    color: "000000", urlBuilder: (v) =>
    /^https?:/i.test(v) ? v : `https://tiktok.com/@${String(v).replace(/^@/, "")}` },
  youtube:   { slug: "youtube",   label: "YouTube",   color: "FF0000", urlBuilder: (v) => v },
  linkedin:  { slug: "linkedin",  label: "LinkedIn",  color: "0A66C2", urlBuilder: (v) => v },
  telegram:  { slug: "telegram",  label: "Telegram",  color: "26A5E4", urlBuilder: (v) =>
    /^https?:/i.test(v) ? v : `https://t.me/${String(v).replace(/^@/, "")}` },
  email:     { slug: "gmail",     label: "Email",     color: "EA4335", urlBuilder: (v) =>
    v.startsWith("mailto:") ? v : `mailto:${v}` },
  website:   { slug: "googlechrome", label: "Sitio web", color: "1f2937", urlBuilder: (v) => v },
  spotify:   { slug: "spotify",   label: "Spotify",   color: "1DB954", urlBuilder: (v) => v },
  github:    { slug: "github",    label: "GitHub",    color: "181717", urlBuilder: (v) => v },
};

function iconUrl(slug, color) {
  // simpleicons.org devuelve un SVG monocromo del logo de marca.
  return `https://cdn.simpleicons.org/${encodeURIComponent(slug)}/${encodeURIComponent(color)}`;
}

function buildSocialLinks(b) {
  const links = [];

  // Orden visual deseado: WhatsApp, Instagram, Facebook, web, otros.
  const ordered = [
    { kind: "whatsapp",  value: b.whatsapp },
    { kind: "instagram", value: b.instagram },
    { kind: "facebook",  value: b.facebook },
    { kind: "website",   value: b.website },
  ];
  for (const it of ordered) {
    if (!it.value) continue;
    const map = SOCIAL_ICONS[it.kind];
    if (!map) continue;
    links.push({
      url: map.urlBuilder(it.value),
      label: map.label,
      icon: iconUrl(map.slug, map.color),
    });
  }

  // Links extra de shop_links (kinds menos comunes).
  for (const l of b.extraLinks || []) {
    const k = String(l.kind || "").toLowerCase();
    const map = SOCIAL_ICONS[k];
    if (map) {
      links.push({
        url: map.urlBuilder(l.url),
        label: l.label || map.label,
        icon: iconUrl(map.slug, map.color),
      });
    } else {
      // Genérico: usa initial de la kind con color neutro.
      links.push({
        url: l.url,
        label: l.label || l.kind || "Link",
        icon: iconUrl("link", "6b7280"),
      });
    }
  }
  return links;
}

/**
 * Envuelve un body en el layout HTML responsive.
 * @param {Object} params
 * @param {string} params.body      contenido (HTML parcial o texto plano)
 * @param {string} [params.subject] solo para el <title>, no se muestra
 * @param {string} [params.previewText] línea de preview (Gmail muestra esto al lado del asunto)
 */
async function wrap({ body, subject = "", previewText = "" }) {
  if (!body) return body;
  if (isFullHtmlDocument(body)) return body; // ya viene wrappeado

  const b = await getBranding();
  const innerHtml = isHtmlSnippet(body) ? body : plainToHtml(body);

  // Fuente moderna con fallbacks. -apple-system y Segoe UI dan look nativo
  // en macOS/iOS y Windows; Helvetica Neue como fallback elegante; al final
  // Arial sans-serif por si algún cliente viejo.
  const FONT_STACK = `-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif`;

  const socials = buildSocialLinks(b);
  const socialsRow = socials.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
         <tr>
           ${socials
             .map(
               (l) => `<td align="center" style="padding:0 8px;">
                 <a href="${escHtml(l.url)}" target="_blank" rel="noopener"
                    style="display:inline-block;text-decoration:none;color:#6b7280;font-family:${FONT_STACK};font-size:11px;font-weight:600;line-height:1;">
                   <img src="${escHtml(l.icon)}" alt="${escHtml(l.label)}" width="32" height="32"
                        style="border:0;display:block;margin:0 auto 6px;"/>
                   ${escHtml(l.label)}
                 </a>
               </td>`
             )
             .join("")}
         </tr>
       </table>`
    : "";

  const logoBlock = b.logoUrl
    ? `<img src="${escHtml(b.logoUrl)}" alt="${escHtml(b.name)}" width="180"
            style="border:0;display:block;margin:0 auto;max-width:180px;height:auto;"/>`
    : `<div style="font-family:${FONT_STACK};font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.3px;">
         ${escHtml(b.name)}
       </div>`;

  const websiteCta = b.website
    ? `<a href="${escHtml(b.website)}"
          style="color:${b.accent};text-decoration:none;font-weight:700;font-family:${FONT_STACK};font-size:13px;letter-spacing:0.2px;"
          target="_blank" rel="noopener">
         ${escHtml(b.website.replace(/^https?:\/\//, ""))}
       </a>`
    : "";

  // HTML con tablas (compatibilidad con Outlook). Toda la tipografía pasa por
  // la FONT_STACK moderna que arriba aplicamos también a los elementos sociales.
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta name="x-apple-disable-message-reformatting"/>
<title>${escHtml(subject || b.name)}</title>
<style>
  @media only screen and (max-width: 600px) {
    .container { width: 100% !important; }
    .px-32 { padding-left: 22px !important; padding-right: 22px !important; }
    .py-32 { padding-top: 26px !important; padding-bottom: 26px !important; }
    .h1 { font-size: 22px !important; }
    .footer-name { font-size: 15px !important; }
  }
  a { color: ${b.accent}; }
  body, table, td, div, p, a, span, li {
    font-family: ${FONT_STACK};
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f6fa;font-family:${FONT_STACK};color:#1f2937;">
  ${previewText ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escHtml(previewText)}</div>` : ""}

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fa;">
    <tr>
      <td align="center" style="padding:28px 12px;">

        <!-- Container -->
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0"
               style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,0.06);">

          <!-- Header con logo / nombre -->
          <tr>
            <td align="center" style="background:${b.primary};padding:34px 24px;">
              ${logoBlock}
            </td>
          </tr>

          <!-- Acento decorativo -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg, ${b.primary}, ${b.accent});line-height:4px;font-size:0;">&nbsp;</td>
          </tr>

          <!-- Contenido -->
          <tr>
            <td class="px-32 py-32"
                style="padding:36px 40px;font-family:${FONT_STACK};font-size:15.5px;line-height:1.7;color:#1f2937;letter-spacing:0.1px;">
              ${innerHtml}
            </td>
          </tr>

          <!-- Separador -->
          <tr>
            <td style="padding:0 40px;">
              <div style="height:1px;background:#e5e7eb;line-height:1px;font-size:0;">&nbsp;</div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" class="px-32"
                style="padding:28px 40px 32px;font-family:${FONT_STACK};color:#6b7280;font-size:13px;line-height:1.65;letter-spacing:0.1px;">
              <div class="footer-name"
                   style="font-weight:800;color:${b.primary};font-size:17px;margin-bottom:6px;letter-spacing:0.3px;">
                ${escHtml(b.name)}
              </div>
              ${b.address ? `<div style="font-size:12.5px;">${escHtml(b.address)}</div>` : ""}
              ${b.phone || b.email ? `<div style="margin-top:4px;font-size:12.5px;">
                ${b.phone ? `<span style="color:#374151;">${escHtml(b.phone)}</span>` : ""}
                ${b.phone && b.email ? `<span style="margin:0 8px;color:#d1d5db;">·</span>` : ""}
                ${b.email ? `<a href="mailto:${escHtml(b.email)}" style="color:${b.accent};text-decoration:none;font-weight:600;">${escHtml(b.email)}</a>` : ""}
              </div>` : ""}
              ${websiteCta ? `<div style="margin-top:8px;">${websiteCta}</div>` : ""}
              ${socialsRow ? `<div style="margin-top:22px;">${socialsRow}</div>` : ""}
              ${b.footerNote ? `<div style="margin-top:18px;font-size:11px;color:#9ca3af;line-height:1.5;max-width:480px;margin-left:auto;margin-right:auto;">${escHtml(b.footerNote)}</div>` : ""}
            </td>
          </tr>

        </table>

        <!-- Pie meta -->
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0"
               style="width:600px;max-width:600px;">
          <tr>
            <td align="center" style="padding:18px 24px 8px;font-size:11px;color:#9ca3af;font-family:${FONT_STACK};letter-spacing:0.1px;">
              © ${new Date().getFullYear()} ${escHtml(b.name)}.
              ${b.email ? `Si no esperabas este mensaje, respondé a <a href="mailto:${escHtml(b.email)}" style="color:#9ca3af;text-decoration:underline;">${escHtml(b.email)}</a>.` : ""}
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { wrap, getBranding, buildSocialLinks, invalidateBrandingCache };
