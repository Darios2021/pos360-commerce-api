// src/controllers/admin.shopSettings.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
// Admin Shop Settings en DB (shop_settings)
// Rutas:
// GET /api/v1/admin/shop/settings/:key
// PUT /api/v1/admin/shop/settings/:key
//
// Keys esperadas: orders | shipping | pickup | payments | notify | fiscal
//
// Guarda JSON en columna value_json (MySQL JSON)
//
// ✅ FIX SAFE:
// - updated_by puede no existir => reintenta sin esa columna para no romper producción.

const { sequelize } = require("../models");

const ALLOWED_KEYS = new Set([
  "orders",
  "shipping",
  "pickup",
  "payments",
  "notify",
  "fiscal",
]);

function cleanKey(k) {
  return String(k || "").trim().toLowerCase();
}

function safeJson(v) {
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

function getDefaultValueByKey(key) {
  switch (key) {
    case "fiscal":
      return {
        enabled: false,
        environment: "testing",
        default_invoice_type: "B",
        allow_manual_paths: true,
      };
    default:
      return {};
  }
}

async function ensureDefaultRow(key) {
  const defaultValue = getDefaultValueByKey(key);

  await sequelize.query(
    `
    INSERT INTO shop_settings (\`key\`, value_json, created_at)
    VALUES (:key, CAST(:value_json AS JSON), CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE \`key\`=\`key\`
    `,
    {
      replacements: {
        key,
        value_json: JSON.stringify(defaultValue),
      },
    }
  );
}

async function getSetting(req, res) {
  const key = cleanKey(req.params.key);

  if (!ALLOWED_KEYS.has(key)) {
    return res.status(400).json({
      ok: false,
      message: "Key inválida.",
      allowed: Array.from(ALLOWED_KEYS),
    });
  }

  await ensureDefaultRow(key);

  const [rows] = await sequelize.query(
    `
    SELECT \`key\`, value_json, updated_at, created_at
    FROM shop_settings
    WHERE \`key\` = :key
    LIMIT 1
    `,
    { replacements: { key } }
  );

  const row = rows?.[0] || null;

  return res.json({
    ok: true,
    item: row
      ? {
          key: row.key,
          value: row.value_json || getDefaultValueByKey(key),
          updated_at: row.updated_at || null,
          created_at: row.created_at || null,
        }
      : { key, value: getDefaultValueByKey(key) },
  });
}

async function putSetting(req, res) {
  const key = cleanKey(req.params.key);

  if (!ALLOWED_KEYS.has(key)) {
    return res.status(400).json({
      ok: false,
      message: "Key inválida.",
      allowed: Array.from(ALLOWED_KEYS),
    });
  }

  const value = safeJson(req.body?.value ?? req.body ?? {});
  await ensureDefaultRow(key);

  const updatedBy = req?.usuario?.id || req?.user?.id || req?.auth?.id || null;

  try {
    await sequelize.query(
      `
      UPDATE shop_settings
      SET value_json = CAST(:val AS JSON),
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
  } catch (e) {
    const msg = String(e?.original?.sqlMessage || e?.message || "").toLowerCase();

    if (msg.includes("unknown column") && msg.includes("updated_by")) {
      await sequelize.query(
        `
        UPDATE shop_settings
        SET value_json = CAST(:val AS JSON),
            updated_at = CURRENT_TIMESTAMP
        WHERE \`key\` = :key
        `,
        {
          replacements: {
            key,
            val: JSON.stringify(value),
          },
        }
      );
    } else {
      throw e;
    }
  }

  const [rows] = await sequelize.query(
    `
    SELECT \`key\`, value_json, updated_at, created_at
    FROM shop_settings
    WHERE \`key\` = :key
    LIMIT 1
    `,
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