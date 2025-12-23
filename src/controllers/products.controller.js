// src/controllers/products.controller.js
const { Op } = require("sequelize");
const { Product, Category, ProductImage, Branch } = require("../models");

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
    toInt(req?.ctx?.branch_id, 0) ||
    toInt(req?.branchId, 0) ||
    toInt(req?.branch?.id, 0) ||
    toInt(req?.user?.branch_id, 0) ||
    toInt(req?.user?.branchId, 0) ||
    0
  );
}

function getRoles(req) {
  const r = req?.user?.roles;
  if (Array.isArray(r)) return r;
  if (Array.isArray(req?.user?.Roles)) return req.user.Roles;
  return [];
}

function isAdminReq(req) {
  const roles = getRoles(req);
  return roles.includes("admin") || roles.includes("super_admin");
}

function productHasBranch() {
  return !!(Product?.rawAttributes && Object.prototype.hasOwnProperty.call(Product.rawAttributes, "branch_id"));
}

function buildProductIncludes({ includeBranch = false } = {}) {
  const inc = [];
  const A = Product?.associations || {};

  // category + parent
  const catAs = A.category ? "category" : A.Category ? "Category" : null;
  if (catAs) {
    const catInclude = { association: catAs, required: false };
    try {
      const CatModel = A[catAs]?.target || Category;
      const CA = CatModel?.associations || {};
      const parentAs = CA.parent ? "parent" : CA.Parent ? "Parent" : null;
      if (parentAs) catInclude.include = [{ association: parentAs, required: false }];
    } catch {
      // ignore
    }
    inc.push(catInclude);
  }

  // images
  const imgAs =
    A.images ? "images" :
    A.productImages ? "productImages" :
    A.ProductImages ? "ProductImages" :
    null;
  if (imgAs) inc.push({ association: imgAs, required: false });

  // ✅ branch (solo si existe y lo pedimos)
  if (includeBranch) {
    const brAs = A.branch ? "branch" : A.Branch ? "Branch" : null;
    if (brAs) inc.push({ association: brAs, required: false });
  }

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
    "branch_id", // ojo: lo vamos a borrar en update si no sos admin
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
  if (out.branch_id != null) out.branch_id = toInt(out.branch_id, null);

  const bools = ["is_new", "is_promo", "track_stock", "sheet_has_stock", "is_active"];
  for (const b of bools) if (out[b] != null) out[b] = !!out[b];

  const nums = ["warranty_months", "cost", "price", "price_list", "price_discount", "price_reseller", "tax_rate"];
  for (const n of nums) if (out[n] != null) out[n] = toFloat(out[n], 0);

  return out;
}

function requireAdmin(req, res) {
  if (!isAdminReq(req)) {
    res.status(403).json({ ok: false, code: "FORBIDDEN", message: "Solo admin puede realizar esta acción." });
    return false;
  }
  return true;
}

// ============================
// GET /api/v1/products
// - USER: ve SOLO su branch_id
// - ADMIN: ve TODO + branch incluido
// ============================
async function list(req, res, next) {
  try {
    const admin = isAdminReq(req);

    const branch_id = getBranchId(req);
    if (!admin && !branch_id) {
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

    const where = {};
    // ✅ clave: el NO admin queda filtrado por sucursal
    if (!admin && productHasBranch()) where.branch_id = branch_id;

    // opcional: filtro por sucursal para admin (?branch_id=2)
    const branchFilter = toInt(req.query.branch_id, 0);
    if (admin && branchFilter > 0 && productHasBranch()) where.branch_id = branchFilter;

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

    const include = buildProductIncludes({ includeBranch: admin });

    const { count, rows } = await Product.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
      include,
      distinct: true,
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
    const admin = isAdminReq(req);

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const include = buildProductIncludes({ includeBranch: admin });
    const p = await Product.findByPk(id, { include });
    if (!p) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    // ✅ Cross-branch SOLO para NO admin
    if (!admin && productHasBranch()) {
      const branch_id = getBranchId(req);
      if (!branch_id) {
        return res.status(400).json({
          ok: false,
          code: "BRANCH_REQUIRED",
          message: "No se pudo determinar la sucursal del usuario (branch_id).",
        });
      }
      const pb = toInt(p.branch_id, 0);
      if (pb > 0 && pb !== toInt(branch_id, 0)) {
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
    const admin = isAdminReq(req);

    const payload = pickBody(req.body || {});
    if (!payload.sku || !payload.name) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "sku y name son requeridos",
      });
    }

    // ✅ Si NO admin, forzamos branch_id del user
    if (productHasBranch()) {
      if (!admin) {
        const branch_id = getBranchId(req);
        if (!branch_id) {
          return res.status(400).json({
            ok: false,
            code: "BRANCH_REQUIRED",
            message: "No se pudo determinar la sucursal del usuario (branch_id).",
          });
        }
        payload.branch_id = branch_id;
      } else {
        // admin puede setear branch_id si lo manda; si no manda, queda null/lo que tengas
        if (payload.branch_id == null) payload.branch_id = null;
      }
    } else {
      delete payload.branch_id;
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
    const admin = isAdminReq(req);

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const p = await Product.findByPk(id);
    if (!p) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    if (!admin && productHasBranch()) {
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
    // ✅ no admin NO puede cambiar branch_id
    if (!admin) delete patch.branch_id;

    await p.update(patch);

    const include = buildProductIncludes({ includeBranch: admin });
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

    await p.destroy();
    return res.json({ ok: true, message: "Producto eliminado" });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, create, getOne, update, remove };
