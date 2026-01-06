// src/services/admin.shopBranding.service.js
// ✅ COPY-PASTE FINAL
// Admin: leer/actualizar branding en shop_branding (id=1)

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
      id: r.id,
      name: r.name || "San Juan Tecnología",
      logo_url: r.logo_url || "",
      favicon_url: r.favicon_url || "",
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
    };
  },

  async update({ name, logo_url, favicon_url }) {
    const payload = {
      name: toStr(name),
      logo_url: toStr(logo_url),
      favicon_url: toStr(favicon_url),
    };

    const sets = [];
    const repl = {};

    // name: si viene vacío, no lo piso
    if (payload.name) {
      sets.push("name = :name");
      repl.name = payload.name;
    }

    // logo + favicon: pueden ser vacíos para borrar
    sets.push("logo_url = :logo_url");
    sets.push("favicon_url = :favicon_url");
    repl.logo_url = payload.logo_url;
    repl.favicon_url = payload.favicon_url;

    await sequelize.query(
      `
      UPDATE shop_branding
      SET ${sets.join(", ")}, updated_at = NOW()
      WHERE id = 1
      `,
      { replacements: repl }
    );

    return await this.get();
  },
};
