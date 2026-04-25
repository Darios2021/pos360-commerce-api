// src/services/messaging/emailLayout.service.js
//
// Layout HTML responsive PRO para emails del CRM. Diseñado para
// Gmail/Outlook/Apple Mail (CSS inline, tablas anidadas, fonts seguras).
//
// Bloques opcionales que el caller puede pedir vía wrap():
//   - signature  : objeto firma del comercial (display_name, role_title,
//                  email, phone, whatsapp, photo_url, tagline)
//   - promoBlocks: array de bloques estilo Oncity (title, image_url,
//                  product_url, price_original, price_final, badge_text,
//                  installments_text, cta_label)
//   - includeLocation: bool (default true) — muestra dirección + maps_url +
//                  horarios en el footer si están cargados.
//
// FUENTES DE BRANDING (orden de prioridad):
//   1) Tabla `shop_branding` (id=1) → name, logo_url, address, maps_url,
//      phone_display, business_hours, tagline, accent_color, bg_color,
//      footer_note
//   2) Tabla `shop_settings` (key='theme') → primary, secondary
//   3) Tabla `shop_links` (kind=instagram/facebook/whatsapp/website/...)
//   4) Tabla `branding_assets` (íconos custom de redes sociales)
//   5) Env vars como fallback final.
//
// Cuando el admin actualiza branding/firma/promos, los emails reflejan los
// cambios automáticamente (cache 60s + invalidate via invalidateBrandingCache).

"use strict";

const { sequelize } = require("../../models");

// Cache simple para no pegarle a la DB en cada email del bulk.
let _brandingCache = null;
let _brandingCacheAt = 0;
const CACHE_TTL_MS = 60 * 1000;

