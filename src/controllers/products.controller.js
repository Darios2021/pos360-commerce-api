// src/controllers/products.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (PASO 3 + Matriz de sucursales para STOCK UI)
//
// - products.branch_id = owner/origen (NOT NULL)
// - Catálogo visible por sucursal: product_branches (product_id, branch_id, is_active)
// - Usuarios normales: solo ven productos habilitados en SU sucursal
// - Admin: puede filtrar por ?branch_id= (catálogo habilitado) y/o ?owner_branch_id= (dueño/origen)
//
// ✅ NEW: GET /products/:id/branches => matriz para UI stock (enabled + current_qty por branch)

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

function creatorLabelFromUser(u) {
  if (!u) return null;
  return (
    u.username ||
    u.email ||
    [u.first_name, u.last_name].filter(Boolean).join(" ") ||
    (u.id ? `User #${u.id}` : null)
  );
}

/**
 * ✅ Includes defensivos
 * - Solo agrega asociaciones si existen
 */
function buildProductIncludes({ includeBranch = false } = {}) {
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
    } catch {}
    inc.push(catInclude);
  }

  const subAs = A.subcategory ? "subcategory" : A.Subcategory ? "Subcategory" : null;
  if (subAs) {
    const subInclude = { association: subAs, required: false };
    try {
      const SubModel = A[subAs]?.target || Subcategory;
      const SA = SubModel?.associations || {};
      const subCatAs = SA.category ? "category" : SA.Category ? "Category" : null;
      if (subCatAs) subInclude.include = [{ association: subCatAs, required: false }];
    } catch {}
    inc.push(subInclude);
  }

  const imgAs = A.images ? "images" : A.productImages ? "productImages" : A.ProductImages ? "ProductImages" : null;
  if (imgAs) inc.push({ association: imgAs, required: false });

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

  const creatorAs = A.createdByUser ? "createdByUser" : null;
  if (creatorAs) {
    inc.push({
      association: creatorAs,
      required: false,
      attributes: ["id", "username", "email", "first_name", "last_name"],
    });
  }

  return inc;
}

async function sanitizeCategoryFKs(payload) {
  if (!payload) return payload;

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

  if (Object.prototype.hasOwnProperty.call(payload, "subcategory_id")) {
    if (payload.subcategory_id === "" || payload.subcategory_id === undefined) payload.subcategory_id = null;

    if (payload.subcategory_id != null) {
      const sid = toInt(payload.subcategory_id, 0);
      if (!sid) {
        payload.subcategory_id = null;
      } else {
        if (!Subcategory || typeof Subcategory.findByPk !== "function") {
          payload.subcategory_id = null;
        } else {
          const sub = await Subcategory.findByPk(sid, { attributes: ["id", "category_id"] }).catch(() => null);

          if (!sub) {
            payload.subcategory_id = null;
          } else {
            payload.subcategory_id = toInt(sub.id, null);

            const subCatId = toInt(sub.category_id, 0);
            if (subCatId) {
              payload.category_id = subCatId;

              const ok = await Category.findByPk(subCatId, { attributes: ["id"] });
              if (!ok) {
                payload.category_id = null;
                payload.subcategory_id = null;
              }
            }
          }
        }
      }
    }
  }

  return payload;
}

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

  checkString("sku", payload.sku, { required: true, max: 64 });
  checkString("name", payload.name, { required: true, max: 200 });

  checkString("code", payload.code, { required: false, max: 64 });
  checkString("barcode", payload.barcode, { required: false, max: 64 });
  checkString("description", payload.description, { required: false });

  checkPositiveInt("category_id", payload.category_id, { allowNull: true });
  checkPositiveInt("subcategory_id", payload.subcategory_id, { allowNull: true });

  if (!isPatch) checkPositiveInt("branch_id", payload.branch_id, { allowNull: false });
  else checkPositiveInt("branch_id", payload.branch_id, { allowNull: true });

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

