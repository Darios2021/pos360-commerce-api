// src/controllers/me.signature.controller.js
//
// Firma personal del usuario logueado para envíos del CRM email.
// Endpoints:
//   GET    /api/v1/me/signature           → devuelve firma o null
//   PUT    /api/v1/me/signature           → upsert (text fields)
//   POST   /api/v1/me/signature/photo     → multipart file → photo_url
//   DELETE /api/v1/me/signature/photo     → elimina photo_url

const { uploadShopAsset } = require("../services/admin.shopBranding.service");

let _tableEnsured = false;
async function ensureTable() {
  if (_tableEnsured) return;
  try {
    const { UserSignature } = require("../models");
    if (UserSignature?.sync) await UserSignature.sync({ alter: false });
    _tableEnsured = true;
  } catch (e) {
    console.warn("[me.signature] ensureTable:", e?.message);
  }
}

function userId(req) {
  return Number(req?.user?.id || req?.access?.user_id || 0) || null;
}

async function getSignature(req, res, next) {
  try {
    await ensureTable();
    const { UserSignature } = require("../models");
    if (!UserSignature) return res.json({ ok: true, item: null });

    const uid = userId(req);
    if (!uid) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

    const item = await UserSignature.findOne({ where: { user_id: uid } });
    return res.json({ ok: true, item: item || null });
  } catch (e) { next(e); }
}

async function upsertSignature(req, res, next) {
  try {
    await ensureTable();
    const { UserSignature } = require("../models");
    if (!UserSignature) {
      return res.status(500).json({ ok: false, message: "Modelo UserSignature no disponible" });
    }

    const uid = userId(req);
    if (!uid) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

    const norm = (v) => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      return s === "" ? null : s;
    };

    const payload = {
      display_name: norm(req.body?.display_name),
      role_title:   norm(req.body?.role_title),
      email:        norm(req.body?.email),
      phone:        norm(req.body?.phone),
      whatsapp:     norm(req.body?.whatsapp),
      tagline:      norm(req.body?.tagline),
      include_by_default:
        req.body?.include_by_default === undefined
          ? true
          : !!req.body.include_by_default,
    };

    const existing = await UserSignature.findOne({ where: { user_id: uid } });
    let item;
    if (existing) {
      await existing.update({ ...payload, updated_at: new Date() });
      item = existing;
    } else {
      item = await UserSignature.create({ user_id: uid, ...payload });
    }

    invalidateLayoutCache();
    return res.json({ ok: true, item });
  } catch (e) { next(e); }
}

async function uploadPhoto(req, res, next) {
  try {
    await ensureTable();
    const { UserSignature } = require("../models");
    const uid = userId(req);
    if (!uid) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

    const file = req.file;
    if (!file) {
      return res.status(400).json({ ok: false, code: "FILE_REQUIRED", message: "Falta el archivo (file)." });
    }

    const mime = String(file.mimetype || "").toLowerCase();
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(mime)) {
      return res.status(400).json({
        ok: false, code: "BAD_FILE_TYPE",
        message: "El archivo debe ser una imagen (PNG, JPG, WebP).",
      });
    }

    const up = await uploadShopAsset({ file, kind: `signature-u${uid}` });

    const existing = await UserSignature.findOne({ where: { user_id: uid } });
    let item;
    if (existing) {
      await existing.update({ photo_url: up.url, updated_at: new Date() });
      item = existing;
    } else {
      item = await UserSignature.create({ user_id: uid, photo_url: up.url });
    }

    invalidateLayoutCache();
    return res.json({ ok: true, item });
  } catch (e) { next(e); }
}

async function deletePhoto(req, res, next) {
  try {
    await ensureTable();
    const { UserSignature } = require("../models");
    const uid = userId(req);
    if (!uid) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

    const existing = await UserSignature.findOne({ where: { user_id: uid } });
    if (existing) {
      await existing.update({ photo_url: null, updated_at: new Date() });
    }
    invalidateLayoutCache();
    return res.json({ ok: true, item: existing || null });
  } catch (e) { next(e); }
}

function invalidateLayoutCache() {
  try {
    const layoutSvc = require("../services/messaging/emailLayout.service");
    layoutSvc.invalidateBrandingCache?.();
  } catch (_) {}
}

module.exports = {
  getSignature,
  upsertSignature,
  uploadPhoto,
  deletePhoto,
};
