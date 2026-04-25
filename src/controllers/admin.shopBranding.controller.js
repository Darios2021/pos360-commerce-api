// src/controllers/admin.shopBranding.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
// - CRUD branding en tabla shop_branding (id=1)
// - Upload logo/favicon/og-image -> S3 (MinIO) + guarda URL en DB

const { sequelize } = require("../models");
const { uploadShopAsset } = require("../services/admin.shopBranding.service");

// Invalidar cache de branding usado por el layout de emails (best-effort).
function invalidateEmailBrandingCache() {
  try {
    const layoutSvc = require("../services/messaging/emailLayout.service");
    layoutSvc.invalidateBrandingCache?.();
  } catch (_) { /* opcional: si el módulo no está cargado, ignorar */ }
}

// Columnas extendidas (location, contact, signature defaults, accent).
// Se agregan idempotentemente. Si la columna ya existe MySQL devuelve
// "Duplicate column name" — lo ignoramos.
const EXTENDED_COLUMNS = [
  ["address",          "VARCHAR(255) NULL"],
  ["maps_url",         "VARCHAR(512) NULL"],
  ["phone_display",    "VARCHAR(60) NULL"],
  ["whatsapp_display", "VARCHAR(60) NULL"],
  ["business_hours",   "VARCHAR(255) NULL"],
  ["tagline",          "VARCHAR(255) NULL"],
  ["accent_color",     "VARCHAR(20) NULL"],
  ["bg_color",         "VARCHAR(20) NULL"],
  ["footer_note",      "VARCHAR(512) NULL"],
];

let _extendedColumnsEnsured = false;
async function ensureExtendedColumns() {
  if (_extendedColumnsEnsured) return;
  for (const [col, def] of EXTENDED_COLUMNS) {
    try {
      await sequelize.query(`ALTER TABLE shop_branding ADD COLUMN ${col} ${def}`);
    } catch (e) {
      const msg = String(e?.message || "");
      // 1060 = Duplicate column name (ya existe → OK)
      if (!/Duplicate column|errno: 1060/i.test(msg)) {
        console.warn(`[shopBranding] ensureExtendedColumns ${col}:`, msg);
      }
    }
  }
  _extendedColumnsEnsured = true;
}