function normalizeBranchIdsInput(body = {}) {
  const raw = body.branch_ids ?? body.branchIds ?? body.branches ?? body.branchs ?? null;
  const out = [];

  const pushId = (x) => {
    const id = toInt(x, 0);
    if (id > 0) out.push(id);
  };

  if (Array.isArray(raw)) {
    for (const it of raw) {
      if (it && typeof it === "object") pushId(it.id ?? it.branch_id);
      else pushId(it);
    }
  } else if (raw && typeof raw === "object") {
    pushId(raw.id ?? raw.branch_id);
  } else if (raw != null) {
    String(raw)
      .split(",")
      .map((s) => toInt(s.trim(), 0))
      .filter(Boolean)
      .forEach((id) => out.push(id));
  }

  const single = toInt(body.branch_id, 0);
  if (!out.length && single) out.push(single);

  return Array.from(new Set(out));
}

/**
 * ✅ FIX: IN (...) con placeholders reales (MySQL friendly)
 */
async function upsertProductBranches({ productId, branchIds, transaction = null }) {
  const pid = toInt(productId, 0);
  const bids = Array.isArray(branchIds) ? branchIds.map((x) => toInt(x, 0)).filter(Boolean) : [];
  if (!pid || !bids.length) return;

  // INSERT IGNORE bulk
  const placeholders = bids.map(() => "(?, ?, 1, CURRENT_TIMESTAMP)").join(", ");
  const insertValues = [];
  for (const bid of bids) insertValues.push(pid, bid);

  await sequelize.query(
    `
    INSERT IGNORE INTO product_branches (product_id, branch_id, is_active, created_at)
    VALUES ${placeholders}
    `,
    { replacements: insertValues, transaction }
  );

  // UPDATE ... IN (?,?,?)
  const inPH = bids.map(() => "?").join(",");
  await sequelize.query(
    `
    UPDATE product_branches
    SET is_active = 1
    WHERE product_id = ?
      AND branch_id IN (${inPH})
    `,
    { replacements: [pid, ...bids], transaction }
  );
}

function enabledInBranchLiteral(branchId) {
  const bid = toInt(branchId, 0);
  return Sequelize.literal(`EXISTS (
    SELECT 1
    FROM product_branches pb
    WHERE pb.product_id = Product.id
      AND pb.branch_id = ${bid}
      AND pb.is_active = 1
  )`);
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

// ✅ NUEVO: GET /api/v1/products/:id/branches
async function getBranchesMatrix(req, res, next) {
  try {
    const productId = toInt(req.params.id, 0);
    if (!productId) return res.status(400).json({ ok: false, code: "VALIDATION", message: "ID inválido" });

    const admin = isAdminReq(req);
    const ctxBranchId = getBranchId(req);

    if (!admin && !ctxBranchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    if (!admin) {
      const [[ok]] = await sequelize.query(
        `
        SELECT 1 AS ok
        FROM product_branches
        WHERE product_id = :pid
          AND branch_id = :bid
          AND is_active = 1
        LIMIT 1
        `,
        { replacements: { pid: productId, bid: ctxBranchId } }
      );
      if (!ok?.ok) {
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_SCOPE",
          message: "Producto no habilitado en tu sucursal.",
        });
      }
    }

    const onlyOne = !admin ? "WHERE b.id = :onlyBranchId" : "";

    const [rows] = await sequelize.query(
      `
      SELECT
        b.id AS branch_id,
        b.name AS branch_name,
        COALESCE(pb.is_active, 0) AS enabled,
        COALESCE((
          SELECT SUM(sb.qty)
          FROM stock_balances sb
          JOIN warehouses w ON w.id = sb.warehouse_id
          WHERE sb.product_id = :pid
            AND w.branch_id = b.id
        ), 0) AS current_qty
      FROM branches b
      LEFT JOIN product_branches pb
        ON pb.product_id = :pid
       AND pb.branch_id = b.id
      ${onlyOne}
      ORDER BY b.name ASC
      `,
      { replacements: admin ? { pid: productId } : { pid: productId, onlyBranchId: ctxBranchId } }
    );

    return res.json({ ok: true, data: rows || [] });
  } catch (e) {
    next(e);
  }
}

