// src/controllers/products.controller.js
// ✅ COPY-PASTE FINAL
// (admin detection robusto + validación de campos + FIX FK category/subcategory + errores claros)

const { Op, Sequelize } = require("sequelize");
const { Product, Category, Subcategory, ProductImage, sequelize } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toFloat(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}

function isNonEmptyStr(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isBoolLike(v) {
  return (
    typeof v === "boolean" ||
    v === 0 ||
    v === 1 ||
    v === "0" ||
    v === "1" ||
    String(v).toLowerCase() === "true" ||
    String(v).toLowerCase() === "false"
  );
}

function toBool(v, d = false) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return d;
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

// ✅ ULTRA ROBUSTO: roles string/array/obj + role directo
function isAdminReq(req) {
  const u = req?.user || {};

  if (u?.is_admin === true || u?.isAdmin === true || u?.admin === true) return true;

  if (typeof u?.role === "string") {
    const r = u.role.trim().toLowerCase();
    if (["admin", "super_admin", "superadmin", "root", "owner"].includes(r)) return true;
  }

  if (typeof u?.roles === "string") {
    const parts = u.roles
      .split(/[,\s|]+/g)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);

    if (parts.some((x) => ["admin", "super_admin", "superadmin", "root", "owner"].includes(x))) return true;
  }

  const rolesRaw = Array.isArray(u.roles) ? u.roles : [];
  const roleNames = [];

  for (const r of rolesRaw) {
    if (!r) continue;
    if (typeof r === "string") roleNames.push(r);
    else if (typeof r?.name === "string") roleNames.push(r.name);
    else if (typeof r?.role === "string") roleNames.push(r.role);
    else if (typeof r?.role?.name === "string") roleNames.push(r.role.name);
  }

  const norm = (s) => String(s || "").trim().toLowerCase();
  return roleNames.map(norm).some((x) => ["admin", "super_admin", "superadmin", "root", "owner"].includes(x));
}

function requireAdmin(req, res) {
  if (!isAdminReq(req)) {
    res.status(403).json({
      ok: false,
      code: "FORBIDDEN",
      message: "Solo admin puede realizar esta acción.",
    });
    return false;
  }
  return true;
}

/** Detecta FK constraint (MySQL/Sequelize) */
function isFkConstraintError(err) {
  const code = err?.original?.code || err?.parent?.code || err?.code;
  const errno = err?.original?.errno || err?.parent?.errno || err?.errno;

  if (code === "ER_ROW_IS_REFERENCED_2" || errno === 1451) return true;
  if (code === "ER_NO_REFERENCED_ROW_2" || errno === 1452) return true;
  if (err?.name === "SequelizeForeignKeyConstraintError") return true;

  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("foreign key constraint") ||
    msg.includes("a foreign key constraint fails") ||
    msg.includes("cannot add or update a child row") ||
    msg.includes("cannot delete") ||
    msg.includes("is still referenced")
  );
}

function buildProductIncludes({ includeBranch = false } = {}) {
  const inc = [];
  const A = Product?.associations || {};

  // Category + parent
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

  // Subcategory (si existe asociación)
  const subAs = A.subcategory ? "subcategory" : A.Subcategory ? "Subcategory" : null;
  if (subAs) inc.push({ association: subAs, required: false });

  // Images
  const imgAs = A.images ? "images" : A.productImages ? "productImages" : A.ProductImages ? "ProductImages" : null;
  if (imgAs) inc.push({ association: imgAs, required: false });

  // Branch (solo admin)
  if (includeBranch) {
    const brAs = A.branch ? "branch" : A.Branch ? "Branch" : null;
    if (brAs) {
      inc.push({
        association: brAs,
        required: false,
        attributes: ["id", "code", "name"],
      });
    }
  }

  return inc;
}

// ✅ Sanitiza FKs: si no existe category/subcategory -> NULL
async function sanitizeCategoryFKs(payload) {
  if (!payload) return payload;

  // category_id -> categories.id
  if (Object.prototype.hasOwnProperty.call(payload, "category_id")) {
    if (payload.category_id === "" || payload.category_id === undefined) payload.category_id = null;

    if (payload.category_id != null) {
      const id = toInt(payload.category_id, 0);
      if (!id) payload.category_id = null;
      else {
        const ok = await Category.findByPk(id, { attributes: ["id"] });
        if (!ok) payload.category_id = null;
      }
    }
  }

  // subcategory_id -> subcategories.id
  // IMPORTANTE: si tu tabla subcategories está vacía, esto evita FK: lo deja NULL.
  if (Object.prototype.hasOwnProperty.call(payload, "subcategory_id")) {
    if (payload.subcategory_id === "" || payload.subcategory_id === undefined) payload.subcategory_id = null;

    if (payload.subcategory_id != null) {
      const id = toInt(payload.subcategory_id, 0);
      if (!id) payload.subcategory_id = null;
      else {
        if (!Subcategory || typeof Subcategory.findByPk !== "function") {
          payload.subcategory_id = null;
        } else {
          const ok = await Subcategory.findByPk(id, { attributes: ["id"] });
          if (!ok) payload.subcategory_id = null;
        }
      }
    }
  }

  return payload;
}

