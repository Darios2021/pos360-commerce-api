// src/controllers/admin.emailPromoBlocks.controller.js
//
// CRUD de bloques promocionales reutilizables para el CRM email.
//
// FILOSOFÍA — el bloque SE DERIVA DEL PRODUCTO INTERNO:
//   - El admin elige uno o varios productos del catálogo del shop.
//   - El bloque solo guarda { product_id, overrides opcionales }.
//   - Los datos visuales (título, imagen, precios, URL) se hidratan al
//     renderizar desde la tabla `products` (live). Si el precio cambia, el
//     próximo envío refleja el precio nuevo automáticamente.
//   - Sólo los OVERRIDES guardados pisan los del producto: badge_text,
//     installments_text, cta_label, cta_color, badge_color, override_title.
//
// Endpoints:
//   GET    /api/v1/admin/email-promo-blocks
//   GET    /api/v1/admin/email-promo-blocks/:id
//   POST   /api/v1/admin/email-promo-blocks/bulk-from-products
//          { product_ids: [..], badge_text?, installments_text? }
//   PUT    /api/v1/admin/email-promo-blocks/:id          (solo overrides)
//   DELETE /api/v1/admin/email-promo-blocks/:id

const { Op, fn, col } = require("sequelize");

// Columnas extendidas (overrides) que se agregan idempotentemente. Para
// instalaciones que crearon la tabla antes del refactor "linkear-a-producto".
const EXTENDED_COLUMNS = [
  ["product_id",              "BIGINT UNSIGNED NULL"],
  ["override_title",          "VARCHAR(180) NULL"],
  ["override_subtitle",       "VARCHAR(255) NULL"],
  ["override_image_url",      "VARCHAR(512) NULL"],
  ["override_product_url",    "VARCHAR(512) NULL"],
  ["override_price_original", "VARCHAR(60) NULL"],
  ["override_price_final",    "VARCHAR(60) NULL"],
];

let _tableEnsured = false;
async function ensureTable() {
  if (_tableEnsured) return;
  try {
    const { EmailPromoBlock, sequelize } = require("../models");
    if (EmailPromoBlock?.sync) await EmailPromoBlock.sync({ alter: false });

    // Add columns idempotentemente para instalaciones existentes.
    for (const [colName, def] of EXTENDED_COLUMNS) {
      try {
        await sequelize.query(`ALTER TABLE email_promo_blocks ADD COLUMN ${colName} ${def}`);
      } catch (e) {
        const msg = String(e?.message || "");
        if (!/Duplicate column|errno: 1060/i.test(msg)) {
          console.warn(`[emailPromoBlocks] ensureColumn ${colName}:`, msg);
        }
      }
    }

    // El title legacy ahora puede ser NULL (bloques nuevos lo dejan vacío).
    try {
      await sequelize.query(`ALTER TABLE email_promo_blocks MODIFY COLUMN title VARCHAR(180) NULL`);
    } catch (_) {}
    try {
      await sequelize.query(`ALTER TABLE email_promo_blocks MODIFY COLUMN product_url VARCHAR(512) NULL`);
    } catch (_) {}

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

function fmtPrice(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return null;
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency", currency: "ARS", maximumFractionDigits: 0,
    }).format(num);
  } catch {
    return `$ ${num.toLocaleString("es-AR")}`;
  }
}

