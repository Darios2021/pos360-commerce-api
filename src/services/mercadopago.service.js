// src/services/mercadopago.service.js
// ✅ COPY-PASTE FINAL COMPLETO (SIN axios - usa fetch nativo Node 18/20)
// Crea preferencia en MercadoPago con token desde ENV:
// - MERCADOPAGO_ACCESS_TOKEN
//
// Exporta:
// - createPreference(payload)
//
// Nota:
// - NO loguea token
// - Devuelve objeto JSON de MP
// - Lanza error con { statusCode, payload } para que el controller lo maneje

function mustEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) {
    const err = new Error(`Missing env ${name}`);
    err.code = "ENV_MISSING";
    err.env = name;
    throw err;
  }
  return v;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function createPreference(payload) {
  const token = mustEnv("MERCADOPAGO_ACCESS_TOKEN");

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

module.exports = { createPreference };
