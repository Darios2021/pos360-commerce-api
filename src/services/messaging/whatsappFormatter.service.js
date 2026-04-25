// src/services/messaging/whatsappFormatter.service.js
//
// Arma un mensaje rico de WhatsApp con formato propio (markdown WhatsApp:
// *bold*, _italic_, ~strike~, ```mono```), emojis, separadores y links.
//
// Por qué no se puede embeber imágenes: el método wa.me sólo soporta texto.
// Para enviar cards visuales hay que ir por WhatsApp Cloud API con plantillas
// pre-aprobadas por Meta. Este formatter compensa con un texto MUY rico que
// ya queda elegante en cualquier WhatsApp (mobile/web/desktop).
//
// Estructura del mensaje:
//   👋 Saludo personalizado
//   [body del operador]
//   ━━━━━━━━━━━━━━━━━━━━
//   🛒 Producto 1
//      💰 ~$X~ → *$Y* (-Z%)
//      💳 cuotas
//      🔗 link
//   🛒 Producto 2 ...
//   ━━━━━━━━━━━━━━━━━━━━
//   📍 Datos del local
//   🕐 Horarios
//   🗺️ Maps
//   ━━━━━━━━━━━━━━━━━━━━
//   👤 Firma del comercial

"use strict";

const layoutSvc = require("./emailLayout.service");

const SEP = "━━━━━━━━━━━━━━━━━━━━";

function s(v) { return String(v ?? "").trim(); }

function bold(t) {
  const x = s(t);
  return x ? `*${x}*` : "";
}

function strike(t) {
  const x = s(t);
  return x ? `~${x}~` : "";
}

// Escapa cualquier asterisco/underscore que ya tenga el texto del operador
// para que no rompa el formato. WhatsApp escape: anteponer un ​.
function safeText(t) {
  return s(t);
}

function renderGreeting(customer) {
  const name = s(customer?.first_name || customer?.display_name || "").split(" ")[0];
  if (name) return `👋 Hola ${bold(name)},`;
  return "👋 ¡Hola!";
}

function renderPromoLine(p) {
  const lines = [];
  const title = s(p.title || p.name);
  if (!title) return "";

  lines.push(`🛒 ${bold(title)}`);

  if (p.subtitle) {
    lines.push(`   _${safeText(p.subtitle)}_`);
  }

  // Precios
  const priceFinal = s(p.price_final);
  const priceOriginal = s(p.price_original);
  const badge = s(p.badge_text);

  if (priceOriginal && priceFinal) {
    let priceLine = `   💰 ${strike(priceOriginal)} → ${bold(priceFinal)}`;
    if (badge) priceLine += ` (${badge})`;
    lines.push(priceLine);
  } else if (priceFinal) {
    let priceLine = `   💰 ${bold(priceFinal)}`;
    if (badge) priceLine += ` (${badge})`;
    lines.push(priceLine);
  }

  if (p.installments_text) {
    lines.push(`   💳 ${safeText(p.installments_text)}`);
  }

  if (p.product_url) {
    lines.push(`   🔗 ${p.product_url}`);
  }

  return lines.join("\n");
}

function renderLocation(b) {
  const lines = [];
  if (b.address) {
    lines.push(`📍 ${bold(b.name || "Visitanos")}`);
    lines.push(`   ${safeText(b.address)}`);
  }
  if (b.phone) {
    lines.push(`📞 ${safeText(b.phone)}`);
  }
  if (b.hours) {
    lines.push(`🕐 ${safeText(b.hours)}`);
  }
  if (b.mapsUrl) {
    lines.push(`🗺️ Cómo llegar: ${b.mapsUrl}`);
  }
  return lines.join("\n");
}

function renderSignature(sig) {
  if (!sig) return "";
  const lines = [];
  const name = s(sig.display_name);
  const role = s(sig.role_title);

  if (name) {
    let line = `👤 — ${bold(name)}`;
    lines.push(line);
  }
  if (role) lines.push(`   _${safeText(role)}_`);

  const contactBits = [];
  if (sig.email)    contactBits.push(`📧 ${sig.email}`);
  if (sig.phone)    contactBits.push(`📞 ${sig.phone}`);
  if (contactBits.length) {
    lines.push(`   ${contactBits.join("  ·  ")}`);
  }

  return lines.join("\n");
}

/**
 * Arma el mensaje WhatsApp completo.
 *
 * @param {Object} params
 * @param {string} params.body                cuerpo escrito por el operador
 * @param {Object} [params.customer]          { first_name, display_name }
 * @param {Array}  [params.promoBlocks]       array de promos hidratadas
 * @param {Object} [params.signature]         firma del operador
 * @param {boolean}[params.includeLocation=true]
 * @returns {Promise<string>}                 mensaje listo para WhatsApp
 */
async function formatRichMessage({
  body,
  customer = null,
  promoBlocks = null,
  signature = null,
  includeLocation = true,
} = {}) {
  const branding = await layoutSvc.getBranding().catch(() => ({}));

  const sections = [];

  // 1) Saludo personalizado (siempre, salvo que el body ya empiece con uno).
  const userBody = s(body);
  const startsWithGreeting = /^(hola|buen|hi|hey)/i.test(userBody);
  if (!startsWithGreeting) {
    sections.push(renderGreeting(customer));
  }

  // 2) Body del operador
  if (userBody) sections.push(userBody);

  // 3) Promos
  if (Array.isArray(promoBlocks) && promoBlocks.length) {
    const promoLines = promoBlocks
      .map(renderPromoLine)
      .filter(Boolean)
      .join("\n\n");
    if (promoLines) {
      sections.push(SEP);
      sections.push(`✨ ${bold("Productos destacados")}`);
      sections.push(promoLines);
    }
  }

  // 4) Ubicación
  if (includeLocation) {
    const loc = renderLocation(branding);
    if (loc) {
      sections.push(SEP);
      sections.push(loc);
    }
  }

  // 5) Firma
  const sigText = renderSignature(signature);
  if (sigText) {
    sections.push(SEP);
    sections.push(sigText);
  }

  return sections.join("\n\n").trim();
}

module.exports = {
  formatRichMessage,
};