// Resuelve el dominio público del shop con fallbacks inteligentes para que
// los links del email/WhatsApp sean SIEMPRE absolutos (Gmail no acepta
// relativos: "/p/123" → te tira a "http:///p/123" y rompe).
//
// Orden de prioridad:
//   1) SHOP_PUBLIC_URL del entorno (preferido)
//   2) SHOP_BASE_URL (alias común)
//   3) PUBLIC_URL (alias genérico)
//   4) Dominio derivado del SMTP_FROM_EMAIL o SMTP_USER ("comercial@dominio.com" → "https://dominio.com")
//   5) Como último recurso, usamos APP_URL si está
function getShopPublicUrl() {
  const candidates = [
    process.env.SHOP_PUBLIC_URL,
    process.env.SHOP_BASE_URL,
    process.env.PUBLIC_URL,
    process.env.APP_URL,
  ];
  for (const v of candidates) {
    const u = String(v || "").trim();
    if (u && /^https?:\/\//i.test(u)) {
      return u.replace(/\/+$/, "");
    }
  }

  // Último fallback: derivar del email SMTP. Si la casilla es comercial@sanjuantecnologia.com,
  // asumimos que el shop público vive en https://sanjuantecnologia.com.
  const email = String(process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "").trim().toLowerCase();
  const domain = email.split("@")[1];
  if (domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return `https://${domain}`;
  }

  // Si llegamos acá, el deploy está mal configurado. Devolvemos null y el
  // caller decide si saltar el link o usar fallback.
  return null;
}

// La ruta real del shop frontend es `/shop/product/:id` (Vue Router).
// Si querés cambiarla a slugs en el futuro, actualizá la ruta en el frontend
// y este builder en consecuencia.
function buildProductUrl(product) {
  const id = product?.id;
  if (!id) return null;
  const base = getShopPublicUrl();
  if (base) return `${base}/shop/product/${id}`;
  // Si no podemos resolver dominio, devolvemos null para que el caller no
  // pinte un link roto. El layout va a esconder el CTA en ese caso.
  console.warn("[promo] buildProductUrl: no se pudo resolver dominio del shop. Configurá SHOP_PUBLIC_URL.");
  return null;
}

// Toma un row de `products` + su primera imagen y devuelve los campos
// visuales que necesita el bloque promocional. price_list (precio tachado)
// solo aparece si es mayor a price (descuento real).
async function loadProductForPromo(productId) {
  const { Product, ProductImage, sequelize } = require("../models");
  if (!Product) return null;

  const p = await Product.findByPk(productId);
  if (!p) return null;

  // Primera imagen del producto (solo URL, no necesitamos más).
  let imageUrl = null;
  try {
    const [rows] = await sequelize.query(
      `SELECT url FROM product_images WHERE product_id = ? ORDER BY id ASC LIMIT 1`,
      { replacements: [productId] }
    );
    imageUrl = rows?.[0]?.url || null;
  } catch (_) {}

  // Precios — el sistema usa varios campos según el modo del shop. Tomamos
  // el primero disponible con valor > 0:
  //   price_final = price > price_discount > price_list
  //   price_original = price_list (si es mayor al price_final, sino null)
  const numOr0 = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const candPrice    = numOr0(p.price);
  const candDiscount = numOr0(p.price_discount);
  const candList     = numOr0(p.price_list);

  // priceFinal = el más bajo entre los candidatos visibles, o el primero > 0.
  // En la práctica:
  //   - Si hay price_discount: ese es el final, price_list es el tachado.
  //   - Si no hay discount, price es el final.
  //   - Si solo hay price_list (productos solo de catálogo), ese es el final.
  let priceFinal = 0;
  let priceOriginal = 0;
  if (candDiscount > 0) {
    priceFinal = candDiscount;
    priceOriginal = candList || candPrice;
  } else if (candPrice > 0) {
    priceFinal = candPrice;
    priceOriginal = candList > candPrice ? candList : 0;
  } else if (candList > 0) {
    priceFinal = candList;
  }

  const priceFinalFmt = fmtPrice(priceFinal);
  const priceOriginalFmt = priceOriginal > priceFinal ? fmtPrice(priceOriginal) : null;

  // % de descuento si aplica
  let discountPct = null;
  if (priceOriginal > 0 && priceFinal > 0 && priceOriginal > priceFinal) {
    discountPct = Math.round(((priceOriginal - priceFinal) / priceOriginal) * 100);
  }

  return {
    id: p.id,
    title: p.name || `Producto #${p.id}`,
    subtitle: p.brand || p.model || null,
    image_url: imageUrl,
    product_url: buildProductUrl(p),
    price_final: priceFinalFmt,
    price_original: priceOriginalFmt,
    discount_pct: discountPct,
  };
}