async function ensureRow() {
  await ensureExtendedColumns();
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

    // Construimos UPDATE dinámico con sólo los campos que el cliente envió
    // explícitamente. Los strings se trim'ean; los vacíos se guardan como NULL
    // para que el render de email omita esa sección.
    const SETTABLE = [
      "name", "address", "maps_url", "phone_display", "whatsapp_display",
      "business_hours", "tagline", "accent_color", "bg_color", "footer_note",
    ];

    const sets = [];
    const repl = [];
    for (const f of SETTABLE) {
      if (!Object.prototype.hasOwnProperty.call(req.body || {}, f)) continue;
      const raw = req.body[f];
      const val = raw === null || raw === undefined ? null : String(raw).trim();
      sets.push(`${f}=?`);
      repl.push(val === "" ? null : val);
    }

    if (sets.length === 0) {
      // No vino nada actualizable → respondemos el row actual.
      const [rows] = await sequelize.query(`SELECT * FROM shop_branding WHERE id=1 LIMIT 1`);
      return res.json({ ok: true, item: rows?.[0] || null });
    }

    sets.push("updated_at=NOW()");
    await sequelize.query(`UPDATE shop_branding SET ${sets.join(", ")} WHERE id=1`, {
      replacements: repl,
    });

    invalidateEmailBrandingCache();

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

// ════════════════════════════════════════════════════════════════
// ÍCONOS DE REDES SOCIALES (BrandingAsset)
// El admin puede subir un PNG por red social desde el panel. El email
// los usa como íconos del footer; si no hay PNG subido, cae a las
// iniciales coloreadas.
// ════════════════════════════════════════════════════════════════

const KNOWN_SOCIAL_KINDS = [
  "instagram", "facebook", "whatsapp",
  "twitter", "x", "tiktok", "youtube", "linkedin",
  "telegram", "spotify", "github", "email", "website",
];

let _brandingAssetsTableEnsured = false;
async function ensureBrandingAssetsTable() {
  if (_brandingAssetsTableEnsured) return;
  try {
    const { BrandingAsset } = require("../models");
    if (BrandingAsset?.sync) await BrandingAsset.sync({ alter: false });
    _brandingAssetsTableEnsured = true;
  } catch (e) {
    console.warn("[admin.shopBranding] ensureBrandingAssetsTable:", e?.message);
  }
}

function isValidSocialKind(k) {
  return KNOWN_SOCIAL_KINDS.includes(String(k || "").toLowerCase().trim());
}

// GET /admin/shop/branding/social-icons
async function listSocialIcons(req, res, next) {
  try {
    await ensureBrandingAssetsTable();
    const { BrandingAsset } = require("../models");
    if (!BrandingAsset) return res.json({ ok: true, items: [] });

    const rows = await BrandingAsset.findAll({
      where: { kind: KNOWN_SOCIAL_KINDS },
      order: [["kind", "ASC"]],
    });
    return res.json({
      ok: true,
      items: rows,
      // Para que el frontend pueda renderizar todos los slots aunque algunos
      // no estén configurados (placeholder vacío).
      known_kinds: KNOWN_SOCIAL_KINDS,
    });
  } catch (e) { next(e); }
}

// POST /admin/shop/branding/social-icons/:kind
async function uploadSocialIcon(req, res, next) {
  try {
    await ensureBrandingAssetsTable();
    const { BrandingAsset } = require("../models");
    if (!BrandingAsset) {
      return res.status(500).json({ ok: false, message: "Modelo BrandingAsset no disponible" });
    }

    const kind = String(req.params.kind || "").toLowerCase().trim();
    if (!isValidSocialKind(kind)) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_KIND",
        message: `kind inválido. Debe ser uno de: ${KNOWN_SOCIAL_KINDS.join(", ")}.`,
      });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ ok: false, code: "FILE_REQUIRED", message: "Falta el archivo (file)." });
    }

    // Validación básica de tipo de imagen.
    const mime = String(file.mimetype || "").toLowerCase();
    if (!/^image\/(png|jpeg|jpg|webp|svg\+xml)$/.test(mime)) {
      return res.status(400).json({
        ok: false,
        code: "BAD_FILE_TYPE",
        message: "El archivo debe ser una imagen (PNG, JPG, WebP o SVG).",
      });
    }

    // Subimos al S3 con un kind dedicado para estos íconos.
    // Usamos el mismo helper que el resto de assets del shop.
    const up = await uploadShopAsset({
      file,
      kind: `social-${kind}`, // S3 path: pos360/shop/social-instagram-<timestamp>.png
    });

    // Upsert en branding_assets.
    const existing = await BrandingAsset.findOne({ where: { kind } });
    if (existing) {
      await existing.update({ url: up.url, updated_at: new Date() });
    } else {
      await BrandingAsset.create({ kind, url: up.url, label: kind });
    }

    // Invalidar cache del email para que tome el ícono nuevo de inmediato.
    try {
      const layoutSvc = require("../services/messaging/emailLayout.service");
      layoutSvc.invalidateBrandingCache?.();
    } catch (_) {}

    const out = await BrandingAsset.findOne({ where: { kind } });
    return res.json({ ok: true, item: out });
  } catch (e) { next(e); }
}

// DELETE /admin/shop/branding/social-icons/:kind
async function deleteSocialIcon(req, res, next) {
  try {
    await ensureBrandingAssetsTable();
    const { BrandingAsset } = require("../models");
    if (!BrandingAsset) return res.json({ ok: true });

    const kind = String(req.params.kind || "").toLowerCase().trim();
    if (!isValidSocialKind(kind)) {
      return res.status(400).json({ ok: false, code: "INVALID_KIND" });
    }

    await BrandingAsset.destroy({ where: { kind } });

    // Invalidar cache del email.
    try {
      const layoutSvc = require("../services/messaging/emailLayout.service");
      layoutSvc.invalidateBrandingCache?.();
    } catch (_) {}

    return res.json({ ok: true, message: "Ícono eliminado. Vuelve al estilo por defecto." });
  } catch (e) { next(e); }
}

module.exports = {
  getBranding,
  updateBranding,
  uploadLogo,
  uploadFavicon,
  uploadOgImage,
  listSocialIcons,
  uploadSocialIcon,
  deleteSocialIcon,
};