// GET /api/v1/products
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

    const ownerBranchId = admin
      ? toInt(req.query.owner_branch_id || req.query.ownerBranchId || 0, 0)
      : ctxBranchId;

    const branchIdScope = admin
      ? toInt(req.query.branch_id || req.query.branchId || req.headers["x-branch-id"], 0) || ctxBranchId || 0
      : ctxBranchId;

    const stockBranchId = branchIdScope;

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
      where.branch_id = ownerBranchId;
    } else if (ownerBranchId) {
      where.branch_id = ownerBranchId;
    }

    where[Op.and] = where[Op.and] || [];
    if (!admin) where[Op.and].push(enabledInBranchLiteral(branchIdScope));
    else if (branchIdScope) where[Op.and].push(enabledInBranchLiteral(branchIdScope));

    const inStock = toInt(req.query.in_stock, 0) === 1 || String(req.query.in_stock || "").toLowerCase() === "true";
    const sellable = toInt(req.query.sellable, 0) === 1 || String(req.query.sellable || "").toLowerCase() === "true";

    if (inStock || sellable) where[Op.and].push(existsStockInBranch(stockBranchId));

    if (sellable) {
      where[Op.and].push(
        Sequelize.literal(`(
          GREATEST(
            COALESCE(Product.price,0),
            COALESCE(Product.price_list,0),
            COALESCE(Product.price_discount,0),
            COALESCE(Product.price_reseller,0),
            COALESCE(Product.price,0)
          ) > 0
        )`)
      );
    }

    const include = buildProductIncludes({ includeBranch: admin });

    const { count, rows } = await Product.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
      include,
      distinct: true,
      attributes: { include: [[stockQtyLiteralByBranch(stockBranchId), "stock_qty"]] },
    });

    const data = (rows || []).map((r) => {
      const x = r?.toJSON ? r.toJSON() : r;
      const u = x?.createdByUser || null;
      return { ...x, created_by_user: creatorLabelFromUser(u) };
    });

    const pages = Math.max(1, Math.ceil(count / limit));

    return res.json({ ok: true, data, meta: { page, limit, total: count, pages } });
  } catch (e) {
    next(e);
  }
}

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

    const branchIdScope = admin
      ? toInt(req.query.branch_id || req.query.branchId || req.headers["x-branch-id"], 0) || ctxBranchId || 0
      : ctxBranchId;

    const include = buildProductIncludes({ includeBranch: admin });

    const p = await Product.findOne({
      where: { id },
      include,
      attributes: { include: [[stockQtyLiteralByBranch(branchIdScope), "stock_qty"]] },
    });

    if (!p) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Producto no encontrado" });

    if (!admin) {
      const [[ok]] = await sequelize.query(
        `
        SELECT 1 AS ok
        FROM product_branches
        WHERE product_id = :pid
          AND branch_id = :bid
          AND is_active = 1
        LIMIT 1
        `,
        { replacements: { pid: id, bid: branchIdScope } }
      );

      if (!ok?.ok) {
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_SCOPE",
          message: "No tenés permisos para ver productos no habilitados en tu sucursal.",
        });
      }
    }

    const x = p.toJSON();
    const u = x?.createdByUser || null;

    return res.json({ ok: true, data: { ...x, created_by_user: creatorLabelFromUser(u) } });
  } catch (e) {
    next(e);
  }
}

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

    if (!admin) {
      const [[ok]] = await sequelize.query(
        `
        SELECT 1 AS ok
        FROM product_branches
        WHERE product_id = :pid
          AND branch_id = :bid
          AND is_active = 1
        LIMIT 1
        `,
        { replacements: { pid: productId, bid: branchId } }
      );

      if (!ok?.ok) {
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_SCOPE",
          message: "Producto no habilitado en tu sucursal.",
        });
      }
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

