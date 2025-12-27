// src/controllers/products.controller.js
const { Op, Sequelize } = require("sequelize");
const { Product, Category, ProductImage, sequelize } = require("../models");

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

// ✅ robusto: roles como strings u objetos {name:"admin"} / {role:"admin"} / {role:{name:"admin"}}
function isAdminReq(req) {
  const u = req?.user || {};
  if (u?.is_admin === true || u?.isAdmin === true || u?.admin === true) return true;

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
  return roleNames.map(norm).some((x) =>
    ["admin", "super_admin", "superadmin", "root", "owner"].includes(x)
  );
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
  if (err?.name === "SequelizeForeignKeyConstraintError") return true;

  const msg = String(err?.message || "").toLowerCase();
  if (
    msg.includes("foreign key constraint") ||
    msg.includes("a foreign key constraint fails") ||
    msg.includes("cannot delete") ||
    msg.includes("is still referenced")
  ) {
    return true;
  }

  return false;
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

  // Images
  const imgAs =
    A.images ? "images" :
    A.productImages ? "productImages" :
    A.ProductImages ? "ProductImages" :
    null;

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
// ✅ ahora incluye stock_qty según sucursal efectiva
// =====================================
async function getOne(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const admin = isAdminReq(req);
    const ctxBranchId = getBranchId(req);

    if (!admin && !ctxBranchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    // ✅ branch para calcular stock_qty en detalle
    const stockBranchId = admin
      ? toInt(req.query.branch_id || req.query.branchId || req.headers["x-branch-id"], 0) || ctxBranchId || 0
      : ctxBranchId;

    const include = buildProductIncludes({ includeBranch: admin });

    // ✅ en vez de findByPk simple, metemos attributes include con el literal
    const p = await Product.findOne({
      where: { id },
      include,
      attributes: {
        include: [[stockQtyLiteralByBranch(stockBranchId), "stock_qty"]],
      },
    });

    if (!p) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    if (!admin) {
      const ok = await Product.findOne({
        where: {
          id,
          [Op.and]: [existsStockInBranch(ctxBranchId)],
        },
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
// ✅ endpoint rápido para refrescar stock del form al cambiar sucursal
// =====================================
async function getStock(req, res, next) {
  try {
    const productId = toInt(req.params.id, 0);
    if (!productId) return res.status(400).json({ ok: false, message: "ID inválido" });

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

    return res.json({
      ok: true,
      data: { product_id: productId, branch_id: branchId, qty },
    });
  } catch (e) {
    next(e);
  }
}

// =====================================
// POST /api/v1/products
// =====================================
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

    const admin = isAdminReq(req);
    const branch_id = getBranchId(req);

    if (!admin) {
      if (!branch_id) {
        return res.status(400).json({
          ok: false,
          code: "BRANCH_REQUIRED",
          message: "No se pudo determinar la sucursal del usuario (branch_id).",
        });
      }
      payload.branch_id = branch_id;
    } else {
      if (!payload.branch_id) payload.branch_id = branch_id || 1;
    }

    const created = await Product.create(payload);
    return res.status(201).json({ ok: true, message: "Producto creado", data: created });
  } catch (e) {
    next(e);
  }
}

// =====================================
// PATCH /api/v1/products/:id
// =====================================
async function update(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const admin = isAdminReq(req);

    const p = await Product.findByPk(id);
    if (!p) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    const patch = pickBody(req.body || {});
    if (!admin) delete patch.branch_id;

    await p.update(patch);

    const include = buildProductIncludes({ includeBranch: admin });

    // ✅ devolvemos con stock_qty también, usando branch efectiva del request
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
    next(e);
  }
}

// =====================================
// DELETE /api/v1/products/:id (solo admin)
// - FK => 200 ok:false (para NO mostrar error rojo en consola)
// =====================================
async function remove(req, res, next) {
  try {
    if (!requireAdmin(req, res)) return;

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, message: "ID inválido" });

    const p = await Product.findByPk(id);
    if (!p) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    try {
      if (sequelize && typeof sequelize.transaction === "function") {
        await sequelize.transaction(async (t) => {
          if (ProductImage?.destroy) {
            await ProductImage.destroy({ where: { product_id: id }, transaction: t });
          }
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
