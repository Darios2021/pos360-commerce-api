// src/services/shopPaymentsSettings.service.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Lee settings "payments" desde tu storage de settings.
// Ajustá el nombre de tabla/campos si difiere.

const { sequelize } = require("../models");

async function getPaymentsSettings() {
  // ✅ Ajustá si tu tabla/estructura es distinta:
  // Esperado: shop_settings(key, value_json) o (key, value) con JSON string.
  const [rows] = await sequelize.query(
    `
    SELECT \`value\` AS val
    FROM shop_settings
    WHERE \`key\` = 'payments'
    LIMIT 1
    `
  );

  const raw = rows?.[0]?.val ?? null;
  if (!raw) return {};

  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  return {};
}

module.exports = {
  getPaymentsSettings,
};
