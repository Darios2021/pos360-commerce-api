// src/controllers/products.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (ALINEADO A DB REAL: products.subcategory_id -> subcategories.id)
// Mantiene: SKU auto + FIX CODE + SCOPE + Matriz sucursales STOCK UI + Delete PRO + Next Code

const { Op, Sequelize } = require("sequelize");
const { Product, Category, Subcategory, ProductImage, sequelize } = require("../models");

// =====================
// Helpers básicos
// =====================
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

function codeFromId(id) {
  const n = toInt(id, 0);
  if (!n) return null;
  return `P${String(n).padStart(9, "0")}`;
}

// =====================
// Includes (ALINEADO A DB REAL)
// =====================
/**
 * ✅ Includes defensivos
 * - category -> Category (+ parent si existe)
 * - subcategory -> Subcategory (+ category si existe)
 * - images
 * - createdByUser
 *
 * Nota: si tus asociaciones usan otro "as", igual lo buscamos de forma defensiva.
 */
function buildProductIncludes({ includeBranch = false } = {}) {
  const inc = [];
  const A = Product?.associations || {};

  // category include
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

  // ✅ subcategory include (DEBE ser Subcategory)
  const subAs = A.subcategory ? "subcategory" : A.Subcategory ? "Subcategory" : null;
  if (subAs) {
    const subInclude = { association: subAs, required: false };
    try {
      const SubModel = A[subAs]?.target || Subcategory;
      const SA = SubModel?.associations || {};
      // subcategory -> category (por subcategories.category_id)
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

// =====================
// Category/Subcategory SANITIZE (DB REAL)
// =====================
/**
 * ✅ Solo valida category_id si vino.
 * ✅ subcategory_id: lo dejamos pasar (int) y lo resolvemos SIEMPRE con ensureSubcategoryFK()
 */
async function sanitizeCategoryFKs(payload) {
  if (!payload) return payload;

  if (Object.prototype.hasOwnProperty.call(payload, "category_id")) {
    if (payload.category_id === "" || payload.category_id === undefined) payload.category_id = null;

    if (payload.category_id != null) {
      const cid = toInt(payload.category_id, 0);
      if (!cid) {
        payload.category_id = null;
      } else {
        const ok = await Category.findByPk(cid, { attributes: ["id"] }).catch(() => null);
        payload.category_id = ok ? cid : null;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "subcategory_id")) {
    if (payload.subcategory_id === "" || payload.subcategory_id === undefined) payload.subcategory_id = null;
    if (payload.subcategory_id != null) payload.subcategory_id = toInt(payload.subcategory_id, 0) || null;
  }

  return payload;
}

// ✅ FIX DEFINITIVO (schema real + evita "se crea con cualquiera"):
/**
 * products.subcategory_id -> FK a subcategories.id
 *
 * Regla (anti colisión IDs):
 * 1) PRIORIDAD: si incoming existe como Category HIJA (parent_id) => convertir a Subcategory real (category_id + name)
 * 2) Si NO es Category HIJA, recién ahí permitir que sea Subcategory.id real
 * 3) Si no cierra => null
 */
async function ensureSubcategoryFK(payload, { transaction = null } = {}) {

  if (!payload) return payload;
  if (!Object.prototype.hasOwnProperty.call(payload, "subcategory_id")) return payload;

  if (payload.subcategory_id === "" || payload.subcategory_id === undefined) payload.subcategory_id = null;
  if (payload.subcategory_id == null) return payload;

  const incoming = toInt(payload.subcategory_id, 0);
  if (!incoming) {
    payload.subcategory_id = null;
    return payload;
  }

  const catIncoming = toInt(payload.category_id, 0) || 0;

  // 1) ✅ PRIORIDAD: interpretarlo como categories.id HIJA (legacy UI)
  const catChild = await Category.findByPk(incoming, {
    attributes: ["id", "name", "parent_id"],
    transaction,
  }).catch(() => null);

  const parentId = toInt(catChild?.parent_id, 0);
  const childName = String(catChild?.name || "").trim();

  if (catChild && parentId > 0 && childName) {
    payload.category_id = parentId;

    let sub = await Subcategory.findOne({
      where: { category_id: parentId, name: childName },
      attributes: ["id"],
      transaction,
    });

    if (!sub) {
      sub = await Subcategory.create({ category_id: parentId, name: childName, is_active: 1 }, { transaction });
    }

    payload.subcategory_id = sub.id;
    return payload;
  }

  // 2) ✅ Si NO es category-hija, permitir que sea subcategories.id real
  const subByPk = await Subcategory.findByPk(incoming, {
    attributes: ["id", "category_id"],
    transaction,
  }).catch(() => null);

  if (subByPk) {
    const subCatId = toInt(subByPk.category_id, 0) || 0;

    if (!catIncoming && subCatId) payload.category_id = subCatId;

    if (catIncoming && subCatId && catIncoming !== subCatId) {
      payload.subcategory_id = null;
      return payload;
    }

    payload.subcategory_id = subByPk.id;
    return payload;
  }

  payload.subcategory_id = null;
  return payload;
}




// =====================
// Validación
// =====================
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

  checkString("sku", payload.sku, { required: false, max: 64 });
  checkString("name", payload.name, { required: true, max: 200 });

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
  checkBool("track_stock", payload.track_stock);

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

// =====================
// Body parsing
// =====================
function pickBody(body = {}) {
  const out = {};
  const fields = [
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
  if (out.name != null) out.name = String(out.name).trim();
  if (out.description != null) out.description = String(out.description).trim();

  if (out.category_id === "") out.category_id = null;
  if (out.subcategory_id === "") out.subcategory_id = null;

  if (out.category_id != null) out.category_id = toInt(out.category_id, null);
  if (out.subcategory_id != null) out.subcategory_id = toInt(out.subcategory_id, null);
  if (out.branch_id != null) out.branch_id = toInt(out.branch_id, null);

  const bools = ["is_new", "is_promo", "track_stock", "sheet_has_stock", "is_active"];
  for (const b of bools) if (out[b] != null) out[b] = toBool(out[b], false);

  const nums = ["warranty_months", "cost", "price", "price_list", "price_discount", "price_reseller", "tax_rate"];
  for (const n of nums) if (out[n] != null) out[n] = toFloat(out[n], 0);

  // 🚫 NO aceptamos code del cliente
  if (Object.prototype.hasOwnProperty.call(out, "code")) delete out.code;

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

// =====================
// product_branches upsert
// =====================
async function upsertProductBranches({ productId, branchIds, transaction = null }) {
  const pid = toInt(productId, 0);
  const bids = Array.isArray(branchIds) ? branchIds.map((x) => toInt(x, 0)).filter(Boolean) : [];
  if (!pid || !bids.length) return;

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

// =====================
// GET /api/v1/products/next-code
// =====================
async function getNextCode(req, res, next) {
  try {
    const [[row]] = await sequelize.query(
      `
      SELECT AUTO_INCREMENT AS next_id
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'products'
      LIMIT 1
      `
    );

    const nextId = toInt(row?.next_id, 0) || 1;
    return res.json({
      ok: true,
      data: {
        next_id: nextId,
        code: codeFromId(nextId),
        note: "Código aproximado (puede variar por concurrencia).",
      },
    });
  } catch (e) {
    next(e);
  }
}

// =====================
// GET /api/v1/products/:id/branches
// =====================
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
        ), 0) AS current_qty,

        COALESCE((
          SELECT w2.id
          FROM warehouses w2
          WHERE w2.branch_id = b.id
          ORDER BY w2.id ASC
          LIMIT 1
        ), 0) AS warehouse_id

      FROM branches b
      LEFT JOIN product_branches pb
        ON pb.product_id = :pid
       AND pb.branch_id = b.id

      ${onlyOne}
      ORDER BY b.name ASC
      `,
      {
        replacements: admin ? { pid: productId } : { pid: productId, onlyBranchId: ctxBranchId },
      }
    );

    return res.json({ ok: true, data: rows || [] });
  } catch (e) {
    next(e);
  }
}

// =====================
// GET /api/v1/products
// =====================
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

    const branchIdQuery = toInt(req.query.branch_id || req.query.branchId || req.headers["x-branch-id"], 0);
    const branchIdScope = admin ? (branchIdQuery || 0) : ctxBranchId;

    const ownerBranchId = admin ? toInt(req.query.owner_branch_id || req.query.ownerBranchId || 0, 0) : 0;
    const stockBranchId = admin ? (branchIdScope || 0) : branchIdScope;

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

    if (admin && ownerBranchId) where.branch_id = ownerBranchId;

    where[Op.and] = where[Op.and] || [];

    if (!admin) where[Op.and].push(enabledInBranchLiteral(branchIdScope));
    else if (branchIdScope) where[Op.and].push(enabledInBranchLiteral(branchIdScope));

    const inStock = toInt(req.query.in_stock, 0) === 1 || String(req.query.in_stock || "").toLowerCase() === "true";
    const sellable = toInt(req.query.sellable, 0) === 1 || String(req.query.sellable || "").toLowerCase() === "true";

    if (inStock || sellable) {
      if (!admin || branchIdScope) {
        where[Op.and].push(existsStockInBranch(branchIdScope));
      } else {
        where[Op.and].push(
          Sequelize.literal(`EXISTS (SELECT 1 FROM stock_balances sb WHERE sb.product_id = Product.id AND sb.qty > 0)`)
        );
      }
    }

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

// =====================
// GET /api/v1/products/:id
// =====================
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

    const branchIdQuery = toInt(req.query.branch_id || req.query.branchId || req.headers["x-branch-id"], 0);
    const branchIdScope = admin ? (branchIdQuery || 0) : ctxBranchId;

    const include = buildProductIncludes({ includeBranch: admin });

    const p = await Product.findOne({
      where: { id },
      include,
      attributes: { include: [[stockQtyLiteralByBranch(admin ? (branchIdScope || 0) : branchIdScope), "stock_qty"]] },
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

// =====================
// GET /api/v1/products/:id/stock
// =====================
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

// =====================
// POST /api/v1/products
// =====================
async function create(req, res, next) {
  try {
    const admin = isAdminReq(req);
    const ctxBranchId = getBranchId(req);

    const payload = pickBody(req.body || {});
    const bodyBranchIds = normalizeBranchIdsInput(req.body || {});

    payload.created_by = toInt(req?.user?.id, 0) || null;

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

    await sanitizeCategoryFKs(payload);

    // ✅ Si SKU vino vacío, lo dejamos vacío acá y lo seteamos luego con code (evita 409 por duplicados)
    if (payload.sku != null && String(payload.sku).trim() === "") payload.sku = "";

    const errors = validateProductPayload(payload, { isPatch: false });
    if (errors.length) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "Hay errores de validación en el producto.",
        errors,
      });
    }

    const createdId = await sequelize.transaction(async (t) => {
      // ✅ CLAVE: convertir y alinear subcategory_id a FK real subcategories.id
      await ensureSubcategoryFK(payload, { transaction: t });

      // SKU temporal si viene vacío
      const tmpSku = isNonEmptyStr(payload.sku)
        ? payload.sku.trim()
        : `TMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const p = await Product.create({ ...payload, sku: tmpSku }, { transaction: t });

      const code = codeFromId(p.id);
      const skuFinal = isNonEmptyStr(payload.sku) ? payload.sku.trim() : code;

      await p.update({ code, sku: skuFinal }, { transaction: t });

      const bids = !admin ? [payload.branch_id] : bodyBranchIds.length ? bodyBranchIds : [payload.branch_id];
      await upsertProductBranches({ productId: p.id, branchIds: bids, transaction: t });

      return p.id;
    });

    const include = buildProductIncludes({ includeBranch: admin });
    const branchIdQuery = toInt(req.query.branch_id || req.query.branchId || req.headers["x-branch-id"], 0);
    const branchIdScope = admin ? (branchIdQuery || 0) : getBranchId(req);

    const fresh = await Product.findOne({
      where: { id: createdId },
      include,
      attributes: { include: [[stockQtyLiteralByBranch(admin ? (branchIdScope || 0) : branchIdScope), "stock_qty"]] },
    });

    return res.status(201).json({
      ok: true,
      message: "Producto creado",
      data: fresh ? fresh.toJSON() : { id: createdId },
    });
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

// =====================
// PATCH/PUT /api/v1/products/:id
// =====================
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
      if (!bid) {
        return res.status(400).json({
          ok: false,
          code: "BRANCH_REQUIRED",
          message: "No se pudo determinar la sucursal del usuario.",
        });
      }

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
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_SCOPE",
          message: "No tenés permisos para editar productos no habilitados en tu sucursal.",
        });
      }
    }

    const patch = pickBody(req.body || {});
    const bodyBranchIds = normalizeBranchIdsInput(req.body || {});

    if (!admin) delete patch.branch_id;
    if (Object.prototype.hasOwnProperty.call(patch, "code")) delete patch.code;

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

    await sequelize.transaction(async (t) => {
      // ✅ CLAVE: convertir y alinear subcategory_id a FK real
      await ensureSubcategoryFK(patch, { transaction: t });

      await p.update(patch, { transaction: t });

      if (!p.code) await p.update({ code: codeFromId(p.id) }, { transaction: t });
      if (!p.sku) await p.update({ sku: p.code || codeFromId(p.id) }, { transaction: t });

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

    const branchIdQuery = toInt(req.query.branch_id || req.query.branchId || req.headers["x-branch-id"], 0);
    const branchIdScope = admin ? (branchIdQuery || 0) : ctxBranchId;

    const updated = await Product.findOne({
      where: { id },
      include,
      attributes: { include: [[stockQtyLiteralByBranch(admin ? (branchIdScope || 0) : branchIdScope), "stock_qty"]] },
    });

    const x = updated?.toJSON ? updated.toJSON() : updated || {};
    const u = x?.createdByUser || null;

    return res.json({
      ok: true,
      message: "Producto actualizado",
      data: { ...x, created_by_user: creatorLabelFromUser(u) },
    });
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

// =====================
// DELETE /api/v1/products/:id
// =====================
async function remove(req, res, next) {
  try {
    if (!requireAdmin(req, res)) return;

    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, code: "VALIDATION", message: "ID inválido" });

    const p = await Product.findByPk(id, { attributes: ["id", "name", "is_active"] });
    if (!p) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Producto no encontrado" });

    const [[srow]] = await sequelize.query(
      `
      SELECT COALESCE(SUM(sb.qty), 0) AS total_qty
      FROM stock_balances sb
      WHERE sb.product_id = :pid
      `,
      { replacements: { pid: id } }
    );

    const totalQty = Number(srow?.total_qty || 0);

    // Si tiene stock => soft delete + deshabilitar en product_branches
    if (totalQty > 0) {
      await sequelize.transaction(async (t) => {
        await sequelize.query(
          `
          UPDATE products
          SET is_active = 0
          WHERE id = :pid
          `,
          { replacements: { pid: id }, transaction: t }
        );

        await sequelize.query(
          `
          UPDATE product_branches
          SET is_active = 0
          WHERE product_id = :pid
          `,
          { replacements: { pid: id }, transaction: t }
        );
      });

      return res.status(200).json({
        ok: true,
        code: "SOFT_DELETED_STOCK",
        message:
          "El producto tenía stock, por seguridad NO se borró físicamente. Se desactivó (soft delete) y quedó oculto.",
        data: { product_id: id, total_qty: totalQty },
      });
    }

    // Si NO tiene stock => intentamos borrado físico
    try {
      await sequelize.transaction(async (t) => {
        if (ProductImage?.destroy) await ProductImage.destroy({ where: { product_id: id }, transaction: t });

        await sequelize.query(`DELETE FROM product_branches WHERE product_id = :pid`, {
          replacements: { pid: id },
          transaction: t,
        });

        await sequelize.query(`DELETE FROM stock_balances WHERE product_id = :pid`, {
          replacements: { pid: id },
          transaction: t,
        });

        await p.destroy({ transaction: t });
      });

      return res.json({ ok: true, message: "Producto eliminado" });
    } catch (err) {
      // Si falla por FK (ventas/movimientos) => soft delete
      if (isFkConstraintError(err)) {
        await sequelize.transaction(async (t) => {
          await sequelize.query(
            `
            UPDATE products
            SET is_active = 0
            WHERE id = :pid
            `,
            { replacements: { pid: id }, transaction: t }
          );

          await sequelize.query(
            `
            UPDATE product_branches
            SET is_active = 0
            WHERE product_id = :pid
            `,
            { replacements: { pid: id }, transaction: t }
          );
        });

        return res.status(200).json({
          ok: true,
          code: "SOFT_DELETED",
          message:
            "No se pudo borrar físicamente por referencias (ventas/movimientos). Se desactivó el producto (soft delete).",
          data: { product_id: id },
        });
      }

      throw err;
    }
  } catch (e) {
    next(e);
  }
}

module.exports = {
  list,
  create,
  getOne,
  getStock,
  getBranchesMatrix,
  update,
  remove,
  getNextCode,
};
