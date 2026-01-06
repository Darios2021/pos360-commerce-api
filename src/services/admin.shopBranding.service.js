// src/services/admin.shopBranding.service.js
// ✅ COPY-PASTE FINAL (backend CommonJS)
// Branding admin: name, logo_url, favicon_url
// - Upload a MinIO/S3 (NO filesystem /uploads)
// - Guarda URL pública en DB

const { sequelize } = require("../models");
const { uploadBuffer } = require("./s3Upload.service");

function toStr(v, d = "") {
  const s = String(v ?? "").trim();
  return s.length ? s : d;
}

async function getRow() {
  const [rows] = await sequelize.query(`
    SELECT id, name, logo_url, favicon_url, updated_at
    FROM shop_branding
    WHERE id = 1
    LIMIT 1
  `);
  return rows?.[0] || null;
}

async function ensureRowExists() {
  await sequelize.query(`
    INSERT INTO shop_branding (id, name, logo_url, favicon_url, updated_at)
    VALUES (1, 'San Juan Tecnología', '', '', NOW())
    ON DUPLICATE KEY UPDATE id = id
  `);
}

module.exports = {
  async get() {
    const r = await getRow();
    if (!r) {
      return {
        name: "San Juan Tecnología",
        logo_url: "",
        favicon_url: "",
        updated_at: new Date().toISOString(),
      };
    }
    return {
      name: r.name || "San Juan Tecnología",
      logo_url: r.logo_url || "",
      favicon_url: r.favicon_url || "",
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
    };
  },

  async updateName({ name }) {
    await ensureRowExists();

    const nm = toStr(name, "San Juan Tecnología");

    await sequelize.query(
      `
      UPDATE shop_branding
      SET name = :name, updated_at = NOW()
      WHERE id = 1
      `,
      { replacements: { name: nm } }
    );

    return this.get();
  },

  async uploadLogo({ file }) {
    await ensureRowExists();
    if (!file?.buffer) throw new Error("FILE_REQUIRED");

    const up = await uploadBuffer({
      keyPrefix: "pos360/shop",
      buffer: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname,
    });

    await sequelize.query(
      `
      UPDATE shop_branding
      SET logo_url = :logo_url, updated_at = NOW()
      WHERE id = 1
      `,
      { replacements: { logo_url: up.url } }
    );

    return this.get();
  },

  async uploadFavicon({ file }) {
    await ensureRowExists();
    if (!file?.buffer) throw new Error("FILE_REQUIRED");

    const up = await uploadBuffer({
      keyPrefix: "pos360/shop",
      buffer: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname,
    });

    await sequelize.query(
      `
      UPDATE shop_branding
      SET favicon_url = :favicon_url, updated_at = NOW()
      WHERE id = 1
      `,
      { replacements: { favicon_url: up.url } }
    );

    return this.get();
  },
};
