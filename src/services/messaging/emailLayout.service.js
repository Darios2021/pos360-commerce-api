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

function buildSocialLinks(b) {
  const links = [];
  if (b.instagram) {
    const url = b.instagram.startsWith("http")
      ? b.instagram
      : `https://instagram.com/${b.instagram.replace(/^@/, "")}`;
    links.push({
      url,
      label: "Instagram",
      icon: "https://cdn-icons-png.flaticon.com/24/2111/2111463.png",
    });
  }
  if (b.facebook) {
    links.push({
      url: b.facebook,
      label: "Facebook",
      icon: "https://cdn-icons-png.flaticon.com/24/733/733547.png",
    });
  }
  if (b.whatsapp) {
    // Si ya es URL, la usamos tal cual; si es número, armamos wa.me
    const isUrl = /^https?:\/\//i.test(b.whatsapp);
    const url = isUrl
      ? b.whatsapp
      : `https://wa.me/${String(b.whatsapp).replace(/[^\d]/g, "")}`;
    links.push({
      url,
      label: "WhatsApp",
      icon: "https://cdn-icons-png.flaticon.com/24/733/733585.png",
    });
  }
  if (b.website) {
    links.push({
      url: b.website,
      label: "Sitio web",
      icon: "https://cdn-icons-png.flaticon.com/24/1006/1006771.png",
    });
  }
  // Links extra de shop_links que no son los 4 estándar.
  for (const l of b.extraLinks || []) {
    links.push({
      url: l.url,
      label: l.label || l.kind || "Link",
      icon: "https://cdn-icons-png.flaticon.com/24/1006/1006771.png",
    });
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

  const socials = buildSocialLinks(b);
  const socialsRow = socials.length
    ? socials
        .map(
          (l) =>
            `<a href="${escHtml(l.url)}" style="display:inline-block;margin:0 6px;text-decoration:none;" target="_blank" rel="noopener">
               <img src="${escHtml(l.icon)}" alt="${escHtml(l.label)}" width="20" height="20" style="border:0;display:block;"/>
             </a>`
        )
        .join("")
    : "";

  const logoBlock = b.logoUrl
    ? `<img src="${escHtml(b.logoUrl)}" alt="${escHtml(b.name)}" width="160" style="border:0;display:block;margin:0 auto;max-width:160px;height:auto;"/>`
    : `<div style="font-family:Arial,sans-serif;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">${escHtml(b.name)}</div>`;

  const websiteCta = b.website
    ? `<a href="${escHtml(b.website)}" style="color:${b.accent};text-decoration:none;font-weight:700;" target="_blank" rel="noopener">${escHtml(b.website.replace(/^https?:\/\//, ""))}</a>`
    : "";

  // Construimos el HTML con tablas (compatibilidad con Outlook).
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta name="x-apple-disable-message-reformatting"/>
<title>${escHtml(subject || b.name)}</title>
<style>
  /* Solo afecta clientes que soportan style en head; el resto va inline. */
  @media only screen and (max-width: 600px) {
    .container { width: 100% !important; }
    .px-32 { padding-left: 20px !important; padding-right: 20px !important; }
    .py-32 { padding-top: 24px !important; padding-bottom: 24px !important; }
    .h1 { font-size: 22px !important; }
  }
  a { color: ${b.accent}; }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <!-- Preview text (no se ve en el body, sí en la lista del inbox) -->
  ${previewText ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escHtml(previewText)}</div>` : ""}

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fa;">
    <tr>
      <td align="center" style="padding:24px 12px;">

        <!-- Container -->
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0"
               style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">

          <!-- Header con logo / nombre -->
          <tr>
            <td align="center" style="background:${b.primary};padding:28px 20px;">
              ${logoBlock}
            </td>
          </tr>

          <!-- Acento decorativo -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg, ${b.primary}, ${b.accent});line-height:4px;font-size:0;">&nbsp;</td>
          </tr>

          <!-- Contenido -->
          <tr>
            <td class="px-32 py-32" style="padding:32px 36px;font-size:15px;line-height:1.65;color:#1f2937;">
              ${innerHtml}
            </td>
          </tr>

          <!-- Separador -->
          <tr>
            <td style="padding:0 36px;">
              <div style="height:1px;background:#e5e7eb;line-height:1px;font-size:0;">&nbsp;</div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" class="px-32" style="padding:22px 36px 26px;font-family:Arial,sans-serif;color:#6b7280;font-size:12px;line-height:1.6;">
              <div style="font-weight:800;color:${b.primary};font-size:14px;margin-bottom:4px;">${escHtml(b.name)}</div>
              ${b.address ? `<div>${escHtml(b.address)}</div>` : ""}
              ${b.phone || b.email ? `<div style="margin-top:2px;">
                ${b.phone ? `<span>${escHtml(b.phone)}</span>` : ""}
                ${b.phone && b.email ? `<span style="margin:0 6px;color:#d1d5db;">·</span>` : ""}
                ${b.email ? `<a href="mailto:${escHtml(b.email)}" style="color:${b.accent};text-decoration:none;">${escHtml(b.email)}</a>` : ""}
              </div>` : ""}
              ${websiteCta ? `<div style="margin-top:6px;">${websiteCta}</div>` : ""}
              ${socialsRow ? `<div style="margin-top:14px;">${socialsRow}</div>` : ""}
              ${b.footerNote ? `<div style="margin-top:14px;font-size:11px;opacity:0.8;">${escHtml(b.footerNote)}</div>` : ""}
            </td>
          </tr>

        </table>

        <!-- Pie meta (afuera del container) -->
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0"
               style="width:600px;max-width:600px;">
          <tr>
            <td align="center" style="padding:14px 20px 8px;font-size:11px;color:#9ca3af;font-family:Arial,sans-serif;">
              © ${new Date().getFullYear()} ${escHtml(b.name)}.
              ${b.email ? `Si no esperabas este mensaje, respondé a <a href="mailto:${escHtml(b.email)}" style="color:#9ca3af;">${escHtml(b.email)}</a>.` : ""}
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
