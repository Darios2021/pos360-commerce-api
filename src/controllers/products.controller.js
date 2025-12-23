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

// ✅ roles
function getRoles(req) {
  if (Array.isArray(req?.user?.roles)) return req.user.roles;
  if (Array.isArray(req?.user?.role_names)) return req.user.role_names;
  return [];
}

function isAdminLike(req) {
  const roles = getRoles(req);
  return roles.includes("admin") || roles.includes("super_admin");
}

function requireAdmin(req, res) {
  if (!isAdminLike(req)) {
    res.status(403).json({ ok: false, code: "FORBIDDEN", message: "Solo admin puede realizar esta acción." });
    return false;
  }
  return true;
}

// ✅ arma includes sólo si la asociación existe en Product.associations
function buildProductIncludes({ includeBranch = false } = {}) {
  const inc = [];
  const A = Product?.associations || {};

  // category
  const catAs = A.category ? "category" : A.Category ? "Category" : null;
  if (catAs) {
    const catInclude = { association: catAs, required: false };

    // parent dentro de category
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

  // subcategory
  const subAs =
    A.subcategory ? "subcategory" :
    A.sub_category ? "sub_category" :
    A.Subcategory ? "Subcategory" :
    null;
  if (subAs) inc.push({ association: subAs, required: false });

  // images
  const imgAs =
    A.images ? "images" :
    A.productImages ? "productImages" :
    A.ProductImages ? "ProductImages" :
    null;
  if (imgAs) inc.push({ association: imgAs, required: false });

  // ✅ branch (para que admin vea en qué sucursal está cada producto)
  if (includeBranch && Branch) {
    const bAs =
      A.branch ? "branch" :
      A.Branch ? "Branch" :
      null;

    if (bAs) {
      inc.push({
        association: bAs,
        required: false,
        attributes: ["id", "code", "name"],
      });
    } else {
      // fallback por si no hay association, pero existe modelo Branch:
      // incluir por FK estándar branch_id -> Branch.id
      // (esto requiere que Product tenga branch_id y que Sequelize pueda resolver la relación vía model)
      // Si te da "Include unexpected", entonces te falta la asociación en models.
      if (productHasBranch()) {
        inc.push({
          model: Branch,
          as: "branch",
          required: false,
          attributes: ["id", "code", "name"],
        });
      }
    }
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
    "branch_id", // 👈 lo controlamos abajo (solo admin)
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

  if (out.branch_id != null) out.branch_id = toInt(out.branch_id, null);

  return out;
}

// ============================
// GET /api/v1/products
// ✅ USER normal: SOLO SU branch
// ✅ ADMIN: TODOS + incluye branch
// ============================
async function list(req, res, next) {
  try {
    const admin = isAdminLike(req);
    const branch_id = getBranchId(req);

    // user normal necesita branch sí o sí
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

    // ✅ filtro por sucursal solo para NO admin
    const where = admin ? {} : { branch_id };

    // opcional: only actives
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
// ✅ USER normal: solo su branch
// ✅ ADMIN: cualquiera
// ============================
async function getOne(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const admin = isAdminLike(req);
    const include = buildProductIncludes({ includeBranch: admin });

    const p = await Product.findByPk(id, { include });
    if (!p) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

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
// ✅ USER normal: crea en SU branch
// ✅ ADMIN: puede mandar branch_id (si no manda, usa su branch)
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

    const admin = isAdminLike(req);

    if (productHasBranch()) {
      const branch_id = getBranchId(req);

      if (admin) {
        // admin puede elegir branch_id, si no viene, usa su branch
        payload.branch_id = payload.branch_id || branch_id || null;
      } else {
        if (!branch_id) {
          return res.status(400).json({
            ok: false,
            code: "BRANCH_REQUIRED",
            message: "No se pudo determinar la sucursal del usuario (branch_id).",
          });
        }
        payload.branch_id = branch_id;
      }
    } else {
      // si no existe branch_id en Product, lo removemos para que no rompa
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
// ✅ USER normal: solo su branch + NO puede cambiar branch_id
// ✅ ADMIN: puede editar cualquiera y puede cambiar branch_id
// ============================
async function update(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const admin = isAdminLike(req);

    const p = await Product.findByPk(id);
    if (!p) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

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
          message: "No podés modificar un producto de otra sucursal.",
        });
      }
    }

    const patch = pickBody(req.body || {});

    // user normal NO cambia branch
    if (!admin) delete patch.branch_id;

    // si el modelo ni tiene branch_id, removemos siempre
    if (!productHasBranch()) delete patch.branch_id;

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