async function loadBrandingFromDb() {
  // shop_branding extendido
  let row = {};
  try {
    const [rows] = await sequelize.query(
      `SELECT * FROM shop_branding WHERE id = 1 LIMIT 1`
    );
    row = rows?.[0] || {};
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

  // shop_links activos. Lógica de variantes (_post, _video, etc.) → base.
  let links = [];
  try {
    const [rows] = await sequelize.query(
      `SELECT kind, label, url FROM shop_links
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    );
    const SUFFIX_RE = /(_post|_video|_reel|_story|_short|_link)$/i;
    const exactByKind = new Map();
    const variantByBase = new Map();

    for (const r of rows || []) {
      const k = String(r.kind || "").toLowerCase().trim();
      if (!k) continue;
      if (SUFFIX_RE.test(k)) {
        const base = k.replace(SUFFIX_RE, "");
        if (!variantByBase.has(base)) variantByBase.set(base, { ...r, kind: base });
      } else {
        if (!exactByKind.has(k)) exactByKind.set(k, r);
      }
    }
    const seen = new Set();
    for (const [kind, r] of exactByKind) { links.push(r); seen.add(kind); }
    for (const [base, r] of variantByBase) {
      if (seen.has(base)) continue;
      links.push(r); seen.add(base);
    }
  } catch (_) {}

  // branding_assets: íconos custom subidos por el admin
  let customIcons = {};
  try {
    const [rows] = await sequelize.query(`SELECT kind, url FROM branding_assets`);
    for (const r of rows || []) {
      const k = String(r.kind || "").toLowerCase().trim();
      if (k && r.url) customIcons[k] = r.url;
    }
  } catch (_) {}

  return {
    name:       row.name || null,
    logoUrl:    row.logo_url || null,
    address:    row.address || null,
    mapsUrl:    row.maps_url || null,
    phone:      row.phone_display || null,
    whatsappContact: row.whatsapp_display || null,
    hours:      row.business_hours || null,
    tagline:    row.tagline || null,
    accentDb:   row.accent_color || null,
    bgDb:       row.bg_color || null,
    footerNoteDb: row.footer_note || null,
    primary, secondary, links, customIcons,
  };
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

function isFullHtmlDocument(body) {
  if (!body) return false;
  const lower = String(body).toLowerCase();
  return /<html[\s>]/i.test(lower) || /<!doctype/i.test(lower);
}

function isHtmlSnippet(body) {
  return /<\/?[a-z][\s\S]*>/i.test(String(body || ""));
}

function plainToHtml(body) {
  return escHtml(body).replace(/\n/g, "<br/>");
}

function normalizeHex(v, fallback) {
  const x = String(v || "").trim();
  if (!x) return fallback;
  const hex = x.startsWith("#") ? x : `#${x}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : fallback;
}

async function getBranding() {
  const db = await getDbBranding().catch(() => ({}));

  const dbLinks = Array.isArray(db.links) ? db.links : [];
  const dbSocialByKind = {};
  for (const l of dbLinks) {
    const kind = String(l.kind || "").toLowerCase();
    if (kind && !dbSocialByKind[kind]) dbSocialByKind[kind] = l.url;
  }

  return {
    name:    db.name || s(process.env.BUSINESS_NAME, "Mi Negocio"),
    logoUrl: db.logoUrl || s(process.env.BUSINESS_LOGO_URL),
    tagline: db.tagline || s(process.env.BUSINESS_TAGLINE),

    website:   dbSocialByKind.website   || s(process.env.BUSINESS_WEBSITE),
    instagram: dbSocialByKind.instagram || s(process.env.BUSINESS_INSTAGRAM),
    facebook:  dbSocialByKind.facebook  || s(process.env.BUSINESS_FACEBOOK),
    whatsapp:  dbSocialByKind.whatsapp  || s(process.env.BUSINESS_WHATSAPP),

    phone:    db.phone || s(process.env.BUSINESS_PHONE),
    email:    s(process.env.BUSINESS_EMAIL) || s(process.env.SMTP_FROM_EMAIL),
    address:  db.address || s(process.env.BUSINESS_ADDRESS),
    mapsUrl:  db.mapsUrl || s(process.env.BUSINESS_MAPS_URL),
    hours:    db.hours || s(process.env.BUSINESS_HOURS),
    whatsappContact: db.whatsappContact || s(process.env.BUSINESS_WHATSAPP_DISPLAY),

    primary: normalizeHex(db.primary || process.env.BRAND_PRIMARY_COLOR, "#02498b"),
    accent:  normalizeHex(db.accentDb || db.secondary || process.env.BRAND_ACCENT_COLOR, "#0ea5e9"),
    bg:      normalizeHex(db.bgDb || process.env.BRAND_BG_COLOR, "#f4f6fa"),

    footerNote: db.footerNoteDb || s(process.env.EMAIL_FOOTER_NOTE),

    extraLinks: dbLinks.filter((l) => {
      const k = String(l.kind || "").toLowerCase();
      return !["website", "instagram", "facebook", "whatsapp"].includes(k);
    }),
    customIcons: db.customIcons || {},
  };
}

const SOCIAL_ICONS = {
  instagram: { label: "Instagram", color: "E4405F", initial: "IG", urlBuilder: (v) => /^https?:/i.test(v) ? v : `https://instagram.com/${String(v).replace(/^@/, "")}` },
  facebook:  { label: "Facebook",  color: "1877F2", initial: "f",  urlBuilder: (v) => /^https?:/i.test(v) ? v : `https://facebook.com/${v}` },
  whatsapp:  { label: "WhatsApp",  color: "25D366", initial: "WA", urlBuilder: (v) => /^https?:/i.test(v) ? v : `https://wa.me/${String(v).replace(/[^\d]/g, "")}` },
  twitter:   { label: "Twitter",   color: "000000", initial: "X",  urlBuilder: (v) => /^https?:/i.test(v) ? v : `https://x.com/${String(v).replace(/^@/, "")}` },
  x:         { label: "X",         color: "000000", initial: "X",  urlBuilder: (v) => /^https?:/i.test(v) ? v : `https://x.com/${String(v).replace(/^@/, "")}` },
  tiktok:    { label: "TikTok",    color: "000000", initial: "TT", urlBuilder: (v) => /^https?:/i.test(v) ? v : `https://tiktok.com/@${String(v).replace(/^@/, "")}` },
  youtube:   { label: "YouTube",   color: "FF0000", initial: "YT", urlBuilder: (v) => v },
  linkedin:  { label: "LinkedIn",  color: "0A66C2", initial: "in", urlBuilder: (v) => v },
  telegram:  { label: "Telegram",  color: "26A5E4", initial: "TG", urlBuilder: (v) => /^https?:/i.test(v) ? v : `https://t.me/${String(v).replace(/^@/, "")}` },
  email:     { label: "Email",     color: "EA4335", initial: "@",  urlBuilder: (v) => v.startsWith("mailto:") ? v : `mailto:${v}` },
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
      customIconUrl: customIcons[kind] || null,
    });
  }

  pushLink("whatsapp",  b.whatsapp);
  pushLink("instagram", b.instagram);
  pushLink("facebook",  b.facebook);
  pushLink("website",   b.website);

  for (const l of b.extraLinks || []) {
    const k = String(l.kind || "").toLowerCase();
    if (SOCIAL_ICONS[k]) pushLink(k, l.url, l.label);
  }
  return links.slice(0, 6);
}

