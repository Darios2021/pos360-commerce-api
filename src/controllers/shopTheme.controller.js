// pos360-commerce-api/src/controllers/shopTheme.controller.js
// Tema de la marca del comercio: clave `theme` en shop_settings.
//
// Guardado: { primary, accent, dark, font_heading, heading_upper, font_body }.
// Lo que el comercio no cargó se guarda null: el servicio de videos necesita
// distinguir "no cargado" de "cargado igual al de fábrica".
//
// Lectura pública: primary y secondary salen SIEMPRE con valor (los leen la
// tienda, el shop nuxt y contenido); secondary = accent si está cargado.
// Los campos nuevos salen null si no se cargaron.
const { sequelize } = require("../models");
const TIPOGRAFIAS = require("../config/tipografiasMarca.json");

// Valores de fábrica. Solo primary y secondary se publican con default.
const FABRICA = {
  primary: "#0e2134",
  accent: "#3483fa",
  dark: "#0b1220",
  font_heading: "inter",
  heading_upper: false,
  font_body: "inter",
};

const IDS_TITULARES = new Set(TIPOGRAFIAS.filter((t) => t.roles.includes("titulares")).map((t) => t.id));
const IDS_TEXTO = new Set(TIPOGRAFIAS.filter((t) => t.roles.includes("texto")).map((t) => t.id));

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
  const v = row?.value_json || null;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
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

function invalidateEmailBrandingCache() {
  try {
    require("../services/messaging/emailLayout.service").invalidateBrandingCache?.();
  } catch (_) { /* opcional */ }
}

// Lo cargado, tal cual (null si no se cargó). Bases viejas: `secondary` es el acento.
function cargado(v) {
  const x = v || {};
  return {
    primary: normHex(x.primary, null),
    accent: normHex(x.accent, null) || normHex(x.secondary, null),
    dark: normHex(x.dark, null),
    font_heading: IDS_TITULARES.has(x.font_heading) ? x.font_heading : null,
    heading_upper: typeof x.heading_upper === "boolean" ? x.heading_upper : null,
    font_body: IDS_TEXTO.has(x.font_body) ? x.font_body : null,
  };
}

function publico(c) {
  return {
    primary: c.primary || FABRICA.primary,
    secondary: c.accent || FABRICA.accent,
    accent: c.accent,
    dark: c.dark,
    font_heading: c.font_heading,
    heading_upper: c.heading_upper,
    font_body: c.font_body,
  };
}

exports.getPublicTheme = async (req, res) => {
  try {
    const theme = publico(cargado(await getSetting("theme")));
    return res.json({ ok: true, theme });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "No se pudo leer theme." });
  }
};

// Admin: lo mismo que el público, más los valores de fábrica y cuáles de los
// campos están en su valor de fábrica porque el comercio no los cargó.
async function respuestaAdmin() {
  const c = cargado(await getSetting("theme"));
  const predeterminado = {};
  for (const k of Object.keys(FABRICA)) predeterminado[k] = c[k] === null;
  return { ok: true, theme: publico(c), defaults: { ...FABRICA }, predeterminado };
}

exports.getAdminTheme = async (req, res) => {
  try {
    return res.json(await respuestaAdmin());
  } catch (e) {
    return res.status(500).json({ ok: false, message: "No se pudo leer theme." });
  }
};

function errorValidacion(res, message) {
  return res.status(400).json({ ok: false, code: "VALIDATION", message });
}

exports.updateAdminTheme = async (req, res) => {
  try {
    const body = req.body || {};
    // Compatibilidad: si llega `secondary` y no `accent`, es el acento.
    const accentIn = Object.prototype.hasOwnProperty.call(body, "accent") ? body.accent : body.secondary;

    const vacio = (v) => v === null || v === undefined || v === "";
    const color = (v, nombre) => {
      if (vacio(v)) return { ok: true, v: null };
      if (!isHex(v)) return { ok: false, msg: `${nombre}: el color debe ser #rrggbb.` };
      return { ok: true, v: normHex(v, null) };
    };

    const primary = color(body.primary, "Principal");
    if (!primary.ok) return errorValidacion(res, primary.msg);
    const accent = color(accentIn, "Acento");
    if (!accent.ok) return errorValidacion(res, accent.msg);
    const dark = color(body.dark, "Fondo oscuro");
    if (!dark.ok) return errorValidacion(res, dark.msg);

    let font_heading = null;
    if (!vacio(body.font_heading)) {
      if (!IDS_TITULARES.has(body.font_heading)) return errorValidacion(res, "Tipografía de titulares desconocida.");
      font_heading = body.font_heading;
    }
    let font_body = null;
    if (!vacio(body.font_body)) {
      if (!IDS_TEXTO.has(body.font_body)) return errorValidacion(res, "Tipografía de texto desconocida.");
      font_body = body.font_body;
    }
    let heading_upper = null;
    if (!vacio(body.heading_upper)) {
      if (typeof body.heading_upper !== "boolean") return errorValidacion(res, "Titulares en mayúsculas debe ser sí o no.");
      heading_upper = body.heading_upper;
    }

    await upsertSetting("theme", {
      primary: primary.v,
      accent: accent.v,
      dark: dark.v,
      font_heading,
      heading_upper,
      font_body,
    });
    invalidateEmailBrandingCache();

    return res.json(await respuestaAdmin());
  } catch (e) {
    return res.status(500).json({ ok: false, message: "No se pudo guardar theme." });
  }
};
