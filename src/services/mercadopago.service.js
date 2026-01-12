// src/services/mercadopago.service.js
// ✅ Mercado Pago service (sin SDK, usa fetch nativo)
// Requiere env:
// - MERCADOPAGO_ACCESS_TOKEN
// Opcional:
// - MERCADOPAGO_BASE_URL (default https://api.mercadopago.com)

const MP_BASE_URL = (process.env.MERCADOPAGO_BASE_URL || "https://api.mercadopago.com").replace(/\/+$/, "");
const MP_TOKEN = String(process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim();

function assertToken() {
  if (!MP_TOKEN) {
    const err = new Error("Falta MERCADOPAGO_ACCESS_TOKEN en el entorno.");
    err.code = "MP_TOKEN_MISSING";
    throw err;
  }
}

async function mpFetch(path, { method = "GET", body = null } = {}) {
  assertToken();

  const url = `${MP_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;

  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${MP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : null,
  });

  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!resp.ok) {
    const err = new Error(`MercadoPago API error (${resp.status})`);
    err.code = "MP_API_ERROR";
    err.statusCode = resp.status;
    err.payload = json;
    throw err;
  }

  return json;
}

/**
 * Crea preferencia Mercado Pago
 * @param {Object} pref
 */
async function createPreference(pref) {
  return mpFetch("/checkout/preferences", { method: "POST", body: pref });
}

/**
 * Lee pago por ID
 */
async function getPayment(paymentId) {
  const id = String(paymentId || "").trim();
  if (!id) {
    const err = new Error("paymentId requerido");
    err.code = "MP_PAYMENT_ID_REQUIRED";
    throw err;
  }
  return mpFetch(`/v1/payments/${encodeURIComponent(id)}`, { method: "GET" });
}

/**
 * Lee merchant order por ID (opcional)
 */
async function getMerchantOrder(merchantOrderId) {
  const id = String(merchantOrderId || "").trim();
  if (!id) return null;
  return mpFetch(`/merchant_orders/${encodeURIComponent(id)}`, { method: "GET" });
}

module.exports = {
  createPreference,
  getPayment,
  getMerchantOrder,
};
