// src/services/mercadopago.service.js
// ✅ COPY-PASTE FINAL COMPLETO (ROBUSTO)
// - mpFetch con errores claros
// - createPreference REDIRECT robusto
// - ✅ Sanitiza back_urls / notification_url (https only)
// - ✅ Evita "PolicyAgent UNAUTHORIZED" por URLs inválidas
// - No depende del "Origin" del admin / localhost
//
// Requiere ENV recomendado:
//   SHOP_PUBLIC_URL=https://sanjuantecnologia.com
//   SHOP_MP_WEBHOOK_URL=https://pos360-commerce-api.cingulado.org/api/v1/ecom/mercadopago/webhook   (opcional)
//   MP_INTEGRATOR_ID=... (opcional)
//
// Nota: MP base api -> https://api.mercadopago.com

const axios = require("axios");

const MP_API = "https://api.mercadopago.com";

// =====================
// Utils
// =====================
function isHttpUrl(u) {
  if (!u) return false;
  try {
    const url = new URL(String(u));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function toHttpsUrl(u) {
  if (!u) return "";
  if (!isHttpUrl(u)) return "";
  try {
    const url = new URL(String(u));
    // fuerza https salvo localhost
    const isLocal =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".local");

    if (!isLocal) url.protocol = "https:";
    return url.toString();
  } catch {
    return "";
  }
}

function joinUrl(base, path) {
  const b = String(base || "").replace(/\/+$/, "");
  const p = String(path || "").replace(/^\/+/, "");
  return `${b}/${p}`;
}

function cleanObj(o) {
  const out = {};
  Object.keys(o || {}).forEach((k) => {
    const v = o[k];
    if (v === undefined || v === null || v === "") return;
    out[k] = v;
  });
  return out;
}

function pickPublicShopUrl() {
  const envUrl = String(process.env.SHOP_PUBLIC_URL || "").trim();
  if (envUrl && isHttpUrl(envUrl)) return envUrl.replace(/\/+$/, "");
  // fallback super básico (NO ideal) - si no seteás SHOP_PUBLIC_URL, MP puede bloquear por policy
  return "";
}

function buildRedirectUrls() {
  const base = pickPublicShopUrl();

  // ✅ Si no hay base válida, igual devolvemos vacío y lo logueamos arriba.
  const success = base ? joinUrl(base, "shop/checkout/success") : "";
  const pending = base ? joinUrl(base, "shop/checkout/pending") : "";
  const failure = base ? joinUrl(base, "shop/checkout/failure") : "";

  return {
    success: toHttpsUrl(success),
    pending: toHttpsUrl(pending),
    failure: toHttpsUrl(failure),
  };
}

function buildWebhookUrl() {
  const w = String(process.env.SHOP_MP_WEBHOOK_URL || "").trim();
  const https = toHttpsUrl(w);
  // si no es URL válida/https => no mandamos notification_url (evita PolicyAgent)
  return https;
}

// =====================
// Fetch
// =====================
async function mpFetch(method, path, accessToken, data) {
  const token = String(accessToken || "").trim();
  if (!token) {
    const err = new Error("MercadoPago access token missing");
    err.code = "MP_TOKEN_MISSING";
    err.statusCode = 500;
    throw err;
  }

  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    // opcional integrator id
    if (process.env.MP_INTEGRATOR_ID) {
      headers["x-integrator-id"] = String(process.env.MP_INTEGRATOR_ID).trim();
    }

    const r = await axios({
      method,
      url: `${MP_API}${path}`,
      headers,
      data,
      timeout: 20000,
      validateStatus: () => true,
    });

    if (r.status >= 200 && r.status < 300) return r.data;

    const e = new Error(`MercadoPago API error (${r.status})`);
    e.code = "MP_API_ERROR";
    e.statusCode = r.status;
    e.payload = r.data;
    throw e;
  } catch (err) {
    // si ya es nuestro error, lo dejamos igual
    if (err && (err.code === "MP_API_ERROR" || err.code === "MP_TOKEN_MISSING")) throw err;

    const e = new Error(`MercadoPago network/unknown error: ${err?.message || err}`);
    e.code = "MP_NETWORK_ERROR";
    e.statusCode = 502;
    e.payload = { message: err?.message || String(err) };
    throw e;
  }
}

// =====================
// Public API
// =====================
async function createPreference({
  accessToken,
  orderId,
  items = [],
  payer = null,
  shippingCost = 0,
  metadata = {},
  statementDescriptor = null,
} = {}) {
  // back_urls SIEMPRE desde SHOP_PUBLIC_URL (no desde Origin del admin)
  const back = buildRedirectUrls();
  const webhook = buildWebhookUrl();

  // Si no hay SHOP_PUBLIC_URL, MP puede tirar PolicyAgent => lo hacemos explícito
  if (!back.success || !back.pending || !back.failure) {
    const err = new Error(
      "SHOP_PUBLIC_URL inválido o ausente. Definí SHOP_PUBLIC_URL=https://tudominio para MercadoPago."
    );
    err.code = "MP_BAD_PUBLIC_URL";
    err.statusCode = 500;
    throw err;
  }

  const pref = {
    items: (items || [])
      .filter(Boolean)
      .map((it) => ({
        title: String(it.title || it.name || "Producto").slice(0, 256),
        quantity: Math.max(1, parseInt(it.quantity ?? it.qty ?? 1, 10) || 1),
        currency_id: String(it.currency_id || "ARS"),
        unit_price: Number(it.unit_price ?? it.price ?? 0) || 0,
      })),

    // ✅ payer opcional, pero si viene lo normalizamos
    payer: payer
      ? cleanObj({
          name: payer.name ? String(payer.name).slice(0, 128) : undefined,
          surname: payer.surname ? String(payer.surname).slice(0, 128) : undefined,
          email: payer.email ? String(payer.email).slice(0, 128) : undefined,
        })
      : undefined,

    back_urls: {
      success: back.success,
      pending: back.pending,
      failure: back.failure,
    },

    auto_return: "approved",

    // ✅ Evitamos policy si webhook no es https válido
    notification_url: webhook || undefined,

    // referencias útiles
    external_reference: orderId ? String(orderId) : undefined,
    metadata: cleanObj({
      ...(metadata || {}),
      order_id: orderId ? String(orderId) : undefined,
    }),

    // opcional
    statement_descriptor: statementDescriptor ? String(statementDescriptor).slice(0, 22) : undefined,
  };

  // ✅ si querés sumar shipping como ítem aparte:
  const ship = Number(shippingCost || 0);
  if (ship > 0) {
    pref.items.push({
      title: "Envío",
      quantity: 1,
      currency_id: "ARS",
      unit_price: ship,
    });
  }

  // limpieza final (MP no quiere nulls)
  Object.keys(pref).forEach((k) => {
    if (pref[k] === undefined) delete pref[k];
  });

  const data = await mpFetch("post", "/checkout/preferences", accessToken, pref);

  // MP devuelve: init_point / sandbox_init_point / id
  return {
    id: data?.id || null,
    init_point: data?.init_point || null,
    sandbox_init_point: data?.sandbox_init_point || null,
    raw: data,
  };
}

module.exports = {
  mpFetch,
  createPreference,
};