// ---------------------------
// ✅ VALIDACIÓN DE CAMPOS
// ---------------------------
function validateProductPayload(payload, { isPatch = false } = {}) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });

  const checkPositiveInt = (field, v, { allowNull = true } = {}) => {
    if (v === undefined) return;
    if (v === null) {
      if (!allowNull) add(field, "No puede ser null.");
      return;
    }
    const n = toInt(v, NaN);
    if (!Number.isFinite(n) || n <= 0) add(field, "Debe ser un entero mayor a 0.");
  };

  const checkNumber = (field, v, { min = 0, allowNull = true } = {}) => {
    if (v === undefined) return;
    if (v === null) {
      if (!allowNull) add(field, "No puede ser null.");
      return;
    }
    const n = toFloat(v, NaN);
    if (!Number.isFinite(n)) add(field, "Debe ser un número válido.");
    else if (n < min) add(field, `Debe ser mayor o igual a ${min}.`);
  };

  const checkString = (field, v, { required = false, max = null } = {}) => {
    if (v === undefined) {
      if (required && !isPatch) add(field, "Es requerido.");
      return;
    }
    if (v === null) {
      if (required) add(field, "No puede ser null.");
      return;
    }
    if (!isNonEmptyStr(v)) {
      if (required) add(field, "Es requerido.");
      return;
    }
    if (max && String(v).trim().length > max) add(field, `Máximo ${max} caracteres.`);
  };

  const checkBool = (field, v) => {
    if (v === undefined) return;
    if (!isBoolLike(v)) add(field, "Debe ser boolean (true/false).");
  };

  // requeridos create
  checkString("sku", payload.sku, { required: true, max: 64 });
  checkString("name", payload.name, { required: true, max: 200 });

  // opcionales
  checkString("code", payload.code, { required: false, max: 64 });
  checkString("barcode", payload.barcode, { required: false, max: 64 });
  checkString("description", payload.description, { required: false });

  checkPositiveInt("category_id", payload.category_id, { allowNull: true });
  checkPositiveInt("subcategory_id", payload.subcategory_id, { allowNull: true });
  checkPositiveInt("branch_id", payload.branch_id, { allowNull: false });

  checkString("brand", payload.brand, { required: false, max: 120 });
  checkString("model", payload.model, { required: false, max: 120 });

  checkBool("is_new", payload.is_new);
  checkBool("is_promo", payload.is_promo);
  checkBool("is_active", payload.is_active);

  checkNumber("price_list", payload.price_list, { min: 0, allowNull: true });
  checkNumber("price_discount", payload.price_discount, { min: 0, allowNull: true });
  checkNumber("price_reseller", payload.price_reseller, { min: 0, allowNull: true });

  if (payload.price_list !== undefined && payload.price_discount !== undefined) {
    const pl = payload.price_list === null ? null : toFloat(payload.price_list, NaN);
    const pd = payload.price_discount === null ? null : toFloat(payload.price_discount, NaN);
    if (Number.isFinite(pl) && Number.isFinite(pd) && pd > pl) add("price_discount", "No puede ser mayor que price_list.");
  }

  return errors;
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
    "branch_id",
  ];

  for (const k of fields) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];

  if (out.sku != null) out.sku = String(out.sku).trim();
  if (out.barcode != null) out.barcode = String(out.barcode).trim() || null;
  if (out.code != null) out.code = String(out.code).trim() || null;
  if (out.name != null) out.name = String(out.name).trim();

  if (out.category_id != null) out.category_id = toInt(out.category_id, null);
  if (out.subcategory_id != null) out.subcategory_id = toInt(out.subcategory_id, null);
  if (out.branch_id != null) out.branch_id = toInt(out.branch_id, null);

  const bools = ["is_new", "is_promo", "track_stock", "sheet_has_stock", "is_active"];
  for (const b of bools) if (out[b] != null) out[b] = toBool(out[b], false);

  const nums = ["warranty_months", "cost", "price", "price_list", "price_discount", "price_reseller", "tax_rate"];
  for (const n of nums) if (out[n] != null) out[n] = toFloat(out[n], 0);

  return out;
}

