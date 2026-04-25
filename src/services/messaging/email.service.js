// src/services/messaging/email.service.js
//
// Envío de email vía SMTP (nodemailer). Configuración por env:
//
//   SMTP_HOST         servidor SMTP (ej: smtp.gmail.com, smtp.hostinger.com)
//   SMTP_PORT         puerto (465 para SSL, 587 para STARTTLS)
//   SMTP_SECURE       "true" para SSL (puerto 465), "false" para STARTTLS (587)
//   SMTP_USER         usuario / cuenta
//   SMTP_PASS         contraseña / app password
//   SMTP_FROM_NAME    nombre del remitente (ej: "POS360")
//   SMTP_FROM_EMAIL   email del remitente (puede ser distinto de SMTP_USER)
//   SMTP_REPLY_TO     opcional, dirección de respuesta
//
// Si falta cualquier variable obligatoria, el servicio queda deshabilitado y
// `sendEmail` devuelve { ok: false, code: "EMAIL_NOT_CONFIGURED" }.

"use strict";

let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch (e) {
  console.warn("[email.service] nodemailer no está instalado. Corré `npm install` en el backend.");
}

const layoutSvc = require("./emailLayout.service");

let _transporter = null;
let _verifiedAt = 0;

function isConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

// El email del FROM debe coincidir con el SMTP_USER (la casilla autenticada).
// Si difieren SPF/DKIM rebotan en Gmail/Outlook → SPAM. Forzamos el del USER
// y dejamos SMTP_FROM_EMAIL como override sólo si tiene el mismo dominio.
function getFromEmail() {
  const user = String(process.env.SMTP_USER || "").trim().toLowerCase();
  const fromEnv = String(process.env.SMTP_FROM_EMAIL || "").trim().toLowerCase();
  if (!fromEnv) return user;
  // Si SMTP_FROM_EMAIL tiene otro dominio → ignoramos y usamos el del USER
  // para evitar SPF fail (Hostinger sólo firma DKIM con el dominio del User).
  const userDomain = user.split("@")[1] || "";
  const fromDomain = fromEnv.split("@")[1] || "";
  if (userDomain && fromDomain && userDomain !== fromDomain) {
    console.warn(
      `[email.service] SMTP_FROM_EMAIL (${fromEnv}) tiene otro dominio que SMTP_USER ` +
      `(${user}). Usando ${user} para preservar SPF/DKIM.`
    );
    return user;
  }
  return fromEnv;
}

function getFromName() {
  return process.env.SMTP_FROM_NAME || process.env.BUSINESS_NAME || "Notificaciones";
}

function getFrom() {
  return `"${getFromName()}" <${getFromEmail()}>`;
}

// Genera un Message-ID RFC-compliant con el dominio del FROM. Sin esto algunos
// SMTP relays generan IDs raros y los filtros bajan score.
function generateMessageId() {
  const fromEmail = getFromEmail();
  const domain = (fromEmail.split("@")[1] || "localhost").trim();
  const rand = Math.random().toString(36).slice(2, 11);
  const ts = Date.now().toString(36);
  return `<${ts}.${rand}@${domain}>`;
}

// Headers anti-SPAM. El header crítico es `List-Unsubscribe` con one-click —
// Gmail desde Feb 2024 castiga fuerte a remitentes que no lo tienen, sobre
// todo en envíos masivos. RFC 8058.
//
// Si el negocio expone una URL de unsubscribe (ej. desde el shop público),
// la podés setear vía CRM_UNSUBSCRIBE_URL. Si no, usamos un mailto.
function getDeliverabilityHeaders({ isBulk = false } = {}) {
  const fromEmail = getFromEmail();
  const unsubscribeUrl = String(process.env.CRM_UNSUBSCRIBE_URL || "").trim();
  const unsubscribeMailto = String(process.env.CRM_UNSUBSCRIBE_MAILTO || fromEmail).trim();

  const parts = [];
  if (unsubscribeMailto) parts.push(`<mailto:${unsubscribeMailto}?subject=unsubscribe>`);
  if (unsubscribeUrl) parts.push(`<${unsubscribeUrl}>`);

  const headers = {
    "X-Mailer": "POS360-CRM",
    "X-Auto-Response-Suppress": "OOF, AutoReply",
  };

  if (parts.length) {
    headers["List-Unsubscribe"] = parts.join(", ");
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  // Para envíos a >1 destinatario, marcamos como bulk para que filtros
  // anti-loop no lo confundan con tráfico transaccional 1:1.
  if (isBulk) {
    headers["Precedence"] = "bulk";
    headers["Auto-Submitted"] = "auto-generated";
  }

  return headers;
}

function getTransporter() {
  if (!nodemailer) return null;
  if (!isConfigured()) return null;

  if (_transporter) return _transporter;

  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Permitir certificados auto-firmados (algunos hostings los usan).
    tls: { rejectUnauthorized: false },
  });

  return _transporter;
}

