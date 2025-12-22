// src/controllers/products.controller.js
const { Op } = require("sequelize");
const { Product, Category, Subcategory, ProductImage } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toFloat(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}

function getBranchId(req) {
  return (
    toInt(req?.ctx?.branchId, 0) ||
    toInt(req?.branchId, 0) ||
    toInt(req?.branch?.id, 0) ||
    toInt(req?.user?.branch_id, 0) ||
    0
  );
}

function pickBody(body = {}) {
  // whitelist para evitar que te metan cualquier cosa
  const out = {};

  const fields = [
    "code",
    "sku",
    "barcode",
    "name",
    "description",
    "category_id",
    "subcategory_id",
    "is_new",
    "is_promo",
    "brand",
    "model",
    "warranty_months",
    "track_stock",
    "sheet_stock_label",
    "sheet_has_stock",
    "is_active",
    "cost",
    "price",
    "price_list",
    "price_discount",
    "price_reseller",
    "tax_rate",
  ];

  for (const k of fields) {
    if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  }

  // normalizaciones
  if (out.sku != null) out.sku = String(out.sku).trim();
  if (out.barcode != null) out.barcode = String(out.barcode).trim() || null;
  if (out.code != null) out.code = String(out.code).trim() || null;
  if (out.name != null) out.name = String(out.name).trim();

  if (out.category_id != null) out.category_id = toInt(out.category_id, null);
  if (out.subcategory_id != null) out.subcategory_id = toInt(out.subcategory_id, null);

  const bools = ["is_new", "is_promo", "track_stock", "sheet_has_stock", "is_active"];
  for (const b of bools) {
    if (out[b] != null) out[b] = !!out[b];
  }

  const nums = [
    "warranty_months",
    "cost",
    "price",
    "price_list",
    "price_discount",
    "price_reseller",
    "tax_rate",
  ];
  for (const n of nums) {
    if (out[n] != null) out[n] = toFloat(out[n], 0);
  }

  return out;
}

// ============================
// GET /api/v1/products
// ============================
async function list(req, res, next) {
  try {
    const branch_id = getBranchId(req);
    if (!branch_id) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const q = String(req.query.q || "").trim();

    const where = { branch_id };

    if (q) {
      const qNum = toFloat(q, NaN);

      where[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        { sku: { [Op.like]: `%${q}%` } },
        { barcode: { [Op.like]: `%${q}%` } },
        { code: { [Op.like]: `%${q}%` } },
        { brand: { [Op.like]: `%${q}%` } },
        { model: { [Op.like]: `%${q}%` } },
      ];

      if (Number.isFinite(qNum)) {
        where[Op.or].push({ id: toInt(qNum, 0) });
        where[Op.or].push({ price: qNum });
      }
    }

    const { count, rows } = await Product.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
      include: [
        {
          model: Category,
          as: "category",
          required: false,
          include: [{ model: Category, as: "parent", required: false }],
        },
        { model: Subcategory, as: "subcategory", required: false },
        { model: ProductImage, as: "images", required: false },
      ],
    });

    const pages = Math.max(1, Math.ceil(count / limit));

    return res.json({
      ok: true,
      data: rows,
      meta: { page, limit, total: count, pages },
    });
  } catch (e) {
    next(e);
  }
}

// ============================
// GET /api/v1/products/:id
// ============================
async function getOne(req, res, next) {
  try {
    const branch_id = getBranchId(req);
    if (!branch_id) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const p = await Product.findByPk(id, {
      include: [
        {
          model: Category,
          as: "category",
          required: false,
          include: [{ model: Category, as: "parent", required: false }],
        },
        { model: Subcategory, as: "subcategory", required: false },
        { model: ProductImage, as: "images", required: false },
      ],
    });

    if (!p) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    if (toInt(p.branch_id, 0) !== toInt(branch_id, 0)) {
      return res.status(403).json({
        ok: false,
        code: "CROSS_BRANCH_PRODUCT",
        message: "No podés ver un producto de otra sucursal.",
      });
    }

    return res.json({ ok: true, data: p });
  } catch (e) {
    next(e);
  }
}

// ============================
// POST /api/v1/products
// branch_id SIEMPRE desde ctx (no desde body)
// ============================
async function create(req, res, next) {
  try {
    const branch_id = getBranchId(req);
    if (!branch_id) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const payload = pickBody(req.body || {});
    if (!payload.sku || !payload.name) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "sku y name son requeridos",
      });
    }

    // enforce branch
    payload.branch_id = branch_id;

    const created = await Product.create(payload);
    return res.status(201).json({ ok: true, message: "Producto creado", data: created });
  } catch (e) {
    next(e);
  }
}

// ============================
// PATCH /api/v1/products/:id
// bloquea cross-branch + no permite cambiar branch_id
// ============================
async function update(req, res, next) {
  try {
    const branch_id = getBranchId(req);
    if (!branch_id) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const p = await Product.findByPk(id);
    if (!p) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    if (toInt(p.branch_id, 0) !== toInt(branch_id, 0)) {
      return res.status(403).json({
        ok: false,
        code: "CROSS_BRANCH_PRODUCT",
        message: "No podés modificar un producto de otra sucursal.",
      });
    }

    const patch = pickBody(req.body || {});
    delete patch.branch_id; // seguridad: no permitir cambiar sucursal

    await p.update(patch);

    const updated = await Product.findByPk(id, {
      include: [
        {
          model: Category,
          as: "category",
          required: false,
          include: [{ model: Category, as: "parent", required: false }],
        },
        { model: Subcategory, as: "subcategory", required: false },
        { model: ProductImage, as: "images", required: false },
      ],
    });

    return res.json({ ok: true, message: "Producto actualizado", data: updated });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  list,
  create,
  getOne,
  update,
};
