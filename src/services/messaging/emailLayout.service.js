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

  // shop_links activos. Lógica:
  //   1) Si el kind es exacto (ej: "instagram"), gana siempre.
  //   2) Si el kind tiene sufijo (_post, _video, _reel, _story, _short, _link),
  //      lo tratamos como variante del kind base ("instagram_post" → "instagram").
  //      Solo se usa la PRIMERA variante de cada base como representante del
  //      perfil — así no se llena el footer de N copias de Instagram.
  //   3) El kind exacto siempre tiene precedencia sobre las variantes.
  let links = [];
  try {
    const [rows] = await sequelize.query(
      `SELECT kind, label, url FROM shop_links
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    );
    const SUFFIX_RE = /(_post|_video|_reel|_story|_short|_link)$/i;
    const exactByKind = new Map();    // kind base exacto presente en DB
    const variantByBase = new Map();  // primer registro variante por base

    for (const r of rows || []) {
      const k = String(r.kind || "").toLowerCase().trim();
      if (!k) continue;

      if (SUFFIX_RE.test(k)) {
        const base = k.replace(SUFFIX_RE, "");
        if (!variantByBase.has(base)) {
          // Guardamos como del kind base (no _post) para que el resolver de
          // íconos lo trate como red social estándar.
          variantByBase.set(base, { ...r, kind: base });
        }
      } else {
        if (!exactByKind.has(k)) exactByKind.set(k, r);
      }
    }

    // Combinamos: el kind exacto pisa la variante (si existe el "instagram"
    // exacto, ignoramos los "instagram_post").
    const seen = new Set();
    for (const [kind, row] of exactByKind) {
      links.push(row);
      seen.add(kind);
    }
    for (const [base, row] of variantByBase) {
      if (seen.has(base)) continue;
      links.push(row);
      seen.add(base);
    }
  } catch (_) {}

  // branding_assets: íconos custom subidos por el admin (override del default).
  // Map kind → URL del PNG. Si existe, el email lo usa en vez de la
  // representación con iniciales coloreadas.
  let customIcons = {};
  try {
    const [rows] = await sequelize.query(
      `SELECT kind, url FROM branding_assets`
    );
    for (const r of rows || []) {
      const k = String(r.kind || "").toLowerCase().trim();
      if (k && r.url) customIcons[k] = r.url;
    }
  } catch (_) {
    // Tabla puede no existir todavía si no se sincronizó.
  }

  return { name, logoUrl, primary, secondary, links, customIcons };
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

    // Íconos custom subidos por el admin (override de las iniciales coloreadas).
    customIcons: db.customIcons || {},
  };
}

function normalizeHex(v, fallback) {
  const x = String(v || "").trim();
  if (!x) return fallback;
  const hex = x.startsWith("#") ? x : `#${x}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : fallback;
}

// Mapeo de redes sociales conocidas. Cada una tiene:
//   - label: texto a mostrar
//   - color: hex sin # (color de marca)
//   - symbol: caracter Unicode que representa la red. Usamos símbolos en vez
//     de imágenes externas porque algunos clientes (Outlook, Gmail con
//     imágenes bloqueadas) no las cargan. Los caracteres Unicode SIEMPRE se
//     renderizan, y combinados con el color de marca quedan profesionales.
//   - urlBuilder: arma la URL final desde el valor configurado.
//
// Los símbolos elegidos son visualmente reconocibles en cualquier cliente:
// usamos la inicial de cada red en mayúscula sobre un círculo del color de
// marca. Es la opción más robusta para email cross-cliente.
const SOCIAL_ICONS = {
  instagram: { label: "Instagram", color: "E4405F", initial: "IG", urlBuilder: (v) =>
    /^https?:/i.test(v) ? v : `https://instagram.com/${String(v).replace(/^@/, "")}` },
  facebook:  { label: "Facebook",  color: "1877F2", initial: "f",  urlBuilder: (v) =>
    /^https?:/i.test(v) ? v : `https://facebook.com/${v}` },
  whatsapp:  { label: "WhatsApp",  color: "25D366", initial: "WA", urlBuilder: (v) =>
    /^https?:/i.test(v) ? v : `https://wa.me/${String(v).replace(/[^\d]/g, "")}` },
  twitter:   { label: "Twitter", color: "000000", initial: "X",  urlBuilder: (v) =>
    /^https?:/i.test(v) ? v : `https://x.com/${String(v).replace(/^@/, "")}` },
  x:         { label: "X",         color: "000000", initial: "X",  urlBuilder: (v) =>
    /^https?:/i.test(v) ? v : `https://x.com/${String(v).replace(/^@/, "")}` },
  tiktok:    { label: "TikTok",    color: "000000", initial: "TT", urlBuilder: (v) =>
    /^https?:/i.test(v) ? v : `https://tiktok.com/@${String(v).replace(/^@/, "")}` },
  youtube:   { label: "YouTube",   color: "FF0000", initial: "YT", urlBuilder: (v) => v },
  linkedin:  { label: "LinkedIn",  color: "0A66C2", initial: "in", urlBuilder: (v) => v },
  telegram:  { label: "Telegram",  color: "26A5E4", initial: "TG", urlBuilder: (v) =>
    /^https?:/i.test(v) ? v : `https://t.me/${String(v).replace(/^@/, "")}` },
  email:     { label: "Email",     color: "EA4335", initial: "@",  urlBuilder: (v) =>
    v.startsWith("mailto:") ? v : `mailto:${v}` },
  website:   { label: "Sitio web", color: null,     initial: "W",  urlBuilder: (v) => v },
  spotify:   { label: "Spotify",   color: "1DB954", initial: "♫",  urlBuilder: (v) => v },
  github:    { label: "GitHub",    color: "181717", initial: "Gh", urlBuilder: (v) => v },
};

function buildSocialLinks(b) {
  const links = [];
  const customIcons = b.customIcons || {};

  function pushLink(kind, rawValue, labelOverride) {
    if (!rawValue) return;
    const map = SOCIAL_ICONS[kind];
    if (!map) return;
    links.push({
      kind,
      url: map.urlBuilder(rawValue),
      label: labelOverride || map.label,
      color: map.color || (b.primary ? b.primary.replace(/^#/, "") : "1f2937"),
      initial: map.initial,
      customIconUrl: customIcons[kind] || null,  // si el admin subió PNG, lo usamos
    });
  }

  // Orden visual deseado: WhatsApp primero (más usado), luego redes.
  pushLink("whatsapp",  b.whatsapp);
  pushLink("instagram", b.instagram);
  pushLink("facebook",  b.facebook);
  pushLink("website",   b.website);

  // Links extra de shop_links (kinds reconocidos en SOCIAL_ICONS).
  for (const l of b.extraLinks || []) {
    const k = String(l.kind || "").toLowerCase();
    if (SOCIAL_ICONS[k]) {
      pushLink(k, l.url, l.label);
    }
  }

  // Limitar a 6 íconos para que el footer no se desborde.
  return links.slice(0, 6);
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
  // Render: si el admin subió un PNG custom desde Branding (branding_assets),
  // usamos esa imagen. Si no, mostramos un círculo del color de marca con
  // las iniciales en blanco — más feo pero garantizado para TODOS los
  // clientes de email (no requiere cargar imágenes externas).
  function renderIconCell(l) {
    const icon = l.customIconUrl
      ? `<img src="${escHtml(l.customIconUrl)}" alt="${escHtml(l.label)}" width="36" height="36"
              style="border:0;display:block;border-radius:8px;"/>`
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
           <tr>
             <td align="center" valign="middle"
                 style="width:36px;height:36px;background:#${l.color};border-radius:50%;color:#ffffff;font-family:${FONT_STACK};font-size:13px;font-weight:800;line-height:36px;letter-spacing:0;text-align:center;">
               ${escHtml(l.initial)}
             </td>
           </tr>
         </table>`;

    return `<td align="center" valign="top" style="padding:0 10px;">
      <a href="${escHtml(l.url)}" target="_blank" rel="noopener"
         style="display:inline-block;text-decoration:none;font-family:${FONT_STACK};color:#6b7280;">
        ${icon}
        <div style="margin-top:6px;font-size:11px;font-weight:600;color:#6b7280;letter-spacing:0.2px;">
          ${escHtml(l.label)}
        </div>
      </a>
    </td>`;
  }

  const socialsRow = socials.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
         <tr>${socials.map(renderIconCell).join("")}</tr>
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
