const { Op } = require("sequelize");
const { Product, Category, ProductImage } = require("../models");

// --- HELPERS DE CONVERSIÓN ---
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toDec(v, d = 0) {
  if (v === null || v === undefined || v === "") return d;
  const s = String(v).replace(",", ".").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : d;
}

// --- HELPER DE ASOCIACIONES ---
function includeCategoryTree() {
  return [
    {
      model: Category,
      as: "category",
      attributes: ["id", "name", "parent_id"],
      required: false,
      include: [
        {
          model: Category,
          as: "parent",
          attributes: ["id", "name"],
          required: false,
        },
      ],
    },
    {
      model: ProductImage,
      as: "images", // ✅ Crucial para el carrusel en el detalle
      required: false,
    },
  ];
}

// --- MÉTODOS DEL CONTROLADOR ---

async function list(req, res, next) {
  try {
    const q = (req.query.q || "").trim();
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const where = {};
    if (q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        { sku: { [Op.like]: `%${q}%` } },
        { brand: { [Op.like]: `%${q}%` } },
        { model: { [Op.like]: `%${q}%` } },
      ];
    }

    const { rows, count } = await Product.findAndCountAll({
      where,
      include: includeCategoryTree(),
      order: [["id", "DESC"]],
      limit,
      offset,
    });

    res.json({ ok: true, page, limit, total: count, items: rows });
  } catch (e) {
    console.error("[LIST ERROR]", e);
    next(e);
  }
}

async function getOne(req, res, next) {
  try {
    console.log(`[GET] Consultando producto ID: ${req.params.id}`);
    const item = await Product.findByPk(req.params.id, { 
      include: includeCategoryTree() 
    });

    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });
    res.json({ ok: true, item });
  } catch (e) { 
    next(e); 
  }
}

async function create(req, res, next) {
  try {
    const b = req.body;
    console.log("[POST] Payload recibido:", b);

    const created = await Product.create({
      code: b.code || null,
      sku: b.sku,
      barcode: b.barcode || null,
      name: b.name,
      description: b.description || null,
      category_id: toInt(b.category_id, null),
      subcategory_id: toInt(b.subcategory_id, null),
      brand: b.brand || null,
      model: b.model || null,
      warranty_months: toInt(b.warranty_months, 0),
      is_new: b.is_new ? 1 : 0,
      is_promo: b.is_promo ? 1 : 0,
      track_stock: b.track_stock ? 1 : 0,
      is_active: b.is_active ? 1 : 0,
      cost: toDec(b.cost, 0),
      price: toDec(b.price, 0),
      price_list: toDec(b.price_list, 0),
      price_discount: toDec(b.price_discount, 0),
      price_reseller: toDec(b.price_reseller, 0),
      tax_rate: toDec(b.tax_rate, 21),
    });

    console.log(`[POST] Producto creado exitosamente: ${created.id}`);
    
    // Devolver el objeto completo con relaciones para que el Store se sincronice
    const item = await Product.findByPk(created.id, { include: includeCategoryTree() });
    res.status(201).json({ ok: true, item });
  } catch (e) { 
    console.error("[CREATE ERROR]", e);
    next(e); 
  }
}

async function update(req, res, next) {
  try {
    const id = req.params.id;
    const item = await Product.findByPk(id);
    if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const b = req.body;
    console.log(`[PATCH] Actualizando producto ${id} con:`, b);

    await item.update({
      code: b.code !== undefined ? b.code : item.code,
      sku: b.sku !== undefined ? b.sku : item.sku,
      barcode: b.barcode !== undefined ? b.barcode : item.barcode,
      name: b.name !== undefined ? b.name : item.name,
      description: b.description !== undefined ? b.description : item.description,
      category_id: b.category_id !== undefined ? toInt(b.category_id, null) : item.category_id,
      subcategory_id: b.subcategory_id !== undefined ? toInt(b.subcategory_id, null) : item.subcategory_id,
      brand: b.brand !== undefined ? b.brand : item.brand,
      model: b.model !== undefined ? b.model : item.model,
      warranty_months: b.warranty_months !== undefined ? toInt(b.warranty_months, 0) : item.warranty_months,
      is_new: b.is_new !== undefined ? (b.is_new ? 1 : 0) : item.is_new,
      is_promo: b.is_promo !== undefined ? (b.is_promo ? 1 : 0) : item.is_promo,
      track_stock: b.track_stock !== undefined ? (b.track_stock ? 1 : 0) : item.track_stock,
      is_active: b.is_active !== undefined ? (b.is_active ? 1 : 0) : item.is_active,
      cost: b.cost !== undefined ? toDec(b.cost, 0) : item.cost,
      price: b.price !== undefined ? toDec(b.price, 0) : item.price,
      price_list: b.price_list !== undefined ? toDec(b.price_list, 0) : item.price_list,
      price_discount: b.price_discount !== undefined ? toDec(b.price_discount, 0) : item.price_discount,
      price_reseller: b.price_reseller !== undefined ? toDec(b.price_reseller, 0) : item.price_reseller,
      tax_rate: b.tax_rate !== undefined ? toDec(b.tax_rate, 21) : item.tax_rate,
    });

    console.log(`[PATCH] Producto ${id} actualizado en DB. Refrescando relaciones...`);
    
    // Refrescar para traer imágenes y categorías actualizadas
    const full = await Product.findByPk(item.id, { include: includeCategoryTree() });
    res.json({ ok: true, item: full });
  } catch (e) { 
    console.error("[UPDATE ERROR]", e);
    next(e); 
  }
}

module.exports = { list, getOne, create, update };