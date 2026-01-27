// src/services/mercadopago.service.js
// ✅ COPY-PASTE FINAL (SIN AXIOS) - Node 18+ usa fetch nativo
//
// - Evita crash por "Cannot find module 'axios'"
// - Maneja errores MP con payload claro
// - Exporta createPreference (alias) para compat con tu controller

function getAccessToken() {
  const tok = process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || "";
  return String(tok || "").trim();
}

function mpIsEnabled() {
  const token = getAccessToken();
  return !!token;
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

/**
 * Crea preferencia de pago (REDIRECT).
 * @param {Object} opts
 * @returns {Object} preference (incluye init_point / sandbox_init_point)
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
      id: it.id != null ? String(it.id) : undefined,
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

  // Limpieza de undefined (MP a veces rompe si mandás undefined)
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
  body.items = (body.items || []).map((x) => {
    const y = { ...x };
    Object.keys(y).forEach((k) => y[k] === undefined && delete y[k]);
    return y;
  });

  const preference = await mpFetch("/checkout/preferences", { method: "POST", body });
  return preference;
}

// ✅ Alias: tu controller usa createPreference
async function createPreference(opts = {}) {
  return createCheckoutPreference(opts);
}

module.exports = {
  mpIsEnabled,
  mpFetch,
  createCheckoutPreference,
  createPreference, // ✅ COMPAT
};