// Acepta sólo URLs absolutas (http/https). Si viene relativa o vacía,
// devuelve null para que el caller use el fallback. Importante para email
// porque Gmail rompe con "/p/123" → "http:///p/123".
function asAbsoluteUrl(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return null;
}

// Hidrata un bloque promo combinando los datos del producto + los overrides
// guardados en el bloque. Lo usan tanto este controller (al listar) como
// messaging.controller (al enviar).
async function hydrateBlock(block) {
  const json = block.toJSON ? block.toJSON() : block;
  const out = { ...json };

  if (json.product_id) {
    const prod = await loadProductForPromo(json.product_id).catch(() => null);
    if (prod) {
      out.title = json.override_title || prod.title;
      out.subtitle = json.override_subtitle || prod.subtitle;
      out.image_url = asAbsoluteUrl(json.override_image_url) || prod.image_url;
      // El override_product_url solo se respeta si es absoluto; si no,
      // forzamos el armado desde el producto (siempre absoluto via buildProductUrl).
      out.product_url = asAbsoluteUrl(json.override_product_url) || prod.product_url;
      out.price_original = json.override_price_original || prod.price_original;
      out.price_final = json.override_price_final || prod.price_final;
      // Badge automático con % de descuento si el producto tiene oferta y el
      // admin no puso un texto custom.
      if (!json.badge_text && prod.discount_pct) {
        out.badge_text = `-${prod.discount_pct}%`;
      }
      out.product_snapshot = prod;
    }
  } else {
    // Bloque manual sin producto (legado).
    out.title = json.override_title || json.title;
    out.image_url = asAbsoluteUrl(json.override_image_url) || asAbsoluteUrl(json.image_url) || null;
    out.product_url = asAbsoluteUrl(json.override_product_url) || asAbsoluteUrl(json.product_url) || null;
    out.price_original = json.override_price_original || json.price_original;
    out.price_final = json.override_price_final || json.price_final;
  }

  // Defaults de CTA
  if (!out.cta_label) out.cta_label = "Comprar ahora";

  return out;
}

async function listBlocks(req, res, next) {
  try {
    await ensureTable();
    const { EmailPromoBlock } = require("../models");
    if (!EmailPromoBlock) return res.json({ ok: true, items: [] });

    const onlyActive = String(req.query?.active || "") === "1";
    const where = onlyActive ? { active: true } : {};

    const rows = await EmailPromoBlock.findAll({
      where,
      order: [["position", "ASC"], ["id", "DESC"]],
    });

    // Hidratar cada bloque con datos live del producto.
    const items = await Promise.all(rows.map((r) => hydrateBlock(r)));
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
    const hydrated = await hydrateBlock(item);
    return res.json({ ok: true, item: hydrated });
  } catch (e) { next(e); }
}

