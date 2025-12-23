// src/controllers/products.controller.js
const { Op } = require("sequelize");
const { Product, Category, ProductImage } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toFloat(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}

/**
 * ✅ branchId viene del middleware branchContext (recomendado)
 * y hacemos fallback a user.branch_id (por si aún no está montado)
 */
function getBranchId(req) {
  return (
    toInt(req?.ctx?.branchId, 0) ||
    toInt(req?.ctx?.branch_id, 0) ||
    toInt(req?.branchId, 0) ||
    toInt(req?.branch?.id, 0) ||
    toInt(req?.user?.branch_id, 0) ||
    toInt(req?.user?.branchId, 0) ||
    0
  );
}

// ✅ detecta si Product tiene branch_id real en el modelo
function productHasBranch() {
  return !!(Product?.rawAttributes && Object.prototype.hasOwnProperty.call(Product.rawAttributes, "branch_id"));
}

// ✅ arma includes sólo si la asociación existe en Product.associations
function buildProductIncludes() {
  const inc = [];
  const A = Product?.associations || {};

  const catAs = A.category ? "category" : A.Category ? "Category" : null;
  if (catAs) {
    const catInclude = { association: catAs, required: false };

    try {
      const CatModel = A[catAs]?.target || Category;
      const CA = CatModel?.associations || {};
      const parentAs = CA.parent ? "parent" : CA.Parent ? "Parent" : null;
      if (parentAs) catInclude.include = [{ association: parentAs, required: false }];
    } catch {
      // no-op
    }

    inc.push(catInclude);
  }

  const subAs =
    A.subcategory ? "subcategory" :
    A.sub_category ? "sub_category" :
    A.Subcategory ? "Subcategory" :
    null;
  if (subAs) inc.push({ association: subAs, required: false });

  const imgAs =
    A.images ? "images" :
    A.productImages ? "productImages" :
    A.ProductImages ? "ProductImages" :
    null;

  if (imgAs) inc.push({ association: imgAs, required: false });

  return inc;
}

function pickBody(body = {}) {
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

  if (out.sku != null) out.sku = String(out.sku).trim();
  if (out.barcode != null) out.barcode = String(out.barcode).trim() || null;
  if (out.code != null) out.code = String(out.code).trim() || null;
  if (out.name != null) out.name = String(out.name).trim();

  if (out.category_id != null) out.category_id = toInt(out.category_id, null);
  if (out.subcategory_id != null) out.subcategory_id = toInt(out.subcategory_id, null);

  const bools = ["is_new", "is_promo", "track_stock", "sheet_has_stock", "is_active"];
  for (const b of bools) if (out[b] != null) out[b] = !!out[b];

  const nums = ["warranty_months", "cost", "price", "price_list", "price_discount", "price_reseller", "tax_rate"];
  for (const n of nums) if (out[n] != null) out[n] = toFloat(out[n], 0);

  return out;
}

function requireAdmin(req, res) {
  const roles = Array.isArray(req?.user?.roles) ? req.user.roles : [];
  if (!roles.includes("admin") && !roles.includes("super_admin")) {
    res.status(403).json({ ok: false, code: "FORBIDDEN", message: "Solo admin puede realizar esta acción." });
    return false;
  }
  return true;
}

// ============================
// GET /api/v1/products
// ✅ Catálogo GLOBAL (no filtra por products.branch_id)
// ============================
async function list(req, res, next) {
  try {
    // fuerza a que exista contexto (si querés, si no, podés removerlo)
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
    const where = {}; // ✅ sin branch_id

    // (opcional) mostrar solo activos:
    // where.is_active = 1;

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
      if (Number.isFinite(qNum)) where[Op.or].push({ id: toInt(qNum, 0) });
    }

    const include = buildProductIncludes();

    const { count, rows } = await Product.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
      include,
      distinct: true, // ✅ count correcto con includes
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
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const include = buildProductIncludes();
    const p = await Product.findByPk(id, { include });
    if (!p) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    // ✅ Cross-branch solo si existe branch_id real
    if (productHasBranch()) {
      const branch_id = getBranchId(req);
      const pb = toInt(p.branch_id, 0);
      if (pb > 0 && branch_id > 0 && pb !== toInt(branch_id, 0)) {
        return res.status(403).json({
          ok: false,
          code: "CROSS_BRANCH_PRODUCT",
          message: "No podés ver un producto de otra sucursal.",
        });
      }
    }

    return res.json({ ok: true, data: p });
  } catch (e) {
    next(e);
  }
}

// ============================
// POST /api/v1/products
// ============================
async function create(req, res, next) {
  try {
    const payload = pickBody(req.body || {});
    if (!payload.sku || !payload.name) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "sku y name son requeridos",
      });
    }

    // ✅ solo si existe branch_id en Product
    if (productHasBranch()) {
      const branch_id = getBranchId(req);
      if (!branch_id) {
        return res.status(400).json({
          ok: false,
          code: "BRANCH_REQUIRED",
          message: "No se pudo determinar la sucursal del usuario (branch_id).",
        });
      }
      payload.branch_id = branch_id;
    }

    const created = await Product.create(payload);
    return res.status(201).json({ ok: true, message: "Producto creado", data: created });
  } catch (e) {
    next(e);
  }
}

// ============================
// PATCH /api/v1/products/:id
// ============================
async function update(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const p = await Product.findByPk(id);
    if (!p) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    if (productHasBranch()) {
      const branch_id = getBranchId(req);
      const pb = toInt(p.branch_id, 0);
      if (pb > 0 && branch_id > 0 && pb !== toInt(branch_id, 0)) {
        return res.status(403).json({
          ok: false,
          code: "CROSS_BRANCH_PRODUCT",
          message: "No podés modificar un producto de otra sucursal.",
        });
      }
    }

    const patch = pickBody(req.body || {});
    delete patch.branch_id;

    await p.update(patch);

    const include = buildProductIncludes();
    const updated = await Product.findByPk(id, { include });

    return res.json({ ok: true, message: "Producto actualizado", data: updated });
  } catch (e) {
    next(e);
  }
}

// ============================
// DELETE /api/v1/products/:id  (solo admin)
// ============================
async function remove(req, res, next) {
  try {
    if (!requireAdmin(req, res)) return;

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const p = await Product.findByPk(id);
    if (!p) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    if (productHasBranch()) {
      const branch_id = getBranchId(req);
      const pb = toInt(p.branch_id, 0);
      if (pb > 0 && branch_id > 0 && pb !== toInt(branch_id, 0)) {
        return res.status(403).json({
          ok: false,
          code: "CROSS_BRANCH_PRODUCT",
          message: "No podés eliminar un producto de otra sucursal.",
        });
      }
    }

    await p.destroy();
    return res.json({ ok: true, message: "Producto eliminado" });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, create, getOne, update, remove };
