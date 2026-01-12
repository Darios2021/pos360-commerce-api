// src/services/mercadopago.service.js
// ✅ COPY-PASTE FINAL COMPLETO (SIN AXIOS) - Node 20+
// - Usa fetch nativo
// - Errores claros
// - createPreference REDIRECT robusto
// - Sanitiza back_urls / notification_url (https only)
// - Evita "PolicyAgent UNAUTHORIZED" por URLs inválidas
//
// ENV recomendados:
//   SHOP_PUBLIC_URL=https://sanjuantecnologia.com
//   SHOP_MP_WEBHOOK_URL=https://TU_API/api/v1/ecom/mercadopago/webhook (opcional)
//   MP_INTEGRATOR_ID=... (opcional)

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
  return "";
}

function buildRedirectUrls() {
  const base = pickPublicShopUrl();
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
  return https; // si no es válida -> ""
}

async function readJsonSafe(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// =====================
// Fetch MP
// =====================
async function mpFetch(method, path, accessToken, data) {
  const token = String(accessToken || "").trim();
  if (!token) {
    const err = new Error("MercadoPago access token missing");
    err.code = "MP_TOKEN_MISSING";
    err.statusCode = 500;
    throw err;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  if (process.env.MP_INTEGRATOR_ID) {
    headers["x-integrator-id"] = String(process.env.MP_INTEGRATOR_ID).trim();
  }

  let res;
  try {
    res = await fetch(`${MP_API}${path}`, {
      method: String(method || "GET").toUpperCase(),
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });
  } catch (e) {
    const err = new Error(`MercadoPago network/unknown error: ${e?.message || e}`);
    err.code = "MP_NETWORK_ERROR";
    err.statusCode = 502;
    err.payload = { message: e?.message || String(e) };
    throw err;
  }

  const payload = await readJsonSafe(res);

  if (res.ok) return payload;

  const err = new Error(`MercadoPago API error (${res.status})`);
  err.code = "MP_API_ERROR";
  err.statusCode = res.status;
  err.payload = payload;
  throw err;
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
  const back = buildRedirectUrls();
  const webhook = buildWebhookUrl();

  // ✅ Esto evita policy por URL base vacía
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

    external_reference: orderId ? String(orderId) : undefined,

    metadata: cleanObj({
      ...(metadata || {}),
      order_id: orderId ? String(orderId) : undefined,
    }),

    statement_descriptor: statementDescriptor ? String(statementDescriptor).slice(0, 22) : undefined,
  };

  const ship = Number(shippingCost || 0);
  if (ship > 0) {
    pref.items.push({
      title: "Envío",
      quantity: 1,
      currency_id: "ARS",
      unit_price: ship,
    });
  }

  // limpieza final
  Object.keys(pref).forEach((k) => {
    if (pref[k] === undefined) delete pref[k];
  });

  const data = await mpFetch("POST", "/checkout/preferences", accessToken, pref);

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
