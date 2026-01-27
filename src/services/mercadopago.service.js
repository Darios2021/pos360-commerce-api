// src/services/mercadopago.service.js
// ✅ COPY-PASTE FINAL COMPLETO (Node 18+ fetch nativo)
// - Exporta createPreference (compat)
// - Manejo de errores con payload exacto
// - Payload "policy-safe": purpose, payer, marketplace_fee, etc.

function getAccessToken() {
  const tok = process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || "";
  return String(tok || "").trim();
}

function mpIsEnabled() {
  return !!getAccessToken();
}

function buildMpHeaders() {
  const token = getAccessToken();
  if (!token) return null;

  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function mpFetch(path, { method = "GET", body = null, params = null } = {}) {
  const headers = buildMpHeaders();
  if (!headers) {
    const e = new Error("MercadoPago no configurado: falta MERCADOPAGO_ACCESS_TOKEN / MP_ACCESS_TOKEN");
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

function clean(obj) {
  const out = { ...obj };
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

/**
 * Crea preferencia REDIRECT.
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
    purpose = "wallet_purchase", // ✅ ayuda PolicyAgent
  } = opts;

  if (!Array.isArray(items) || items.length === 0) {
    const e = new Error("MercadoPago: items vacío");
    e.code = "MP_BAD_REQUEST";
    e.statusCode = 400;
    e.payload = { message: e.message };
    throw e;
  }

  const body = clean({
    purpose, // ✅
    items: items.map((it) => ({
      id: it.id ? String(it.id) : undefined,
      title: String(it.title || it.name || "Producto"),
      quantity: Number(it.quantity || it.qty || 1),
      unit_price: Number(it.unit_price || it.price || 0),
      currency_id: it.currency_id || "ARS",
    })),
    external_reference: external_reference ? String(external_reference) : undefined,

    // ✅ payer ayuda a que no “flote” el checkout
    payer: payer || undefined,

    back_urls: back_urls || undefined,
    notification_url: notification_url || undefined,
    auto_return,

    statement_descriptor: statement_descriptor || undefined,

    expires,
    expiration_date_from: expiration_date_from || undefined,
    expiration_date_to: expiration_date_to || undefined,

    metadata: metadata || undefined,
  });

  const preference = await mpFetch("/checkout/preferences", { method: "POST", body });

  const redirect_url = preference?.init_point || preference?.sandbox_init_point || null;

  return { preference, redirect_url };
}

// ✅ Compat: controller usa createPreference()
async function createPreference(opts = {}) {
  const { preference, redirect_url } = await createCheckoutPreference(opts);
  preference.redirect_url = redirect_url || null;
  return preference;
}

module.exports = {
  mpIsEnabled,
  mpFetch,
  createCheckoutPreference,
  createPreference,
};
