// src/controllers/admin.shopSettings.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
// Admin Shop Settings en DB (shop_settings)
// Rutas:
// GET /api/v1/admin/shop/settings/:key
// PUT /api/v1/admin/shop/settings/:key
//
// Keys esperadas: orders | shipping | pickup | payments | notify
//
// Guarda JSON en columna value_json (MySQL JSON)

const { sequelize } = require("../models");

const ALLOWED_KEYS = new Set(["orders", "shipping", "pickup", "payments", "notify"]);

function cleanKey(k) {
  const s = String(k || "").trim().toLowerCase();
  return s;
}

function safeJson(v) {
  // si viene string JSON, parsea; si viene objeto, ok; sino {}
  if (v && typeof v === "object") return v;
  if (typeof v === "string") {
    try {
      const o = JSON.parse(v);
      return o && typeof o === "object" ? o : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function ensureDefaultRow(key) {
  // si no existe, inserta un default vacío para no romper UI
  await sequelize.query(
    `
    INSERT INTO shop_settings (\`key\`, value_json, created_at)
    VALUES (:key, JSON_OBJECT(), CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE \`key\`=\`key\`
    `,
    { replacements: { key } }
  );
}

async function getSetting(req, res) {
  const key = cleanKey(req.params.key);
  if (!ALLOWED_KEYS.has(key)) {
    return res.status(400).json({ ok: false, message: "Key inválida.", allowed: Array.from(ALLOWED_KEYS) });
  }

  await ensureDefaultRow(key);

  const [rows] = await sequelize.query(
    `SELECT \`key\`, value_json, updated_at, created_at FROM shop_settings WHERE \`key\` = :key LIMIT 1`,
    { replacements: { key } }
  );

  const row = rows?.[0] || null;

  return res.json({
    ok: true,
    item: row
      ? {
          key: row.key,
          value: row.value_json || {},
          updated_at: row.updated_at || null,
          created_at: row.created_at || null,
        }
      : { key, value: {} },
  });
}

async function putSetting(req, res) {
  const key = cleanKey(req.params.key);
  if (!ALLOWED_KEYS.has(key)) {
    return res.status(400).json({ ok: false, message: "Key inválida.", allowed: Array.from(ALLOWED_KEYS) });
  }

  const value = safeJson(req.body?.value ?? req.body ?? {});
  await ensureDefaultRow(key);

  // (opcional) quién actualizó
  const updatedBy = req?.usuario?.id || req?.user?.id || req?.auth?.id || null;

  await sequelize.query(
    `
    UPDATE shop_settings
    SET value_json = :val,
        updated_by = :updated_by,
        updated_at = CURRENT_TIMESTAMP
    WHERE \`key\` = :key
    `,
    {
      replacements: {
        key,
        val: JSON.stringify(value),
        updated_by: updatedBy,
      },
    }
  );

  const [rows] = await sequelize.query(
    `SELECT \`key\`, value_json, updated_at, created_at FROM shop_settings WHERE \`key\` = :key LIMIT 1`,
    { replacements: { key } }
  );

  const row = rows?.[0] || null;

  return res.json({
    ok: true,
    item: row
      ? {
          key: row.key,
          value: row.value_json || {},
          updated_at: row.updated_at || null,
          created_at: row.created_at || null,
        }
      : { key, value },
  });
}

module.exports = { getSetting, putSetting };
