// src/services/mercadopago.service.js
// ✅ COPY-PASTE FINAL COMPLETO (MercadoPago REAL por HTTP + errores reales + logs seguros)
//
// Objetivo:
// - createPreference(payload) -> POST /checkout/preferences
// - Token SIEMPRE en ENV: MERCADOPAGO_ACCESS_TOKEN
// - No loguea token
// - Devuelve mpErr con:
//   { statusCode, code, message, payload }
//
// Opcionales ENV:
// - MP_API_BASE              (default: https://api.mercadopago.com)
// - MP_TIMEOUT_MS            (default: 20000)
// - MP_IDEMPOTENCY_PREFIX    (default: POS360)
// - MP_DEBUG                 ("1" habilita logs extra SIN secretos)

const axios = require("axios");
const crypto = require("crypto");

function toStr(v) {
  return String(v ?? "").trim();
}
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function boolEnv(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").trim().toLowerCase());
}

const MP_API_BASE = toStr(process.env.MP_API_BASE || "https://api.mercadopago.com").replace(/\/+$/, "");
const MP_TIMEOUT_MS = toInt(process.env.MP_TIMEOUT_MS || "20000", 20000);
const MP_IDEMPOTENCY_PREFIX = toStr(process.env.MP_IDEMPOTENCY_PREFIX || "POS360");
const MP_DEBUG = boolEnv("MP_DEBUG");

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

function buildIdempotencyKey(prefix = MP_IDEMPOTENCY_PREFIX) {
  // Idempotency recomendado por MP para evitar duplicados ante reintentos.
  // (No es secreto.)
  const rnd = crypto.randomBytes(10).toString("hex");
  const ts = Date.now();
  return `${prefix}-${ts}-${rnd}`.slice(0, 64);
}

function mpError({ statusCode, code, message, payload }) {
  const err = new Error(message || "Mercado Pago error");
  err.statusCode = Number(statusCode || 502);
  err.code = code || "MP_ERROR";
  err.payload = payload || null;
  return err;
}

function getAccessToken() {
  const tok = toStr(process.env.MERCADOPAGO_ACCESS_TOKEN || "");
  if (!tok) {
    throw mpError({
      statusCode: 400,
      code: "MP_TOKEN_MISSING",
      message: "Falta MERCADOPAGO_ACCESS_TOKEN en el servidor.",
      payload: null,
    });
  }
  return tok;
}

// Cliente HTTP MP
const mpHttp = axios.create({
  baseURL: MP_API_BASE,
  timeout: MP_TIMEOUT_MS,
  // Importante: MP suele devolver JSON aún con errores 4xx
  validateStatus: () => true,
});

async function createPreference(prefPayload) {
  const token = getAccessToken();

  // No logueamos payload completo (pero sí metadata si MP_DEBUG)
  if (MP_DEBUG) {
    // log seguro: sin token, sin datos sensibles
    console.log("[MP] createPreference payload(meta) =", {
      external_reference: prefPayload?.external_reference,
      has_back_urls: !!prefPayload?.back_urls,
      has_notification_url: !!prefPayload?.notification_url,
      has_payer: !!prefPayload?.payer,
      items: Array.isArray(prefPayload?.items)
        ? prefPayload.items.map((x) => ({ id: x.id, q: x.quantity, u: x.unit_price }))
        : [],
      statement_descriptor: prefPayload?.statement_descriptor,
      purpose: prefPayload?.purpose,
    });
  }

  const idemKey = buildIdempotencyKey();

  let resp;
  try {
    resp = await mpHttp.post("/checkout/preferences", prefPayload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idemKey,
      },
    });
  } catch (e) {
    // Error de red/timeout
    throw mpError({
      statusCode: 502,
      code: "MP_NETWORK_ERROR",
      message: "No se pudo conectar con Mercado Pago (network/timeout).",
      payload: { message: e?.message || String(e) },
    });
  }

  const status = Number(resp?.status || 0);
  const data = resp?.data;

  // 2xx OK
  if (status >= 200 && status < 300) {
    return data;
  }

  // MP suele devolver:
  // { message, error, status, cause: [...] }
  const apiCode =
    toStr(data?.error) ||
    toStr(data?.code) ||
    toStr(data?.status) ||
    "MP_API_ERROR";

  const msg =
    toStr(data?.message) ||
    toStr(data?.error_description) ||
    "Mercado Pago rechazó la solicitud.";

  if (MP_DEBUG) {
    console.log("[MP] createPreference ERROR =", {
      status,
      apiCode,
      msg,
      data: data || null,
    });
  }

  throw mpError({
    statusCode: status || 502,
    code: apiCode,
    message: msg,
    payload: data || { status, message: msg, code: apiCode },
  });
}

module.exports = { createPreference };