// Crea N bloques de una vez desde una selección de productos del catálogo.
// Body: { product_ids: [1,2,3], badge_text?, installments_text?, cta_label? }
async function bulkFromProducts(req, res, next) {
  try {
    await ensureTable();
    const { EmailPromoBlock, Product } = require("../models");
    if (!EmailPromoBlock || !Product) {
      return res.status(500).json({ ok: false, message: "Modelos requeridos no disponibles" });
    }

    const ids = Array.isArray(req.body?.product_ids)
      ? req.body.product_ids.map((x) => Number(x)).filter(Boolean)
      : [];
    if (!ids.length) {
      return res.status(400).json({
        ok: false, code: "PRODUCT_IDS_REQUIRED",
        message: "Tenés que seleccionar al menos un producto.",
      });
    }

    // Validar que los productos existen.
    const products = await Product.findAll({ where: { id: ids } });
    const foundIds = new Set(products.map((p) => p.id));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length) {
      return res.status(404).json({
        ok: false, code: "PRODUCTS_NOT_FOUND",
        message: `Productos no encontrados: ${missing.join(", ")}.`,
      });
    }

    // No duplicar: si ya existe un bloque con el mismo product_id activo, lo
    // mantenemos y no creamos otro (evita ruido al re-seleccionar el mismo).
    const existing = await EmailPromoBlock.findAll({
      where: { product_id: ids, active: true },
    });
    const existingByProductId = new Map(existing.map((b) => [b.product_id, b]));

    const sharedOverrides = {
      badge_text:        norm(req.body?.badge_text),
      installments_text: norm(req.body?.installments_text),
      cta_label:         norm(req.body?.cta_label),
    };

    const created = [];
    const reused = [];
    let pos = 0;
    for (const productId of ids) {
      if (existingByProductId.has(productId)) {
        reused.push(existingByProductId.get(productId));
        continue;
      }
      const product = products.find((p) => p.id === productId);
      const block = await EmailPromoBlock.create({
        // Nombre interno para el listado del admin.
        name: product?.name?.slice(0, 110) || `Producto #${productId}`,
        // Mantenemos title vacío → el render hidrata desde producto.
        // Sólo si vinieron overrides los seteamos.
        title: "",
        product_id: productId,
        product_url: buildProductUrl(product),
        ...sharedOverrides,
        active: true,
        position: pos++,
      });
      created.push(block);
    }

    invalidateLayoutCache();

    const all = [...created, ...reused];
    const items = await Promise.all(all.map((b) => hydrateBlock(b)));
    return res.json({
      ok: true,
      summary: {
        requested: ids.length,
        created: created.length,
        reused: reused.length,
      },
      items,
    });
  } catch (e) { next(e); }
}

// Solo permite editar overrides + flags. La data del producto NO se edita
// desde acá: si querés cambiar nombre/precio/imagen, lo hacés en el catálogo
// y se refleja automáticamente en el próximo envío.
async function updateBlock(req, res, next) {
  try {
    await ensureTable();
    const { EmailPromoBlock } = require("../models");
    const id = Number(req.params.id);
    const item = await EmailPromoBlock.findByPk(id);
    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const b = req.body || {};
    const updates = {};

    // Overrides opcionales (text/visual)
    if ("override_title"          in b) updates.override_title          = norm(b.override_title);
    if ("override_subtitle"       in b) updates.override_subtitle       = norm(b.override_subtitle);
    if ("override_image_url"      in b) updates.override_image_url      = norm(b.override_image_url);
    if ("override_product_url"    in b) updates.override_product_url    = norm(b.override_product_url);
    if ("override_price_original" in b) updates.override_price_original = norm(b.override_price_original);
    if ("override_price_final"    in b) updates.override_price_final    = norm(b.override_price_final);

    if ("badge_text"              in b) updates.badge_text              = norm(b.badge_text);
    if ("badge_color"             in b) updates.badge_color             = norm(b.badge_color);
    if ("installments_text"       in b) updates.installments_text       = norm(b.installments_text);
    if ("cta_label"               in b) updates.cta_label               = norm(b.cta_label);
    if ("cta_color"               in b) updates.cta_color               = norm(b.cta_color);

    // Flags / orden
    if ("active"   in b) updates.active   = !!b.active;
    if ("position" in b) updates.position = Number.isFinite(+b.position) ? +b.position : 0;
    if ("name"     in b) updates.name     = norm(b.name) || item.name;

    if (Object.keys(updates).length === 0) {
      const hydrated = await hydrateBlock(item);
      return res.json({ ok: true, item: hydrated });
    }

    await item.update({ ...updates, updated_at: new Date() });
    invalidateLayoutCache();

    const hydrated = await hydrateBlock(item);
    return res.json({ ok: true, item: hydrated });
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

module.exports = {
  listBlocks,
  getBlock,
  bulkFromProducts,
  updateBlock,
  deleteBlock,
  // Exportamos el helper para que messaging.controller hidrate al enviar.
  hydrateBlock,
};
