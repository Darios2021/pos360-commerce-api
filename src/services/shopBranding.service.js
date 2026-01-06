// src/services/shopBranding.service.js
// ✅ COPY-PASTE FINAL
// Admin: lee/actualiza shop_branding (id=1) y sube logo/favicon al storage (MinIO)

const crypto = require("crypto");
const path = require("path");
const { sequelize } = require("../models");

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function toStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}

function safeName(v) {
  const s = toStr(v);
  return s || "San Juan Tecnología";
}

function extFromMime(mime = "", fallbackName = "") {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return ".png";
  if (m.includes("webp")) return ".webp";
  if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
  if (m.includes("svg")) return ".svg";
  if (m.includes("x-icon") || m.includes("ico")) return ".ico";

  const ext = path.extname(String(fallbackName || "").trim());
  return ext || "";
}

function rand8() {
  return crypto.randomBytes(8).toString("hex");
}

/**
 * ✅ Asegura row id=1
 */
async function ensureRow() {
  await sequelize.query(
    `
    INSERT INTO shop_branding (id, name, logo_url, favicon_url, updated_at)
    VALUES (1, 'San Juan Tecnología', NULL, NULL, :u)
    ON DUPLICATE KEY UPDATE updated_at = updated_at
    `,
    { replacements: { u: nowSql() } }
  );
}

async function getRow() {
  await ensureRow();
  const [rows] = await sequelize.query(
    `
    SELECT id, name, logo_url, favicon_url, updated_at
    FROM shop_branding
    WHERE id = 1
    LIMIT 1
    `
  );
  return rows?.[0] || null;
}

/**
 * ✅ ADAPTER para tu MinIO/storage.
 * Reemplazá esta función por lo que ya usás en productos.
 *
 * Debe devolver un string que se guarda en DB:
 * - ideal: path relativo "/uploads/...." o "shop/logo-....png"
 * - también sirve URL absoluta
 */
async function uploadToStorage({ buffer, mime, key }) {
  // ❌ PLACEHOLDER: REEMPLAZAR por tu uploader real (MinIO)
  // Ejemplo esperado:
  // const { url, path } = await Storage.upload({ buffer, mime, key });
  // return path || url || key;

  throw new Error("UPLOAD_ADAPTER_NOT_IMPLEMENTED");
}

async function updateName({ name }) {
  await ensureRow();
  const nm = safeName(name);
  await sequelize.query(
    `UPDATE shop_branding SET name = :name, updated_at = :u WHERE id = 1`,
    { replacements: { name: nm, u: nowSql() } }
  );
  return await getRow();
}

async function uploadAsset({ file, kind }) {
  // kind: "logo" | "favicon"
  if (!file) {
    const e = new Error("FILE_REQUIRED");
    e.status = 400;
    throw e;
  }

  await ensureRow();

  const ext = extFromMime(file.mimetype, file.originalname);
  const key = `shop/${kind}-${Date.now()}-${rand8()}${ext}`;

  const saved = await uploadToStorage({
    buffer: file.buffer,
    mime: file.mimetype,
    key,
  });

  if (!saved) throw new Error("UPLOAD_FAILED");

  const col = kind === "favicon" ? "favicon_url" : "logo_url";

  await sequelize.query(
    `UPDATE shop_branding SET ${col} = :v, updated_at = :u WHERE id = 1`,
    { replacements: { v: saved, u: nowSql() } }
  );

  return await getRow();
}

module.exports = {
  getBranding: getRow,
  updateBranding: updateName,
  uploadLogo(file) {
    return uploadAsset({ file, kind: "logo" });
  },
  uploadFavicon(file) {
    return uploadAsset({ file, kind: "favicon" });
  },
};