const FONT_STACK = `-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif`;

function renderSocialRow(b) {
  const socials = buildSocialLinks(b);
  if (!socials.length) return "";

  const cells = socials.map((l) => {
    const icon = l.customIconUrl
      ? `<img src="${escHtml(l.customIconUrl)}" alt="${escHtml(l.label)}" width="36" height="36"
              style="border:0;display:block;border-radius:8px;"/>`
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
           <tr>
             <td align="center" valign="middle"
                 style="width:36px;height:36px;background:#${l.color};border-radius:50%;color:#ffffff;font-family:${FONT_STACK};font-size:13px;font-weight:800;line-height:36px;text-align:center;">
               ${escHtml(l.initial)}
             </td>
           </tr>
         </table>`;
    return `<td align="center" valign="top" style="padding:0 8px;">
      <a href="${escHtml(l.url)}" target="_blank" rel="noopener"
         style="display:inline-block;text-decoration:none;font-family:${FONT_STACK};color:#6b7280;">
        ${icon}
        <div style="margin-top:6px;font-size:11px;font-weight:600;color:#6b7280;letter-spacing:0.2px;">
          ${escHtml(l.label)}
        </div>
      </a>
    </td>`;
  }).join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
    <tr>${cells}</tr>
  </table>`;
}

// ─────────────────────────────────────────────────────────
// PROMO BLOCKS — estilo "casa grande" (Oncity / Frávega)
// ─────────────────────────────────────────────────────────
function renderPromoBlock(p, b) {
  const ctaColor = normalizeHex(p.cta_color, b.accent);
  const badgeColor = normalizeHex(p.badge_color, "#e53935");
  const ctaLabel = s(p.cta_label, "Comprar ahora");

  const imgBlock = p.image_url
    ? `<div style="position:relative;background:#f5f7fb;">
         ${p.badge_text
           ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"
                     style="position:absolute;top:12px;left:12px;background:${badgeColor};border-radius:6px;">
                <tr><td style="padding:6px 10px;color:#ffffff;font-family:${FONT_STACK};font-size:12px;font-weight:800;letter-spacing:0.5px;">
                  ${escHtml(p.badge_text)}
                </td></tr>
              </table>`
           : ""}
         <a href="${escHtml(p.product_url)}" target="_blank" rel="noopener" style="text-decoration:none;display:block;">
           <img src="${escHtml(p.image_url)}" alt="${escHtml(p.title)}" width="260"
                style="border:0;display:block;width:100%;max-width:260px;height:auto;margin:0 auto;"/>
         </a>
       </div>`
    : `<div style="background:#f5f7fb;height:160px;display:block;line-height:160px;text-align:center;font-family:${FONT_STACK};color:#9ca3af;font-size:13px;">Sin imagen</div>`;

  const priceLine = (() => {
    const orig = p.price_original ? escHtml(p.price_original) : "";
    const fin = p.price_final ? escHtml(p.price_final) : "";
    if (!orig && !fin) return "";
    return `<div style="margin-top:10px;font-family:${FONT_STACK};">
      ${orig ? `<span style="color:#9ca3af;text-decoration:line-through;font-size:13px;margin-right:8px;">${orig}</span>` : ""}
      ${fin ? `<span style="color:#1f2937;font-size:22px;font-weight:800;letter-spacing:-0.3px;">${fin}</span>` : ""}
    </div>`;
  })();

  const installmentsLine = p.installments_text
    ? `<div style="margin-top:4px;color:${b.accent};font-family:${FONT_STACK};font-size:12.5px;font-weight:700;">
         ${escHtml(p.installments_text)}
       </div>`
    : "";

  const subtitleLine = p.subtitle
    ? `<div style="margin-top:4px;color:#6b7280;font-family:${FONT_STACK};font-size:13px;line-height:1.45;">
         ${escHtml(p.subtitle)}
       </div>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
    <tr><td>${imgBlock}</td></tr>
    <tr>
      <td style="padding:16px 18px 18px;">
        <div style="font-family:${FONT_STACK};font-size:15px;font-weight:700;color:#111827;line-height:1.35;min-height:40px;">
          ${escHtml(p.title || "")}
        </div>
        ${subtitleLine}
        ${priceLine}
        ${installmentsLine}
        <div style="margin-top:14px;">
          <a href="${escHtml(p.product_url)}" target="_blank" rel="noopener"
             style="display:inline-block;background:${ctaColor};color:#ffffff;text-decoration:none;
                    font-family:${FONT_STACK};font-size:13px;font-weight:800;letter-spacing:0.3px;
                    padding:11px 18px;border-radius:8px;">
            ${escHtml(ctaLabel)}
          </a>
        </div>
      </td>
    </tr>
  </table>`;
}

function renderPromoGrid(promoBlocks, b) {
  if (!Array.isArray(promoBlocks) || promoBlocks.length === 0) return "";
  // Renderizamos en grid de 2 columnas (responsive: 1 col en mobile vía table-layout fixed).
  // Outlook no soporta flex/grid, así que usamos tabla con celdas de 50%.
  const rows = [];
  for (let i = 0; i < promoBlocks.length; i += 2) {
    const left = promoBlocks[i];
    const right = promoBlocks[i + 1] || null;

    rows.push(`<tr>
      <td valign="top" style="padding:0 8px 16px 0;width:50%;" class="promo-cell">
        ${renderPromoBlock(left, b)}
      </td>
      <td valign="top" style="padding:0 0 16px 8px;width:50%;" class="promo-cell">
        ${right ? renderPromoBlock(right, b) : "&nbsp;"}
      </td>
    </tr>`);
  }

  return `<div style="margin-top:28px;">
    <div style="font-family:${FONT_STACK};font-size:11px;font-weight:800;color:${b.accent};letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">
      ◆ Productos destacados
    </div>
    <div style="font-family:${FONT_STACK};font-size:20px;font-weight:800;color:#111827;margin-bottom:18px;letter-spacing:-0.3px;">
      Ofertas seleccionadas para vos
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
      ${rows.join("")}
    </table>
  </div>`;
}

// ─────────────────────────────────────────────────────────
// SIGNATURE — bloque firma del comercial
// ─────────────────────────────────────────────────────────
function renderSignature(sig, b) {
  if (!sig) return "";
  const hasAny =
    sig.display_name || sig.role_title || sig.email ||
    sig.phone || sig.whatsapp || sig.photo_url || sig.tagline;
  if (!hasAny) return "";

  const photo = sig.photo_url
    ? `<img src="${escHtml(sig.photo_url)}" alt="${escHtml(sig.display_name || "")}" width="56" height="56"
            style="border:0;display:block;border-radius:50%;width:56px;height:56px;object-fit:cover;"/>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
         <tr><td align="center" valign="middle"
                 style="width:56px;height:56px;background:${b.primary};border-radius:50%;color:#ffffff;font-family:${FONT_STACK};font-size:18px;font-weight:800;line-height:56px;text-align:center;">
           ${escHtml(initialsOf(sig.display_name))}
         </td></tr>
       </table>`;

  const nameLine = sig.display_name
    ? `<div style="font-family:${FONT_STACK};font-size:15px;font-weight:800;color:#111827;letter-spacing:-0.2px;">
         ${escHtml(sig.display_name)}
       </div>`
    : "";

  const roleLine = sig.role_title
    ? `<div style="font-family:${FONT_STACK};font-size:12.5px;color:${b.accent};font-weight:700;letter-spacing:0.3px;text-transform:uppercase;margin-top:2px;">
         ${escHtml(sig.role_title)}
       </div>`
    : "";

  const tag = sig.tagline
    ? `<div style="font-family:${FONT_STACK};font-size:12.5px;color:#6b7280;margin-top:6px;line-height:1.5;">
         ${escHtml(sig.tagline)}
       </div>`
    : "";

  const contactBits = [];
  if (sig.email)    contactBits.push(`<a href="mailto:${escHtml(sig.email)}" style="color:${b.accent};text-decoration:none;font-weight:600;">${escHtml(sig.email)}</a>`);
  if (sig.phone)    contactBits.push(`<span style="color:#374151;">${escHtml(sig.phone)}</span>`);
  if (sig.whatsapp) {
    const num = String(sig.whatsapp).replace(/[^\d]/g, "");
    contactBits.push(`<a href="https://wa.me/${num}" target="_blank" rel="noopener" style="color:#25D366;text-decoration:none;font-weight:700;">WhatsApp</a>`);
  }
  const contactLine = contactBits.length
    ? `<div style="font-family:${FONT_STACK};font-size:12.5px;color:#6b7280;margin-top:8px;line-height:1.6;">
         ${contactBits.join('<span style="margin:0 8px;color:#d1d5db;">·</span>')}
       </div>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="margin-top:32px;background:#fafbfc;border-radius:12px;border:1px solid #e5e7eb;">
    <tr>
      <td style="padding:18px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td valign="top" width="64" style="padding-right:16px;">${photo}</td>
            <td valign="top">
              ${nameLine}
              ${roleLine}
              ${tag}
              ${contactLine}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─────────────────────────────────────────────────────────
// LOCATION — bloque ubicación con maps URL
// ─────────────────────────────────────────────────────────
function renderLocation(b) {
  if (!b.address && !b.mapsUrl && !b.hours) return "";

  const addressLine = b.address
    ? `<div style="font-family:${FONT_STACK};font-size:13px;color:#374151;line-height:1.55;">
         <span style="color:${b.accent};font-weight:800;margin-right:6px;">●</span>${escHtml(b.address)}
       </div>`
    : "";

  const hoursLine = b.hours
    ? `<div style="font-family:${FONT_STACK};font-size:12.5px;color:#6b7280;margin-top:4px;">
         <span style="color:#9ca3af;font-weight:800;margin-right:6px;">◷</span>${escHtml(b.hours)}
       </div>`
    : "";

  const mapsBtn = b.mapsUrl
    ? `<div style="margin-top:10px;">
         <a href="${escHtml(b.mapsUrl)}" target="_blank" rel="noopener"
            style="display:inline-block;background:#ffffff;border:1px solid ${b.accent};color:${b.accent};
                   text-decoration:none;font-family:${FONT_STACK};font-size:12px;font-weight:700;
                   letter-spacing:0.3px;padding:8px 14px;border-radius:6px;">
           Ver en Google Maps →
         </a>
       </div>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="margin-top:24px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;">
    <tr>
      <td style="padding:16px 18px;">
        <div style="font-family:${FONT_STACK};font-size:11px;font-weight:800;color:${b.accent};letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">
          Visitanos
        </div>
        ${addressLine}
        ${hoursLine}
        ${mapsBtn}
      </td>
    </tr>
  </table>`;
}

/**
 * Envuelve un body en el layout HTML responsive PRO.
 *
 * @param {Object} params
 * @param {string} params.body            HTML parcial o texto plano
 * @param {string} [params.subject]       solo para <title>
 * @param {string} [params.previewText]   preview de Gmail
 * @param {Object} [params.signature]     firma del comercial (opcional)
 * @param {Array}  [params.promoBlocks]   array de bloques promocionales (opcional)
 * @param {boolean}[params.includeLocation=true]
 */
async function wrap({
  body,
  subject = "",
  previewText = "",
  signature = null,
  promoBlocks = null,
  includeLocation = true,
} = {}) {
  if (!body) return body;
  if (isFullHtmlDocument(body)) return body;

  const b = await getBranding();
  const innerHtml = isHtmlSnippet(body) ? body : plainToHtml(body);

  const promoHtml = renderPromoGrid(promoBlocks, b);
  const signatureHtml = renderSignature(signature, b);
  const locationHtml = includeLocation ? renderLocation(b) : "";
  const socialsRow = renderSocialRow(b);

  const logoBlock = b.logoUrl
    ? `<img src="${escHtml(b.logoUrl)}" alt="${escHtml(b.name)}" width="180"
            style="border:0;display:block;margin:0 auto;max-width:180px;height:auto;"/>`
    : `<div style="font-family:${FONT_STACK};font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.3px;">
         ${escHtml(b.name)}
       </div>`;

  const taglineBlock = b.tagline
    ? `<div style="font-family:${FONT_STACK};margin-top:10px;font-size:12.5px;color:rgba(255,255,255,0.85);font-weight:500;letter-spacing:0.3px;">
         ${escHtml(b.tagline)}
       </div>`
    : "";

  const websiteCta = b.website
    ? `<a href="${escHtml(b.website)}"
          style="color:${b.accent};text-decoration:none;font-weight:700;font-family:${FONT_STACK};font-size:13px;letter-spacing:0.2px;"
          target="_blank" rel="noopener">
         ${escHtml(b.website.replace(/^https?:\/\//, ""))}
       </a>`
    : "";

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
    .promo-cell { display: block !important; width: 100% !important; padding: 0 0 16px 0 !important; }
  }
  a { color: ${b.accent}; }
  body, table, td, div, p, a, span, li {
    font-family: ${FONT_STACK};
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
</style>
</head>
<body style="margin:0;padding:0;background:${b.bg};font-family:${FONT_STACK};color:#1f2937;">
  ${previewText ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escHtml(previewText)}</div>` : ""}

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${b.bg};">
    <tr>
      <td align="center" style="padding:28px 12px;">

        <!-- Container -->
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0"
               style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,0.08);">

          <!-- Header con logo / nombre -->
          <tr>
            <td align="center" style="background:${b.primary};padding:36px 24px 30px;">
              ${logoBlock}
              ${taglineBlock}
            </td>
          </tr>

          <!-- Acento decorativo -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg, ${b.primary}, ${b.accent});line-height:4px;font-size:0;">&nbsp;</td>
          </tr>

          <!-- Contenido principal -->
          <tr>
            <td class="px-32 py-32"
                style="padding:36px 40px 28px;font-family:${FONT_STACK};font-size:15.5px;line-height:1.7;color:#1f2937;letter-spacing:0.1px;">
              ${innerHtml}
              ${promoHtml}
              ${signatureHtml}
              ${locationHtml}
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
                style="padding:24px 40px 28px;font-family:${FONT_STACK};color:#6b7280;font-size:13px;line-height:1.65;letter-spacing:0.1px;">
              <div class="footer-name"
                   style="font-weight:800;color:${b.primary};font-size:17px;margin-bottom:6px;letter-spacing:0.3px;">
                ${escHtml(b.name)}
              </div>
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

module.exports = {
  wrap,
  getBranding,
  buildSocialLinks,
  invalidateBrandingCache,
  renderPromoGrid,
  renderSignature,
  renderLocation,
};
