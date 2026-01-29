// src/services/mercadopago.service.js
// ✅ COPY-PASTE FINAL COMPLETO (SIN axios - usa fetch nativo Node 18/20)
//
// Soporta TEST/PROD sin mezclar:
// - mode: payments.mp_mode (DB) o process.env.MP_MODE
// - tokens:
//    MERCADOPAGO_ACCESS_TOKEN_TEST=TEST-...
//    MERCADOPAGO_ACCESS_TOKEN_PROD=APP_USR-...
//
// Exporta:
// - createPreference(payload, { mode })
// - resolveMode(payments)
// - getAccessToken(mode)
// - isConfigured(mode)

function toStr(v) {
  return String(v ?? "").trim();
}
function lower(v) {
  return toStr(v).toLowerCase();
}

function normalizeMode(v) {
  const m = lower(v);
  if (m === "test" || m === "sandbox") return "test";
  if (m === "prod" || m === "production" || m === "live") return "prod";
  return "";
}

function resolveMode(payments) {
  const dbMode = normalizeMode(payments?.mp_mode);
  const envMode = normalizeMode(process.env.MP_MODE);
  return dbMode || envMode || "prod";
}

function getAccessToken(mode) {
  if (mode === "test") return toStr(process.env.MERCADOPAGO_ACCESS_TOKEN_TEST);
  if (mode === "prod") return toStr(process.env.MERCADOPAGO_ACCESS_TOKEN_PROD);

  // legacy fallback (por compat)
  return toStr(process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN);
}

function isConfigured(mode) {
  return !!getAccessToken(mode);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function createPreference(payload, opts = {}) {
  const mode = normalizeMode(opts?.mode) || normalizeMode(process.env.MP_MODE) || "prod";
  const token = getAccessToken(mode);

  if (!token) {
    const err = new Error(`Missing MercadoPago token for mode=${mode}`);
    err.code = "ENV_MISSING";
    err.env = mode === "test" ? "MERCADOPAGO_ACCESS_TOKEN_TEST" : "MERCADOPAGO_ACCESS_TOKEN_PROD";
    throw err;
  }

  const url = "https://api.mercadopago.com/checkout/preferences";

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload || {}),
  });

  const text = await resp.text();
  const data = safeJsonParse(text) ?? { raw: text };

  if (!resp.ok) {
    const err = new Error("MercadoPago API error");
    err.statusCode = resp.status;
    err.payload = data;
    err.code = "MP_API_ERROR";
    throw err;
  }

  return data;
}

module.exports = {
  createPreference,
  resolveMode,
  getAccessToken,
  isConfigured,
  normalizeMode,
};