function stockQtyLiteralByBranch(branchId = 0) {
  const bid = toInt(branchId, 0);

  if (bid > 0) {
    return Sequelize.literal(`(
      SELECT COALESCE(SUM(sb.qty), 0)
      FROM stock_balances sb
      JOIN warehouses w ON w.id = sb.warehouse_id
      WHERE sb.product_id = Product.id
        AND w.branch_id = ${bid}
    )`);
  }

  return Sequelize.literal(`(
    SELECT COALESCE(SUM(sb.qty), 0)
    FROM stock_balances sb
    WHERE sb.product_id = Product.id
  )`);
}

function existsStockInBranch(branchId) {
  const bid = toInt(branchId, 0);
  return Sequelize.literal(`EXISTS (
    SELECT 1
    FROM stock_balances sb
    JOIN warehouses w ON w.id = sb.warehouse_id
    WHERE sb.product_id = Product.id
      AND w.branch_id = ${bid}
      AND sb.qty > 0
  )`);
}

// =====================================
// GET /api/v1/products
// =====================================
async function list(req, res, next) {
  try {
    const admin = isAdminReq(req);

    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const q = String(req.query.q || "").trim();

    const ctxBranchId = getBranchId(req);
    if (!admin && !ctxBranchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const stockBranchId = admin
      ? toInt(req.query.branch_id || req.query.branchId || req.headers["x-branch-id"], 0)
      : ctxBranchId;

    const where = {};

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

    if (!admin) {
      where[Op.and] = where[Op.and] || [];
      where[Op.and].push(existsStockInBranch(ctxBranchId));
    }

    if (admin && stockBranchId) where.branch_id = stockBranchId;

    const include = buildProductIncludes({ includeBranch: admin });

    const { count, rows } = await Product.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
      include,
      distinct: true,
      attributes: {
        include: [[stockQtyLiteralByBranch(stockBranchId), "stock_qty"]],
      },
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

// =====================================
// GET /api/v1/products/:id
// =====================================
async function getOne(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, code: "VALIDATION", message: "ID inválido" });

    const admin = isAdminReq(req);
    const ctxBranchId = getBranchId(req);

    if (!admin && !ctxBranchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const stockBranchId = admin
      ? toInt(req.query.branch_id || req.query.branchId || req.headers["x-branch-id"], 0) || ctxBranchId || 0
      : ctxBranchId;

    const include = buildProductIncludes({ includeBranch: admin });

    const p = await Product.findOne({
      where: { id },
      include,
      attributes: { include: [[stockQtyLiteralByBranch(stockBranchId), "stock_qty"]] },
    });

    if (!p) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Producto no encontrado" });

    if (!admin) {
      const ok = await Product.findOne({
        where: { id, [Op.and]: [existsStockInBranch(ctxBranchId)] },
        attributes: ["id"],
      });

      if (!ok) {
        return res.status(403).json({
          ok: false,
          code: "NO_STOCK_IN_BRANCH",
          message: "No podés ver un producto sin stock en tu sucursal.",
        });
      }
    }

    return res.json({ ok: true, data: p });
  } catch (e) {
    next(e);
  }
}

// =====================================
// GET /api/v1/products/:id/stock?branch_id=
// =====================================
async function getStock(req, res, next) {
  try {
    const productId = toInt(req.params.id, 0);
    if (!productId) return res.status(400).json({ ok: false, code: "VALIDATION", message: "ID inválido" });

    const admin = isAdminReq(req);
    const ctxBranchId = getBranchId(req);

    const branchId = admin
      ? toInt(req.query.branch_id || req.query.branchId || req.headers["x-branch-id"], 0)
      : ctxBranchId;

    if (!branchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "branch_id requerido para calcular stock.",
      });
    }

    const [rows] = await sequelize.query(
      `
      SELECT COALESCE(SUM(sb.qty), 0) AS qty
      FROM stock_balances sb
      JOIN warehouses w ON w.id = sb.warehouse_id
      WHERE sb.product_id = :productId
        AND w.branch_id = :branchId
      `,
      { replacements: { productId, branchId } }
    );

    const qty = Number(rows?.[0]?.qty || 0);

    return res.json({ ok: true, data: { product_id: productId, branch_id: branchId, qty } });
  } catch (e) {
    next(e);
  }
}

