// src/controllers/admin.emailPromoBlocks.controller.js
//
// CRUD de bloques promocionales reutilizables (estilo Oncity / Frávega).
// El admin arma una vez el bloque (imagen + título + precios + CTA + URL del
// producto) y lo reutiliza en N envíos / templates. El email layout los
// renderiza como cards con badge y precio destacado.
//
// Endpoints:
//   GET    /api/v1/admin/email-promo-blocks
//   GET    /api/v1/admin/email-promo-blocks/:id
//   POST   /api/v1/admin/email-promo-blocks
//   PUT    /api/v1/admin/email-promo-blocks/:id
//   DELETE /api/v1/admin/email-promo-blocks/:id
//   POST   /api/v1/admin/email-promo-blocks/:id/image   (multipart file)
//   POST   /api/v1/admin/email-promo-blocks/from-product/:productId
//          → autocompleta desde el catálogo interno

const { uploadShopAsset } = require("../services/admin.shopBranding.service");

let _tableEnsured = false;
async function ensureTable() {
  if (_tableEnsured) return;
  try {
    const { EmailPromoBlock } = require("../models");
    if (EmailPromoBlock?.sync) await EmailPromoBlock.sync({ alter: false });
    _tableEnsured = true;
  } catch (e) {
    console.warn("[emailPromoBlocks] ensureTable:", e?.message);
  }
}

function invalidateLayoutCache() {
  try {
    const layoutSvc = require("../services/messaging/emailLayout.service");
    layoutSvc.invalidateBrandingCache?.();
  } catch (_) {}
}

const norm = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

function parsePayload(body = {}) {
  return {
    name:              norm(body.name),
    title:             norm(body.title),
    subtitle:          norm(body.subtitle),
    image_url:         norm(body.image_url),
    product_url:       norm(body.product_url),
    price_original:    norm(body.price_original),
    price_final:       norm(body.price_final),
    installments_text: norm(body.installments_text),
    badge_text:        norm(body.badge_text),
    badge_color:       norm(body.badge_color),
    cta_label:         norm(body.cta_label),
    cta_color:         norm(body.cta_color),
    product_id:        body.product_id ? Number(body.product_id) : null,
    active:            body.active === undefined ? true : !!body.active,
    position:          Number.isFinite(+body.position) ? +body.position : 0,
  };
}

async function listBlocks(req, res, next) {
  try {
    await ensureTable();
    const { EmailPromoBlock } = require("../models");
    if (!EmailPromoBlock) return res.json({ ok: true, items: [] });

    const onlyActive = String(req.query?.active || "") === "1";
    const where = onlyActive ? { active: true } : {};

    const items = await EmailPromoBlock.findAll({
      where,
      order: [["position", "ASC"], ["id", "DESC"]],
    });
    return res.json({ ok: true, items });
  } catch (e) { next(e); }
}

async function getBlock(req, res, next) {
  try {
    await ensureTable();
    const { EmailPromoBlock } = require("../models");
    const id = Number(req.params.id);
    const item = await EmailPromoBlock.findByPk(id);
    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });
    return res.json({ ok: true, item });
  } catch (e) { next(e); }
}

async function createBlock(req, res, next) {
  try {
    await ensureTable();
    const { EmailPromoBlock } = require("../models");
    if (!EmailPromoBlock) {
      return res.status(500).json({ ok: false, message: "Modelo EmailPromoBlock no disponible" });
    }

    const payload = parsePayload(req.body);
    if (!payload.name) {
      return res.status(400).json({ ok: false, code: "VALIDATION", message: "El nombre es obligatorio." });
    }
    if (!payload.title) {
      return res.status(400).json({ ok: false, code: "VALIDATION", message: "El título es obligatorio." });
    }
    if (!payload.product_url) {
      return res.status(400).json({ ok: false, code: "VALIDATION", message: "La URL del producto es obligatoria." });
    }

    const item = await EmailPromoBlock.create(payload);
    invalidateLayoutCache();
    return res.json({ ok: true, item });
  } catch (e) { next(e); }
}

async function updateBlock(req, res, next) {
  try {
    await ensureTable();
    const { EmailPromoBlock } = require("../models");
    const id = Number(req.params.id);
    const item = await EmailPromoBlock.findByPk(id);
    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const payload = parsePayload({ ...item.toJSON(), ...req.body });
    await item.update({ ...payload, updated_at: new Date() });

    invalidateLayoutCache();
    return res.json({ ok: true, item });
  } catch (e) { next(e); }
}

async function deleteBlock(req, res, next) {
  try {
    await ensureTable();
    const { EmailPromoBlock } = require("../models");
    const id = Number(req.params.id);
    await EmailPromoBlock.destroy({ where: { id } });
    invalidateLayoutCache();
    return res.json({ ok: true });
  } catch (e) { next(e); }
}

async function uploadBlockImage(req, res, next) {
  try {
    await ensureTable();
    const { EmailPromoBlock } = require("../models");
    const id = Number(req.params.id);
    const item = await EmailPromoBlock.findByPk(id);
    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

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

    const up = await uploadShopAsset({ file, kind: `promo-${id}` });
    await item.update({ image_url: up.url, updated_at: new Date() });

    invalidateLayoutCache();
    return res.json({ ok: true, item });
  } catch (e) { next(e); }
}

// Autocompleta un bloque desde un producto interno del catálogo. No persiste,
// devuelve un payload listo para enviar al POST createBlock.
async function fromProduct(req, res, next) {
  try {
    const { Product, ProductImage } = require("../models");
    if (!Product) {
      return res.status(500).json({ ok: false, message: "Modelo Product no disponible" });
    }

    const productId = Number(req.params.productId);
    const includes = [];
    if (ProductImage) includes.push({ model: ProductImage, as: "images" });

    const p = await Product.findByPk(productId, { include: includes });
    if (!p) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const fmt = (n) => {
      const num = Number(n);
      if (!Number.isFinite(num) || num <= 0) return null;
      try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(num); }
      catch { return `$ ${num.toLocaleString("es-AR")}`; }
    };

    const image_url =
      p.image_url ||
      p.cover_url ||
      (Array.isArray(p.images) && p.images.length ? (p.images[0].url || p.images[0].image_url) : null);

    const slug = p.slug || p.id;
    const baseShopUrl = process.env.SHOP_PUBLIC_URL || "";
    const product_url = baseShopUrl
      ? `${String(baseShopUrl).replace(/\/+$/, "")}/p/${slug}`
      : `/p/${slug}`;

    const payload = {
      name: p.name || `Producto ${p.id}`,
      title: p.name || "",
      subtitle: p.short_description || null,
      image_url: image_url || null,
      product_url,
      price_original: p.price_old ? fmt(p.price_old) : null,
      price_final: fmt(p.price) || null,
      installments_text: null,
      badge_text: p.discount_pct ? `-${p.discount_pct}%` : null,
      badge_color: "#e53935",
      cta_label: "Comprar ahora",
      cta_color: null,
      product_id: p.id,
      active: true,
      position: 0,
    };

    return res.json({ ok: true, payload });
  } catch (e) { next(e); }
}

module.exports = {
  listBlocks,
  getBlock,
  createBlock,
  updateBlock,
  deleteBlock,
  uploadBlockImage,
  fromProduct,
};
