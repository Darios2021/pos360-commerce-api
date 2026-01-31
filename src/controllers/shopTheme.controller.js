// ✅ COPY-PASTE FINAL COMPLETO
// pos360-commerce-api/src/controllers/shopTheme.controller.js
const { sequelize } = require("../models");

function isHex(v) {
  const s = String(v || "").trim();
  return /^#?[0-9a-fA-F]{6}$/.test(s);
}
function normHex(v, fallback) {
  const s = String(v || "").trim();
  if (!isHex(s)) return fallback;
  return s.startsWith("#") ? s.toLowerCase() : `#${s.toLowerCase()}`;
}

async function getSetting(key) {
  const [rows] = await sequelize.query(
    `SELECT value_json FROM shop_settings WHERE \`key\`=:k LIMIT 1`,
    { replacements: { k: key } }
  );
  const row = rows?.[0];
  return row?.value_json || null;
}

async function upsertSetting(key, valueJson) {
  await sequelize.query(
    `
    INSERT INTO shop_settings(\`key\`, value_json)
    VALUES(:k, :v)
    ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)
    `,
    { replacements: { k: key, v: JSON.stringify(valueJson) } }
  );
}

exports.getPublicTheme = async (req, res) => {
  try {
    const v = (await getSetting("theme")) || {};
    const theme = {
      primary: normHex(v.primary, "#0e2134"),
      secondary: normHex(v.secondary, "#3483fa"),
    };
    return res.json({ ok: true, theme });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "No se pudo leer theme." });
  }
};

exports.getAdminTheme = async (req, res) => {
  try {
    const v = (await getSetting("theme")) || {};
    const theme = {
      primary: normHex(v.primary, "#0e2134"),
      secondary: normHex(v.secondary, "#3483fa"),
    };
    return res.json({ ok: true, theme });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "No se pudo leer theme." });
  }
};

exports.updateAdminTheme = async (req, res) => {
  try {
    const body = req.body || {};
    const next = {
      primary: normHex(body.primary, "#0e2134"),
      secondary: normHex(body.secondary, "#3483fa"),
    };

    await upsertSetting("theme", next);
    return res.json({ ok: true, theme: next });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "No se pudo guardar theme." });
  }
};