// =====================================
// POST /api/v1/products
// =====================================
async function create(req, res, next) {
  try {
    const admin = isAdminReq(req);
    const ctxBranchId = getBranchId(req);

    const payload = pickBody(req.body || {});

    if (!admin) {
      if (!ctxBranchId) {
        return res.status(400).json({
          ok: false,
          code: "BRANCH_REQUIRED",
          message: "No se pudo determinar la sucursal del usuario (branch_id).",
        });
      }
      payload.branch_id = ctxBranchId;
    } else {
      if (!payload.branch_id) payload.branch_id = ctxBranchId || 1;
    }

    // ✅ FIX FKs (category/subcategory)
    await sanitizeCategoryFKs(payload);

    const errors = validateProductPayload(payload, { isPatch: false });
    if (errors.length) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "Hay errores de validación en el producto.",
        errors,
      });
    }

    const created = await Product.create(payload);
    return res.status(201).json({ ok: true, message: "Producto creado", data: created });
  } catch (e) {
    if (e?.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({
        ok: false,
        code: "DUPLICATE",
        message: "Ya existe un producto con ese SKU / Barcode / Code.",
        errors: (e.errors || []).map((x) => ({ field: x.path, message: x.message, value: x.value })),
      });
    }

    if (isFkConstraintError(e)) {
      return res.status(400).json({
        ok: false,
        code: "FK_CONSTRAINT",
        message: "Error de FK: category_id o subcategory_id inválido (no existe).",
        db: e?.parent?.sqlMessage || e?.original?.sqlMessage || e?.message,
      });
    }

    next(e);
  }
}

// =====================================
// PATCH /api/v1/products/:id
// =====================================
async function update(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, code: "VALIDATION", message: "ID inválido" });

    const admin = isAdminReq(req);

    const p = await Product.findByPk(id);
    if (!p) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Producto no encontrado" });

    const patch = pickBody(req.body || {});
    if (!admin) delete patch.branch_id;

    // ✅ FIX FKs (category/subcategory)
    await sanitizeCategoryFKs(patch);

    const errors = validateProductPayload(patch, { isPatch: true });
    if (errors.length) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "Hay errores de validación en el producto.",
        errors,
      });
    }

    await p.update(patch);

    const include = buildProductIncludes({ includeBranch: admin });

    const ctxBranchId = getBranchId(req);
    const stockBranchId = admin
      ? toInt(req.query.branch_id || req.query.branchId || req.headers["x-branch-id"], 0) || ctxBranchId || 0
      : ctxBranchId;

    const updated = await Product.findOne({
      where: { id },
      include,
      attributes: { include: [[stockQtyLiteralByBranch(stockBranchId), "stock_qty"]] },
    });

    return res.json({ ok: true, message: "Producto actualizado", data: updated });
  } catch (e) {
    if (e?.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({
        ok: false,
        code: "DUPLICATE",
        message: "Ya existe un producto con ese SKU / Barcode / Code.",
        errors: (e.errors || []).map((x) => ({ field: x.path, message: x.message, value: x.value })),
      });
    }

    if (isFkConstraintError(e)) {
      return res.status(400).json({
        ok: false,
        code: "FK_CONSTRAINT",
        message: "Error de FK: category_id o subcategory_id inválido (no existe).",
        db: e?.parent?.sqlMessage || e?.original?.sqlMessage || e?.message,
      });
    }

    next(e);
  }
}

// =====================================
// DELETE /api/v1/products/:id (solo admin)
// =====================================
async function remove(req, res, next) {
  try {
    if (!requireAdmin(req, res)) return;

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, code: "VALIDATION", message: "ID inválido" });

    const p = await Product.findByPk(id);
    if (!p) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Producto no encontrado" });

    try {
      if (sequelize && typeof sequelize.transaction === "function") {
        await sequelize.transaction(async (t) => {
          if (ProductImage?.destroy) await ProductImage.destroy({ where: { product_id: id }, transaction: t });
          await p.destroy({ transaction: t });
        });
      } else {
        if (ProductImage?.destroy) await ProductImage.destroy({ where: { product_id: id } });
        await p.destroy();
      }
    } catch (err) {
      if (isFkConstraintError(err)) {
        return res.status(200).json({
          ok: false,
          code: "FK_CONSTRAINT",
          message: "No se puede eliminar: el producto tiene referencias (ventas/stock/movimientos).",
        });
      }
      throw err;
    }

    return res.json({ ok: true, message: "Producto eliminado" });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, create, getOne, getStock, update, remove };