/**
 * Health-check del SMTP. Verifica autenticación. Cacheado por 5 min.
 */
async function ping() {
  if (!isConfigured()) return { ok: false, code: "EMAIL_NOT_CONFIGURED" };
  const t = getTransporter();
  if (!t) return { ok: false, code: "TRANSPORT_FAILED" };

  if (Date.now() - _verifiedAt < 5 * 60_000) return { ok: true, cached: true };

  try {
    await t.verify();
    _verifiedAt = Date.now();
    return { ok: true };
  } catch (e) {
    return { ok: false, code: "VERIFY_FAILED", error: e?.message || "verify error" };
  }
}

/**
 * Envía un email. Resuelve { ok, message_id, error_message } sin tirar.
 *
 * @param {Object} params
 * @param {string} params.to             destinatario
 * @param {string} params.subject        asunto
 * @param {string} params.body           cuerpo (HTML o texto plano — se detecta)
 * @param {string} [params.toName]       nombre del destinatario
 * @param {string} [params.replyTo]      email de respuesta
 * @param {boolean} [params.useLayout]   default true. Si false, manda body crudo
 *                                        sin envolver en el layout HTML del negocio.
 *                                        Útil para mensajes técnicos / debug.
 * @param {string} [params.previewText]  texto que muestran los clientes de email
 *                                        en la lista, al lado del asunto.
 * @param {Object} [params.signature]    firma del comercial (display_name,
 *                                        role_title, email, phone, whatsapp,
 *                                        photo_url, tagline). Si se pasa, el
 *                                        layout la inserta antes del footer.
 * @param {Array}  [params.promoBlocks]  bloques promocionales (productos
 *                                        destacados estilo Oncity). El layout
 *                                        los renderiza en grid 2-col.
 * @param {boolean}[params.includeLocation=true] mostrar bloque ubicación.
 * @param {boolean}[params.isBulk=false]  marca el envío como bulk para sumar
 *                                         headers Precedence/Auto-Submitted.
 */
async function sendEmail({
  to, subject, body, toName, replyTo,
  useLayout = true, previewText,
  signature = null, promoBlocks = null, includeLocation = true,
  isBulk = false,
}) {
  if (!isConfigured()) {
    return {
      ok: false,
      code: "EMAIL_NOT_CONFIGURED",
      error_message: "Faltan variables SMTP_* en el entorno del backend.",
    };
  }
  if (!nodemailer) {
    return {
      ok: false,
      code: "NODEMAILER_NOT_INSTALLED",
      error_message: "El paquete nodemailer no está instalado.",
    };
  }
  if (!to) {
    return { ok: false, code: "MISSING_TO", error_message: "Destinatario requerido." };
  }

  const transport = getTransporter();
  if (!transport) {
    return { ok: false, code: "TRANSPORT_FAILED", error_message: "No se pudo crear el transporter SMTP." };
  }

  // Construcción del payload:
  // - Si useLayout=true (default), envolvemos el body en el layout HTML
  //   responsive del negocio (logo, colores, footer con datos de contacto).
  //   El layout funciona con body en HTML parcial o texto plano.
  // - Si useLayout=false, enviamos el body tal cual (texto plano o HTML crudo).
  // Siempre mandamos también una versión `text` derivada del HTML para los
  // clientes que no muestran HTML (mejora deliverability y accessibility).
  let html = null;
  let text = null;

  if (useLayout) {
    html = await layoutSvc.wrap({ body, subject, previewText, signature, promoBlocks, includeLocation });
    text = htmlToPlainText(body); // versión texto del body sin layout
  } else {
    const isHtml = /<\/?[a-z][\s\S]*>/i.test(String(body || ""));
    if (isHtml) {
      html = body;
      text = htmlToPlainText(body);
    } else {
      text = String(body || "");
    }
  }

  try {
    const messageId = generateMessageId();
    const headers = getDeliverabilityHeaders({ isBulk });

    const info = await transport.sendMail({
      from: getFrom(),
      to: toName ? `"${toName}" <${to}>` : to,
      subject: subject || "(sin asunto)",
      messageId,
      headers,
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
      replyTo: replyTo || process.env.SMTP_REPLY_TO || undefined,
    });

    return {
      ok: true,
      provider: "smtp",
      message_id: info?.messageId || null,
    };
  } catch (e) {
    return {
      ok: false,
      provider: "smtp",
      code: "SMTP_SEND_FAILED",
      error_message: e?.message || "Error desconocido",
    };
  }
}

// Convierte HTML simple a texto plano legible (alternativa para clientes
// de email que muestran solo texto). No es perfecto pero suficiente.
function htmlToPlainText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = { sendEmail, ping, isConfigured };
