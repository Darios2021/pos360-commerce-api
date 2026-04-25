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

function getFrom() {
  const name  = process.env.SMTP_FROM_NAME  || process.env.BUSINESS_NAME || "Notificaciones";
  const email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  return `"${name}" <${email}>`;
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
 * @param {string} params.to        destinatario
 * @param {string} params.subject   asunto
 * @param {string} params.body      cuerpo (HTML o texto plano — se detecta)
 * @param {string} [params.toName]  nombre del destinatario
 * @param {string} [params.replyTo] email de respuesta
 */
async function sendEmail({ to, subject, body, toName, replyTo }) {
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

  // Heurística simple para detectar si el body es HTML.
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(String(body || ""));

  try {
    const info = await transport.sendMail({
      from: getFrom(),
      to: toName ? `"${toName}" <${to}>` : to,
      subject: subject || "(sin asunto)",
      [isHtml ? "html" : "text"]: body || "",
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

module.exports = { sendEmail, ping, isConfigured };