async function create(req, res, next) {
  try {
    const admin = isAdminReq(req);
    const ctxBranchId = getBranchId(req);

    const payload = pickBody(req.body || {});
    const bodyBranchIds = normalizeBranchIdsInput(req.body || {});

    payload.created_by = toInt(req?.user?.id, 0) || null;

    if (!admin) {
      if (!ctxBranchId) {
        return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED", message: "No se pudo determinar la sucursal del usuario (branch_id)." });
      }
      payload.branch_id = ctxBranchId;
    } else {
      if (!payload.branch_id) payload.branch_id = ctxBranchId || 1;
    }

    await sanitizeCategoryFKs(payload);

    const errors = validateProductPayload(payload, { isPatch: false });
    if (errors.length) {
      return res.status(400).json({ ok: false, code: "VALIDATION", message: "Hay errores de validación en el producto.", errors });
    }

    const created = await sequelize.transaction(async (t) => {
      const p = await Product.create(payload, { transaction: t });

      const bids = !admin ? [payload.branch_id] : (bodyBranchIds.length ? bodyBranchIds : [payload.branch_id]);
      await upsertProductBranches({ productId: p.id, branchIds: bids, transaction: t });

      return p;
    });

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

async function update(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, code: "VALIDATION", message: "ID inválido" });

    const admin = isAdminReq(req);
    const ctxBranchId = getBranchId(req);

    const p = await Product.findByPk(id);
    if (!p) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Producto no encontrado" });

    if (!admin) {
      const bid = ctxBranchId;
      if (!bid) return res.status(400).json({ ok: false, code: "BRANCH_REQUIRED", message: "No se pudo determinar la sucursal del usuario." });

      const [[ok]] = await sequelize.query(
        `
        SELECT 1 AS ok
        FROM product_branches
        WHERE product_id = :pid
          AND branch_id = :bid
          AND is_active = 1
        LIMIT 1
        `,
        { replacements: { pid: id, bid } }
      );

      if (!ok?.ok) {
        return res.status(403).json({ ok: false, code: "FORBIDDEN_SCOPE", message: "No tenés permisos para editar productos no habilitados en tu sucursal." });
      }
    }

    const patch = pickBody(req.body || {});
    const bodyBranchIds = normalizeBranchIdsInput(req.body || {});

    if (!admin) delete patch.branch_id;
    if (Object.prototype.hasOwnProperty.call(patch, "created_by")) delete patch.created_by;

    await sanitizeCategoryFKs(patch);

    const errors = validateProductPayload(patch, { isPatch: true });
    if (errors.length) return res.status(400).json({ ok: false, code: "VALIDATION", message: "Hay errores de validación en el producto.", errors });

    await sequelize.transaction(async (t) => {
      await p.update(patch, { transaction: t });

      if (admin) {
        const hasBranchIds =
          Object.prototype.hasOwnProperty.call(req.body || {}, "branch_ids") ||
          Object.prototype.hasOwnProperty.call(req.body || {}, "branchIds") ||
          Object.prototype.hasOwnProperty.call(req.body || {}, "branches");

        if (hasBranchIds) {
          const bids = bodyBranchIds.length ? bodyBranchIds : [toInt(p.branch_id, 0)].filter(Boolean);
          await upsertProductBranches({ productId: id, branchIds: bids, transaction: t });
        }
      }
    });

    const include = buildProductIncludes({ includeBranch: admin });

    const branchIdScope = admin
      ? toInt(req.query.branch_id || req.query.branchId || req.headers["x-branch-id"], 0) || ctxBranchId || 0
      : ctxBranchId;

    const updated = await Product.findOne({
      where: { id },
      include,
      attributes: { include: [[stockQtyLiteralByBranch(branchIdScope), "stock_qty"]] },
    });

    const x = updated.toJSON();
    const u = x?.createdByUser || null;

    return res.json({ ok: true, message: "Producto actualizado", data: { ...x, created_by_user: creatorLabelFromUser(u) } });
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

async function remove(req, res, next) {
  try {
    if (!requireAdmin(req, res)) return;

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, code: "VALIDATION", message: "ID inválido" });

    const p = await Product.findByPk(id);
    if (!p) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Producto no encontrado" });

    try {
      await sequelize.transaction(async (t) => {
        if (ProductImage?.destroy) await ProductImage.destroy({ where: { product_id: id }, transaction: t });
        await p.destroy({ transaction: t });
      });
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

module.exports = { list, create, getOne, getStock, getBranchesMatrix, update, remove };
