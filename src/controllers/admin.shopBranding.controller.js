// src/controllers/admin.shopBranding.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
// - CRUD branding en tabla shop_branding (id=1)
// - Upload logo/favicon/og-image -> S3 (MinIO) + guarda URL en DB

const { sequelize } = require("../models");
const { uploadShopAsset } = require("../services/admin.shopBranding.service");

async function ensureRow() {
  // Mantener 1 sola fila (id=1)
  try {
    // Si existe og_image_url (nuevo)
    await sequelize.query(
      `INSERT INTO shop_branding (id, name, logo_url, favicon_url, og_image_url, updated_at)
       VALUES (1, 'San Juan Tecnología', NULL, NULL, NULL, NOW())
       ON DUPLICATE KEY UPDATE id=id`
    );
  } catch (e) {
    // Fallback si todavía NO existe la columna og_image_url
    await sequelize.query(
      `INSERT INTO shop_branding (id, name, logo_url, favicon_url, updated_at)
       VALUES (1, 'San Juan Tecnología', NULL, NULL, NOW())
       ON DUPLICATE KEY UPDATE id=id`
    );
  }
}

async function getBranding(req, res, next) {
  try {
    await ensureRow();
    const [rows] = await sequelize.query(`SELECT * FROM shop_branding WHERE id=1 LIMIT 1`);
    const item = rows?.[0] || null;
    return res.json({ ok: true, item });
  } catch (e) {
    return next(e);
  }
}

async function updateBranding(req, res, next) {
  try {
    await ensureRow();
    const name = String(req.body?.name || "").trim();

    if (!name) {
      return res
        .status(400)
        .json({ ok: false, code: "VALIDATION", message: "El nombre es obligatorio." });
    }

    await sequelize.query(`UPDATE shop_branding SET name=?, updated_at=NOW() WHERE id=1`, {
      replacements: [name],
    });

    const [rows] = await sequelize.query(`SELECT * FROM shop_branding WHERE id=1 LIMIT 1`);
    return res.json({ ok: true, item: rows?.[0] || null });
  } catch (e) {
    return next(e);
  }
}

async function uploadLogo(req, res, next) {
  try {
    await ensureRow();

    const file = req.file;
    if (!file)
      return res
        .status(400)
        .json({ ok: false, code: "FILE_REQUIRED", message: "Falta el archivo (file)." });

    const up = await uploadShopAsset({ file, kind: "logo" });

    await sequelize.query(`UPDATE shop_branding SET logo_url=?, updated_at=NOW() WHERE id=1`, {
      replacements: [up.url],
    });

    const [rows] = await sequelize.query(`SELECT * FROM shop_branding WHERE id=1 LIMIT 1`);
    return res.json({ ok: true, item: rows?.[0] || null });
  } catch (e) {
    return next(e);
  }
}

async function uploadFavicon(req, res, next) {
  try {
    await ensureRow();

    const file = req.file;
    if (!file)
      return res
        .status(400)
        .json({ ok: false, code: "FILE_REQUIRED", message: "Falta el archivo (file)." });

    const up = await uploadShopAsset({ file, kind: "favicon" });

    await sequelize.query(`UPDATE shop_branding SET favicon_url=?, updated_at=NOW() WHERE id=1`, {
      replacements: [up.url],
    });

    const [rows] = await sequelize.query(`SELECT * FROM shop_branding WHERE id=1 LIMIT 1`);
    return res.json({ ok: true, item: rows?.[0] || null });
  } catch (e) {
    return next(e);
  }
}

// ✅ NUEVO: OG default 1200x630 (para WhatsApp/Facebook)
async function uploadOgImage(req, res, next) {
  try {
    await ensureRow();

    const file = req.file;
    if (!file)
      return res
        .status(400)
        .json({ ok: false, code: "FILE_REQUIRED", message: "Falta el archivo (file)." });

    const up = await uploadShopAsset({ file, kind: "og-image" });

    await sequelize.query(`UPDATE shop_branding SET og_image_url=?, updated_at=NOW() WHERE id=1`, {
      replacements: [up.url],
    });

    const [rows] = await sequelize.query(`SELECT * FROM shop_branding WHERE id=1 LIMIT 1`);
    return res.json({ ok: true, item: rows?.[0] || null });
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  getBranding,
  updateBranding,
  uploadLogo,
  uploadFavicon,
  uploadOgImage, // ✅ export nuevo
};
