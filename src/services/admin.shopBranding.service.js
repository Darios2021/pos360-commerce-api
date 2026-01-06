// src/modules/shop/service/admin.shopBranding.api.js
import axios from "axios";

/**
 * Admin Shop Branding API
 * Endpoints:
 * - GET  /api/v1/admin/shop/branding
 * - PUT  /api/v1/admin/shop/branding
 * - POST /api/v1/admin/shop/branding/logo
 * - POST /api/v1/admin/shop/branding/favicon
 */

const rawBase = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

/**
 * VITE_API_BASE_URL puede venir como:
 * - https://dominio.com/api
 * - https://dominio.com/api/v1
 * Normalizamos para que SIEMPRE quede en .../api/v1
 */
function normalizeApiV1Base(b) {
  const s = String(b || "").replace(/\/+$/, "");
  if (!s) return "";

  // si termina en /api/v1 -> ok
  if (/\/api\/v1$/i.test(s)) return s;

  // si termina en /api -> agregar /v1
  if (/\/api$/i.test(s)) return `${s}/v1`;

  // si termina en /v1 pero no tiene /api (raro) -> ok
  if (/\/v1$/i.test(s)) return s;

  // si no termina en nada, asumimos que te pasaron host raíz y el api vive en /api/v1
  return `${s}/api/v1`;
}

const api = axios.create({
  baseURL: normalizeApiV1Base(rawBase),
  timeout: 15000,
});

// ===== Token helper =====
function loadAuthSafe() {
  try {
    const raw = localStorage.getItem("auth") || localStorage.getItem("pos360_auth") || "";
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function getAccessToken() {
  const s = loadAuthSafe();
  return (
    s?.access_token ||
    s?.accessToken ||
    s?.token ||
    s?.jwt ||
    s?.auth?.access_token ||
    s?.auth?.token ||
    ""
  );
}

api.interceptors.request.use((config) => {
  const t = getAccessToken();
  if (t) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${t}`;
  }
  return config;
});

function pickItem(data) {
  if (!data) return null;
  if (data.item) return data.item;
  if (data.data?.item) return data.data.item;
  if (data.ok && data.branding) return data.branding;
  return data;
}

function asError(e) {
  return e?.response?.data?.message || e?.response?.data?.error || e?.message || "Error inesperado";
}

// ===== calls =====
export async function getShopBranding() {
  try {
    const r = await api.get("/admin/shop/branding");
    return pickItem(r.data);
  } catch (e) {
    const err = new Error(asError(e));
    err.raw = e;
    throw err;
  }
}

export async function updateShopBranding(payload = {}) {
  try {
    const r = await api.put("/admin/shop/branding", payload);
    return pickItem(r.data);
  } catch (e) {
    const err = new Error(asError(e));
    err.raw = e;
    throw err;
  }
}

export async function uploadShopLogo(file) {
  try {
    const fd = new FormData();
    fd.append("file", file);

    const r = await api.post("/admin/shop/branding/logo", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    return pickItem(r.data);
  } catch (e) {
    const err = new Error(asError(e));
    err.raw = e;
    throw err;
  }
}

export async function uploadShopFavicon(file) {
  try {
    const fd = new FormData();
    fd.append("file", file);

    const r = await api.post("/admin/shop/branding/favicon", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    return pickItem(r.data);
  } catch (e) {
    const err = new Error(asError(e));
    err.raw = e;
    throw err;
  }
}
