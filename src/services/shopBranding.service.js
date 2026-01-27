// src/services/shopBranding.service.js
// ✅ COPY-PASTE FINAL DEFINITIVO
// Admin: lee/actualiza shop_branding (id=1) y sube logo/favicon/og-image al storage (MinIO/S3)
// Usa helpers reales:
// - uploadBuffer()                 => subida genérica con keyPrefix
// - uploadOgDefaultJpg1200x630()   => OG 1200x630 JPG con key ESTABLE og-default.jpg

const { sequelize } = require("../models");
const { uploadBuffer, uploadOgDefaultJpg1200x630 } = require("./s3Upload.service");

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

/**
 * ✅ Asegura row id=1
 * Compatible con DB vieja (sin og_image_url) y DB nueva (con og_image_url)
 */
async function ensureRow() {
  const u = nowSql();

  try {
    // Si existe og_image_url
    await sequelize.query(
      `
      INSERT INTO shop_branding (id, name, logo_url, favicon_url, og_image_url, updated_at)
      VALUES (1, 'San Juan Tecnología', NULL, NULL, NULL, :u)
      ON DUPLICATE KEY UPDATE updated_at = updated_at
      `,
      { replacements: { u } }
    );
  } catch (_) {
    // Fallback si todavía NO existe la columna og_image_url
    await sequelize.query(
      `
      INSERT INTO shop_branding (id, name, logo_url, favicon_url, updated_at)
      VALUES (1, 'San Juan Tecnología', NULL, NULL, :u)
      ON DUPLICATE KEY UPDATE updated_at = updated_at
      `,
      { replacements: { u } }
    );
  }
}

async function getRow() {
  await ensureRow();

  // Selección compatible (si no existe og_image_url, no lo pedimos)
  try {
    const [rows] = await sequelize.query(
      `
      SELECT id, name, logo_url, favicon_url, og_image_url, updated_at
      FROM shop_branding
      WHERE id = 1
      LIMIT 1
      `
    );
    return rows?.[0] || null;
  } catch (_) {
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

/**
 * kind: "logo" | "favicon" | "og-image"
 */
async function uploadAsset({ file, kind }) {
  if (!file || !file.buffer) {
    const e = new Error("FILE_REQUIRED");
    e.status = 400;
    throw e;
  }

  await ensureRow();

  const keyPrefix = "pos360/shop";
  const k = String(kind || "").trim();

  let up = null;
  let col = "logo_url";
  let valueToStore = "";

  if (k === "og-image") {
    // ✅ OG real 1200x630 con key estable: pos360/shop/og-default.jpg
    up = await uploadOgDefaultJpg1200x630({ keyPrefix, buffer: file.buffer });
    col = "og_image_url";
    valueToStore = up.url;
  } else {
    // ✅ Logo/Favicon: sube buffer tal cual (con key timestamp)
    up = await uploadBuffer({
      keyPrefix,
      buffer: file.buffer,
      mimeType: file.mimetype || "application/octet-stream",
      filename: file.originalname || "file",
      cacheControl: "public, max-age=31536000, immutable",
    });

    col = k === "favicon" ? "favicon_url" : "logo_url";
    valueToStore = up.url;
  }

  // ✅ Update DB (compatible: si og_image_url no existe todavía, va a fallar => error claro)
  await sequelize.query(
    `UPDATE shop_branding SET ${col} = :v, updated_at = :u WHERE id = 1`,
    { replacements: { v: valueToStore, u: nowSql() } }
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

  // ✅ NUEVO
  uploadOgImage(file) {
    return uploadAsset({ file, kind: "og-image" });
  },
};
