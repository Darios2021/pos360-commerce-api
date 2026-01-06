// src/services/admin.shopBranding.service.js
// ✅ COPY-PASTE FINAL (CommonJS)
// Admin Shop Branding (DB) - NO axios
const { sequelize } = require("../models");

function toStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}

module.exports = {
  async get() {
    const [rows] = await sequelize.query(`
      SELECT id, name, logo_url, favicon_url, updated_at
      FROM shop_branding
      WHERE id = 1
      LIMIT 1
    `);

    const r = rows?.[0] || null;

    if (!r) {
      return {
        id: 1,
        name: "San Juan Tecnología",
        logo_url: "",
        favicon_url: "",
        updated_at: new Date().toISOString(),
      };
    }

    return {
      id: Number(r.id || 1),
      name: r.name || "San Juan Tecnología",
      logo_url: r.logo_url || "",
      favicon_url: r.favicon_url || "",
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
    };
  },

  async update({ name, logo_url, favicon_url } = {}) {
    const nextName = toStr(name);
    const nextLogo = logo_url === undefined ? undefined : toStr(logo_url);
    const nextFav = favicon_url === undefined ? undefined : toStr(favicon_url);

    // upsert simple (id=1)
    await sequelize.query(
      `
      INSERT INTO shop_branding (id, name, logo_url, favicon_url, updated_at)
      VALUES (1, :name, :logo_url, :favicon_url, NOW())
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        logo_url = VALUES(logo_url),
        favicon_url = VALUES(favicon_url),
        updated_at = NOW()
      `,
      {
        replacements: {
          name: nextName || "San Juan Tecnología",
          logo_url: nextLogo ?? "",
          favicon_url: nextFav ?? "",
        },
      }
    );

    return await this.get();
  },
};
