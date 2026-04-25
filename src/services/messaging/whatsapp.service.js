// src/services/messaging/whatsapp.service.js
//
// Envío de WhatsApp con dos modos:
//
// 1) WhatsApp Cloud API (oficial, Meta) — envío automático real.
//    Requiere registrarse en https://business.facebook.com → WhatsApp →
//    obtener un Phone Number ID y un access token.
//    Variables de entorno:
//      WHATSAPP_API_TOKEN        access token (Bearer)
//      WHATSAPP_PHONE_NUMBER_ID  ID del número (no el número en sí)
//      WHATSAPP_API_VERSION      opcional, default v22.0
//
//    Notas: para mensajes promocionales hay que usar plantillas
//    pre-aprobadas por Meta; los mensajes "free-form" solo funcionan en la
//    ventana de 24h después del último mensaje del usuario. Por eso este
//    servicio devuelve un error claro cuando Meta rechaza el envío y deja
//    el fallback wa.me como Plan B.
//
// 2) Fallback wa.me — genera un link tipo
//    https://wa.me/5492640000000?text=Hola%20Juan ...
//    Lo envía el frontend abriéndolo en una pestaña nueva. No es envío
//    automático: el usuario tiene que tocar "Enviar" en WhatsApp Web/Mobile.
//
// Si las credenciales de Cloud API no están configuradas, el sistema cae
// automáticamente al modo wa.me.

"use strict";

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v22.0";

function isCloudApiConfigured() {
  return !!(process.env.WHATSAPP_API_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Normaliza un teléfono argentino al formato que espera la API de Meta:
 *   - solo dígitos
 *   - con código de país (54 si no lo tiene)
 *   - sin el "9" móvil de Argentina (algunos formatos lo incluyen, otros no;
 *     Meta acepta ambas formas pero es más seguro normalizar)
 */
function normalizePhone(raw) {
  let p = String(raw || "").replace(/[^\d]/g, "");
  if (!p) return null;

  // Si arranca con "549" → "54" + "9" + número, está OK para Argentina mobile.
  // Si arranca con "54" pero no "549", también está OK.
  // Si arranca con "0" → es teléfono local, agregamos código país argentino.
  if (p.startsWith("0")) p = p.replace(/^0+/, "");
  if (p.length >= 10 && !p.startsWith("54")) p = "54" + p;

  return p;
}

/**
 * Genera un link wa.me con el mensaje precargado.
 */
function buildWaMeLink(phone, body) {
  const num = normalizePhone(phone);
  if (!num) return null;
  const encoded = encodeURIComponent(String(body || ""));
  return `https://wa.me/${num}?text=${encoded}`;
}

/**
 * Envía un mensaje de texto vía Cloud API.
 * Asume que estamos dentro de la ventana de 24h o usando una plantilla
 * pre-aprobada. Para mensajes free-form fuera de la ventana, Meta va a
 * devolver un error y el caller decide si usa el fallback wa.me.
 *
 * @param {Object} params
 * @param {string} params.to    teléfono del destinatario (con o sin formato)
 * @param {string} params.body  texto plano del mensaje
 */
async function sendViaCloudApi({ to, body }) {
  if (!isCloudApiConfigured()) {
    return {
      ok: false,
      code: "WHATSAPP_NOT_CONFIGURED",
      error_message: "Faltan WHATSAPP_API_TOKEN o WHATSAPP_PHONE_NUMBER_ID.",
    };
  }

  const phone = normalizePhone(to);
  if (!phone) {
    return { ok: false, code: "INVALID_PHONE", error_message: "Teléfono inválido." };
  }

  const url = `https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "text",
    text: { preview_url: false, body: String(body || "") },
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const errMsg =
        data?.error?.message ||
        data?.error?.error_user_msg ||
        `HTTP ${r.status}`;
      return {
        ok: false,
        provider: "whatsapp_cloud",
        code: "CLOUD_API_REJECTED",
        error_message: errMsg,
        raw: data,
      };
    }

    const msgId =
      data?.messages?.[0]?.id ||
      data?.messages?.[0]?.message_id ||
      null;

    return {
      ok: true,
      provider: "whatsapp_cloud",
      message_id: msgId,
    };
  } catch (e) {
    return {
      ok: false,
      provider: "whatsapp_cloud",
      code: "CLOUD_API_NETWORK_ERROR",
      error_message: e?.message || "Network error",
    };
  }
}

/**
 * Punto de entrada principal.
 *
 * @param {Object} params
 * @param {string} params.to            teléfono
 * @param {string} params.body          texto del mensaje
 * @param {boolean} [params.preferLink] si true, devuelve siempre wa.me (no
 *                                       intenta Cloud API)
 */
async function sendWhatsApp({ to, body, preferLink = false }) {
  // Modo manual / link: lo usamos cuando no hay Cloud API o el caller lo pide.
  if (preferLink || !isCloudApiConfigured()) {
    const link = buildWaMeLink(to, body);
    if (!link) {
      return { ok: false, code: "INVALID_PHONE", error_message: "Teléfono inválido." };
    }
    return {
      ok: true,
      provider: "wa_me",
      manual_link: link,
      // No estamos enviando: el frontend abre el link y el usuario hace click.
    };
  }

  // Cloud API real
  return sendViaCloudApi({ to, body });
}

module.exports = {
  sendWhatsApp,
  buildWaMeLink,
  normalizePhone,
  isCloudApiConfigured,
};
