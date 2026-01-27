// src/services/mercadopago.service.js
// ✅ COPY-PASTE FINAL (SIN AXIOS) - Node 18+ usa fetch nativo
//
// - Usa token desde ENV y si no, desde settings payments.mp_access_token
// - Respeta mp_enabled del settings
// - Maneja errores MP con payload claro
// - Soporta modo REDIRECT (init_point / sandbox_init_point)

const { getPaymentsSettings } = require("./shopPaymentsSettings.service");

async function getAccessToken() {
  const envTok = String(process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim();
  if (envTok) return envTok;

  // fallback settings (guardado por backoffice)
  const p = await getPaymentsSettings();
  const dbTok = String(p?.mp_access_token || "").trim();
  return dbTok;
}

async function mpIsEnabled() {
  const p = await getPaymentsSettings();
  const enabledFlag = p?.mp_enabled === true || String(p?.mp_enabled || "").toLowerCase() === "true" || p?.mp_enabled === 1;

  if (!enabledFlag) return false;

  const token = await getAccessToken();
  return !!token;
}

async function buildMpHeaders() {
  const token = await getAccessToken();
  if (!token) return null;

  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function mpFetch(path, { method = "GET", body = null, params = null } = {}) {
  const headers = await buildMpHeaders();
  if (!headers) {
    const e = new Error("MercadoPago no configurado: falta token (ENV o settings payments.mp_access_token)");
    e.code = "MP_NOT_CONFIGURED";
    e.statusCode = 400;
    e.payload = { message: e.message };
    throw e;
  }

  const base = "https://api.mercadopago.com";
  const url = new URL(base + path);

  if (params && typeof params === "object") {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  let resp;
  try {
    resp = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    const e = new Error("No se pudo conectar con MercadoPago");
    e.code = "MP_NETWORK_ERROR";
    e.statusCode = 502;
    e.payload = { message: networkErr?.message || String(networkErr) };
    throw e;
  }

  let data = null;
  const text = await resp.text().catch(() => "");
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }

  if (!resp.ok) {
    const e = new Error(`MercadoPago API error (${resp.status})`);
    e.code = "MP_API_ERROR";
    e.statusCode = resp.status;
    e.payload = data || { message: "Error MercadoPago" };
    throw e;
  }

  return data;
}

/**
 * Crea preferencia de pago (REDIRECT).
 * @param {Object} opts
 * @returns {Object} { preference, redirect_url }
 */
async function createCheckoutPreference(opts = {}) {
  const {
    external_reference = null,
    payer = null,
    items = [],
    back_urls = null,
    notification_url = null,
    auto_return = "approved",
    statement_descriptor = null,
    expires = false,
    expiration_date_from = null,
    expiration_date_to = null,
    metadata = null,
  } = opts;

  if (!Array.isArray(items) || items.length === 0) {
    const e = new Error("MercadoPago: items vacío");
    e.code = "MP_BAD_REQUEST";
    e.statusCode = 400;
    e.payload = { message: e.message };
    throw e;
  }

  const body = {
    items: items.map((it) => ({
      title: String(it.title || it.name || "Producto"),
      quantity: Number(it.quantity || it.qty || 1),
      unit_price: Number(it.unit_price || it.price || 0),
      currency_id: it.currency_id || "ARS",
    })),
    external_reference: external_reference ? String(external_reference) : undefined,
    payer: payer || undefined,
    back_urls: back_urls || undefined,
    notification_url: notification_url || undefined,
    auto_return,
    statement_descriptor: statement_descriptor || undefined,
    expires,
    expiration_date_from: expiration_date_from || undefined,
    expiration_date_to: expiration_date_to || undefined,
    metadata: metadata || undefined,
  };

  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);

  const preference = await mpFetch("/checkout/preferences", { method: "POST", body });

  const redirect_url = preference?.init_point || preference?.sandbox_init_point || null;

  return { preference, redirect_url };
}

module.exports = {
  mpIsEnabled,
  mpFetch,
  createCheckoutPreference,
};
