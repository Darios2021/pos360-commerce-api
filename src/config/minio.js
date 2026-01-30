// src/config/minio.js
// ✅ COPY-PASTE FINAL
const Minio = require("minio");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toBool(v, d = false) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return d;
}
function toStr(v, d = "") {
  const s = String(v ?? "").trim();
  return s ? s : d;
}

const MINIO_ENDPOINT = toStr(process.env.MINIO_ENDPOINT, "localhost");
const MINIO_PORT = toInt(process.env.MINIO_PORT, 9000);
const MINIO_USE_SSL = toBool(process.env.MINIO_USE_SSL, false);

const MINIO_ACCESS_KEY = toStr(process.env.MINIO_ACCESS_KEY, "");
const MINIO_SECRET_KEY = toStr(process.env.MINIO_SECRET_KEY, "");

const MINIO_BUCKET = toStr(process.env.MINIO_BUCKET, "pos360");
const MINIO_PUBLIC_BASE_URL = toStr(process.env.MINIO_PUBLIC_BASE_URL, "");

if (!MINIO_ACCESS_KEY || !MINIO_SECRET_KEY) {
  console.warn("[MINIO] ⚠️ Falta MINIO_ACCESS_KEY / MINIO_SECRET_KEY (revisar env)");
}

const minioClient = new Minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

async function ensureBucket(bucketName = MINIO_BUCKET) {
  const b = toStr(bucketName, MINIO_BUCKET);
  const exists = await minioClient.bucketExists(b).catch(() => false);
  if (!exists) {
    await minioClient.makeBucket(b, "us-east-1");
    console.log(`[MINIO] ✅ Bucket creado: ${b}`);
  }
  return b;
}

function buildPublicUrl(objectKey) {
  const key = toStr(objectKey, "");
  if (!key) return "";
  if (!MINIO_PUBLIC_BASE_URL) return "";
  return `${MINIO_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${encodeURI(key)}`;
}

module.exports = {
  minioClient,
  MINIO_BUCKET,
  bucket: MINIO_BUCKET, // alias común
  MINIO_PUBLIC_BASE_URL,
  ensureBucket,
  buildPublicUrl,
};
