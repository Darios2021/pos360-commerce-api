// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/products.controller.js
// ✅ FIX LIST DEFINITIVO (sin bug Sequelize findAndCountAll + includes + EXISTS)
//
// Mantiene:
// - SKU auto + FIX CODE + SCOPE
// - Matriz sucursales STOCK UI + Delete PRO + Next Code
// - sanitizeCategoryFKs + ensureSubcategoryFK
//
// Cambio CLAVE:
// - list(): 2 pasos (SQL IDs paginados + hydrate con Product.findAll)
//   => evita 0 resultados con totalNoScope>0 cuando hay scope por product_branches

const { Op, Sequelize } = require("sequelize");
const { Product, Category, Subcategory, ProductImage, sequelize } = require("../models");
const searchService = require("../services/search.service");
const access = require("../utils/accessScope");

// Fire-and-forget: sync a Meilisearch sin bloquear la respuesta HTTP
function asyncSync(productId) {
  searchService.syncProduct(productId).catch(() => {});
}
function asyncDelete(productId) {
  searchService.deleteProduct(productId).catch(() => {});
}

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

  // subcategory include
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

// =====================
// Category/Subcategory SANITIZE (DB REAL)
// =====================
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

/**
 * products.subcategory_id -> FK a subcategories.id
 * Prioridad corregida para nuevo UI que envía subcategories.id reales:
 * 1) Si el incoming existe en subcategories y su category_id coincide => usar directo
 * 2) Fallback legacy: si el ID es un categories.id hijo (import / UI vieja)
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

  // 1) PRIORIDAD: verificar si es un subcategories.id real
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

  // 2) Fallback legacy: el ID puede ser un categories.id hijo (import / UI vieja)
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

  // ── Promociones ──────────────────────────────────────────────────────────
  checkNumber("promo_price", payload.promo_price, { min: 0, allowNull: true });
  checkPositiveInt("promo_qty_threshold", payload.promo_qty_threshold, { allowNull: true });
  checkNumber("promo_qty_discount", payload.promo_qty_discount, { min: 0, allowNull: true });

  if (payload.promo_qty_mode !== undefined && payload.promo_qty_mode !== null) {
    const m = String(payload.promo_qty_mode).trim().toLowerCase();
    if (m && m !== "amount" && m !== "percent") {
      add("promo_qty_mode", "Debe ser 'amount' o 'percent'.");
    }
  }

  // Validar coherencia de fechas si vienen las dos
  const startsRaw = payload.promo_starts_at;
  const endsRaw = payload.promo_ends_at;
  if (startsRaw && endsRaw) {
    const s = new Date(startsRaw);
    const e = new Date(endsRaw);
    if (Number.isFinite(s.getTime()) && Number.isFinite(e.getTime()) && e <= s) {
      add("promo_ends_at", "Debe ser posterior al inicio.");
    }
  }

  // Si se manda descuento por cantidad, exigir umbral y modo.
  // 0 / null / "" significa "no configurado" — sólo > 0 cuenta como configurado.
  const hasQtyDisc = payload.promo_qty_discount != null
                     && payload.promo_qty_discount !== ""
                     && Number(payload.promo_qty_discount) > 0;
  const hasQtyThr  = payload.promo_qty_threshold != null
                     && payload.promo_qty_threshold !== ""
                     && Number(payload.promo_qty_threshold) > 0;
  if (hasQtyDisc && !hasQtyThr) add("promo_qty_threshold", "Requerido si configurás descuento por cantidad.");
  if (hasQtyThr && !hasQtyDisc) add("promo_qty_discount", "Requerido si configurás cantidad mínima.");

  // Si modo es 'percent', el descuento debe estar entre 0 y 100
  if (hasQtyDisc && String(payload.promo_qty_mode || "").toLowerCase() === "percent") {
    const v = toFloat(payload.promo_qty_discount, NaN);
    if (Number.isFinite(v) && (v < 0 || v > 100)) {
      add("promo_qty_discount", "Para 'percent' debe estar entre 0 y 100.");
    }
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
    // Promo
    "promo_price",
    "promo_starts_at",
    "promo_ends_at",
    "promo_qty_threshold",
    "promo_qty_discount",
    "promo_qty_mode",
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

  // ── Promo: normalización ────────────────────────────────────────────────
  // Cadenas vacías → null para que la DB las acepte como NULL
  const promoNullable = [
    "promo_price",
    "promo_starts_at",
    "promo_ends_at",
    "promo_qty_threshold",
    "promo_qty_discount",
    "promo_qty_mode",
  ];
  for (const k of promoNullable) {
    if (k in out && (out[k] === "" || out[k] === undefined)) out[k] = null;
  }

  if (out.promo_price != null) out.promo_price = toFloat(out.promo_price, 0);
  if (out.promo_qty_discount != null) out.promo_qty_discount = toFloat(out.promo_qty_discount, 0);
  if (out.promo_qty_threshold != null) out.promo_qty_threshold = toInt(out.promo_qty_threshold, 0) || null;

  if (out.promo_qty_mode != null) {
    const m = String(out.promo_qty_mode).trim().toLowerCase();
    out.promo_qty_mode = m === "percent" ? "percent" : m === "amount" ? "amount" : null;
  }

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

    // Solo super_admin ve la matriz completa de TODAS las sucursales.
    // Branch admin / cajero: ven solo su sucursal activa.
    const superAdmin = access.isSuperAdmin(req);
    const ctxBranchId = getBranchId(req);

    if (!superAdmin && !ctxBranchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    if (!superAdmin) {
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

    const onlyOne = !superAdmin ? "WHERE b.id = :onlyBranchId" : "";

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
        replacements: superAdmin ? { pid: productId } : { pid: productId, onlyBranchId: ctxBranchId },
      }
    );

    return res.json({ ok: true, data: rows || [] });
  } catch (e) {
    next(e);
  }
}

// =====================
// GET /api/v1/products
// ✅ LIST 2-PASS (IDs + HYDRATE) => FIX definitivo
// =====================
// ✅ COPY-PASTE FINAL COMPLETO
// REEMPLAZAR SOLO LA FUNCION list() EN src/controllers/products.controller.js

async function list(req, res, next) {
  try {
    // SCOPE EFECTIVO
    //  - super_admin: ve productos de TODAS las sucursales (puede acotar con ?branch_id=)
    //  - admin (branch admin) o cajero: SIEMPRE acotado a su sucursal activa
    const superAdmin  = access.isSuperAdmin(req);
    const branchAdmin = access.isBranchAdmin(req); // incluye super_admin
    const admin       = branchAdmin;               // legado: cualquier admin gestiona su sucursal

    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const q = String(req.query.q || "").trim();

    const ctxBranchId = getBranchId(req);
    if (!superAdmin && !ctxBranchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    // ?branch_id= solo lo respeta super_admin. Resto queda en su ctxBranchId.
    const branchIdQuery = toInt(req.query.branch_id || req.query.branchId || req.headers["x-branch-id"], 0);
    const branchIdScope = superAdmin ? (branchIdQuery > 0 ? branchIdQuery : 0) : ctxBranchId;

    // owner branch (solo super_admin puede filtrar por dueño en otras sucursales)
    const ownerBranchId = superAdmin ? toInt(req.query.owner_branch_id || req.query.ownerBranchId || 0, 0) : 0;

    // stock qty
    const stockBranchId = superAdmin ? (branchIdQuery > 0 ? branchIdQuery : 0) : ctxBranchId;

    const categoryId = toInt(req.query.category_id || req.query.categoryId, 0) || 0;
    const subcategoryId = toInt(req.query.subcategory_id || req.query.subcategoryId, 0) || 0;

    const includeInactive =
      admin &&
      (toInt(req.query.include_inactive, 0) === 1 || String(req.query.include_inactive || "").toLowerCase() === "true");

    const isActiveFilterRaw = req.query.is_active;
    const hasExplicitIsActive = Object.prototype.hasOwnProperty.call(req.query || {}, "is_active");

    // filtros tipo stock/images/price
    const inStock = toInt(req.query.in_stock, 0) === 1 || String(req.query.in_stock || "").toLowerCase() === "true";
    const sellable = toInt(req.query.sellable, 0) === 1 || String(req.query.sellable || "").toLowerCase() === "true";
    const stockMode = String(req.query.stock || req.query.stockFilter || "").toLowerCase().trim();
    const wantWithStock = stockMode === "with" || inStock || sellable;
    const wantWithoutStock = stockMode === "without";

    // ✅ FIX: parse opcional (NO convertir "" => 0)
    function hasQueryKey(key) {
      return Object.prototype.hasOwnProperty.call(req.query || {}, key);
    }
    function parseOptionalFloat(raw) {
      if (raw === undefined || raw === null) return null;
      const s = String(raw).trim();
      if (!s) return null;
      if (s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return null;
      const n = Number(s.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }

    // ✅ solo si vinieron realmente
    const priceMin = hasQueryKey("price_min") || hasQueryKey("priceMin")
      ? parseOptionalFloat(req.query.price_min ?? req.query.priceMin)
      : null;

    const priceMax = hasQueryKey("price_max") || hasQueryKey("priceMax")
      ? parseOptionalFloat(req.query.price_max ?? req.query.priceMax)
      : null;

    const pricePresence = String(req.query.price_presence || req.query.pricePresence || "").toLowerCase().trim();

    const imagesMode = String(req.query.images || req.query.imagesFilter || "").toLowerCase().trim();
    const hasImages = imagesMode === "with" || String(req.query.has_images || "").toLowerCase() === "true";
    const noImages = imagesMode === "without" || String(req.query.no_images || "").toLowerCase() === "true";

    // Filtro de promoción:
    //  "all" | ""           → sin filtro
    //  "active"             → is_promo=1 y ventana vigente (NULL o NOW dentro)
    //  "any"                → is_promo=1 (sin importar ventana)
    //  "none"               → is_promo=0
    //  "expired"            → is_promo=1 y promo_ends_at < NOW
    //  "scheduled"          → is_promo=1 y promo_starts_at > NOW
    const promoMode = String(req.query.promo || "").toLowerCase().trim();

    // -------------------------
    // 1) SQL base (solo IDs)
    // -------------------------
    const whereSql = [];
    const repl = {};

    // is_active default
    if (!includeInactive && !hasExplicitIsActive) {
      whereSql.push("p.is_active = 1");
    } else if (hasExplicitIsActive) {
      const v = String(isActiveFilterRaw ?? "").toLowerCase().trim();
      if (v === "1" || v === "true") whereSql.push("p.is_active = 1");
      else if (v === "0" || v === "false") whereSql.push("p.is_active = 0");
    }

    if (q) {
      repl.q = `%${q}%`;
      const qNum = toFloat(q, NaN);
      whereSql.push(
        `(p.name LIKE :q OR p.sku LIKE :q OR p.barcode LIKE :q OR p.code LIKE :q OR p.brand LIKE :q OR p.model LIKE :q${
          Number.isFinite(qNum) ? " OR p.id = :qid" : ""
        })`
      );
      if (Number.isFinite(qNum)) repl.qid = toInt(qNum, 0);
    }

    if (superAdmin && ownerBranchId > 0) {
      repl.ownerBranchId = ownerBranchId;
      whereSql.push("p.branch_id = :ownerBranchId");
    }

    if (categoryId > 0) {
      repl.categoryId = categoryId;
      whereSql.push("p.category_id = :categoryId");
    }
    if (subcategoryId > 0) {
      repl.subcategoryId = subcategoryId;
      whereSql.push("p.subcategory_id = :subcategoryId");
    }

    // ✅ SCOPE por product_branches:
    //    Si NO es super_admin, SIEMPRE filtramos por su sucursal activa.
    //    Si es super_admin, solo filtramos cuando manda branch_id explícito.
    let joinPb = "";
    if (!superAdmin || branchIdQuery > 0) {
      const bid = toInt(branchIdScope, 0);
      repl.scopeBranchId = bid;
      joinPb = `JOIN product_branches pb ON pb.product_id = p.id AND pb.branch_id = :scopeBranchId AND pb.is_active = 1`;
    }

    // Stock filters
    if (wantWithStock) {
      if (!superAdmin || branchIdQuery > 0) {
        repl.stockBranchId = toInt(branchIdScope, 0);
        whereSql.push(`EXISTS (
          SELECT 1
          FROM stock_balances sb
          JOIN warehouses w ON w.id = sb.warehouse_id
          WHERE sb.product_id = p.id
            AND w.branch_id = :stockBranchId
            AND sb.qty > 0
        )`);
      } else {
        whereSql.push(`EXISTS (SELECT 1 FROM stock_balances sb WHERE sb.product_id = p.id AND sb.qty > 0)`);
      }
    } else if (wantWithoutStock) {
      if (!superAdmin || branchIdQuery > 0) {
        repl.stockBranchId = toInt(branchIdScope, 0);
        whereSql.push(`NOT EXISTS (
          SELECT 1
          FROM stock_balances sb
          JOIN warehouses w ON w.id = sb.warehouse_id
          WHERE sb.product_id = p.id
            AND w.branch_id = :stockBranchId
            AND sb.qty > 0
        )`);
      } else {
        whereSql.push(`NOT EXISTS (SELECT 1 FROM stock_balances sb WHERE sb.product_id = p.id AND sb.qty > 0)`);
      }
    }

    // Sellable
    if (sellable) {
      whereSql.push(`(
        GREATEST(
          COALESCE(p.price,0),
          COALESCE(p.price_list,0),
          COALESCE(p.price_discount,0),
          COALESCE(p.price_reseller,0)
        ) > 0
      )`);
    }

    // ✅ Precio lista filtros (FIXED)
    if (pricePresence === "with") whereSql.push(`COALESCE(p.price_list,0) > 0`);
    if (pricePresence === "without") whereSql.push(`COALESCE(p.price_list,0) <= 0`);

    if (priceMin != null) {
      repl.priceMin = priceMin;
      whereSql.push(`COALESCE(p.price_list,0) >= :priceMin`);
    }
    if (priceMax != null) {
      repl.priceMax = priceMax;
      whereSql.push(`COALESCE(p.price_list,0) <= :priceMax`);
    }

    // images exists
    if (hasImages) whereSql.push(`EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id LIMIT 1)`);
    if (noImages) whereSql.push(`NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id LIMIT 1)`);

    // Promociones
    if (promoMode === "any") {
      whereSql.push(`p.is_promo = 1`);
    } else if (promoMode === "active") {
      whereSql.push(
        `p.is_promo = 1
         AND (p.promo_starts_at IS NULL OR p.promo_starts_at <= NOW())
         AND (p.promo_ends_at   IS NULL OR p.promo_ends_at   >= NOW())`
      );
    } else if (promoMode === "none") {
      whereSql.push(`p.is_promo = 0`);
    } else if (promoMode === "expired") {
      whereSql.push(`p.is_promo = 1 AND p.promo_ends_at IS NOT NULL AND p.promo_ends_at < NOW()`);
    } else if (promoMode === "scheduled") {
      whereSql.push(`p.is_promo = 1 AND p.promo_starts_at IS NOT NULL AND p.promo_starts_at > NOW()`);
    }

    const whereClause = whereSql.length ? `WHERE ${whereSql.join(" AND ")}` : "";

    // COUNT total
    const [[countRow]] = await sequelize.query(
      `
      SELECT COUNT(*) AS total
      FROM products p
      ${joinPb}
      ${whereClause}
      `,
      { replacements: repl }
    );

    const total = toInt(countRow?.total, 0);
    const pages = Math.max(1, Math.ceil(total / limit));

    // IDs paginados
    repl.limit = limit;
    repl.offset = offset;

    const [idRows] = await sequelize.query(
      `
      SELECT p.id
      FROM products p
      ${joinPb}
      ${whereClause}
      ORDER BY p.id DESC
      LIMIT :limit OFFSET :offset
      `,
      { replacements: repl }
    );

    const ids = (idRows || []).map((r) => toInt(r?.id, 0)).filter(Boolean);

    if (!ids.length) {
      const wantDebug = toInt(req.query.debug, 0) === 1 || String(req.query.debug || "").toLowerCase() === "true";
      if (wantDebug) {
        return res.json({
          ok: true,
          data: [],
          meta: { page, limit, total, pages },
          debug: {
            admin,
            ctxBranchId,
            branchIdQuery,
            branchIdScope,
            ownerBranchId,
            stockBranchId,
            includeInactive,
            whereSql,
            joinPb: !!joinPb,
          },
        });
      }
      return res.json({ ok: true, data: [], meta: { page, limit, total, pages } });
    }

    // -------------------------
    // 2) HYDRATE
    // -------------------------
    const include = buildProductIncludes({ includeBranch: admin });

    const attrsInclude = [[stockQtyLiteralByBranch(stockBranchId), "stock_qty"]];

    if (admin) {
      attrsInclude.push([
        Sequelize.literal(`(
          SELECT COALESCE(GROUP_CONCAT(CONCAT(b.id,':',b.name) SEPARATOR '|'), '')
          FROM product_branches pb
          JOIN branches b ON b.id = pb.branch_id
          WHERE pb.product_id = Product.id
            AND pb.is_active = 1
        )`),
        "branches_gc",
      ]);

      attrsInclude.push([
        Sequelize.literal(`(
          SELECT COUNT(*)
          FROM product_branches pb
          WHERE pb.product_id = Product.id
            AND pb.is_active = 1
        )`),
        "branches_count",
      ]);
    }

    const rows = await Product.findAll({
      where: { id: { [Op.in]: ids } },
      include,
      attributes: { include: attrsInclude },
      order: [["id", "DESC"]],
    });

    const data = (rows || []).map((r) => {
      const x = r?.toJSON ? r.toJSON() : r;
      const u = x?.createdByUser || null;
      return { ...x, created_by_user: creatorLabelFromUser(u) };
    });

    const wantDebug = toInt(req.query.debug, 0) === 1 || String(req.query.debug || "").toLowerCase() === "true";
    const debug = wantDebug
      ? {
          admin,
          ctxBranchId,
          branchIdQuery,
          branchIdScope,
          ownerBranchId,
          stockBranchId,
          includeInactive,
          total,
          pages,
          idsCount: ids.length,
          sampleIds: ids.slice(0, 10),
          whereSql,
          joinPb: !!joinPb,
        }
      : null;

    return res.json({ ok: true, data, meta: { page, limit, total, pages }, ...(debug ? { debug } : {}) });
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
      await ensureSubcategoryFK(payload, { transaction: t });

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

    asyncSync(createdId);

    // Si el producto se crea YA con is_promo=1, notificamos activación
    try {
      const f = fresh ? (fresh.toJSON ? fresh.toJSON() : fresh) : {};
      if (Number(f?.is_promo)) {
        const telegramNotifier = require("../services/telegramNotifier.service");
        if (telegramNotifier?.notifyPromoChange) {
          telegramNotifier.notifyPromoChange({
            product_id: createdId,
            before: { is_promo: 0 },
            after: {
              is_promo: 1,
              promo_price: f.promo_price ?? null,
              promo_starts_at: f.promo_starts_at ?? null,
              promo_ends_at: f.promo_ends_at ?? null,
              promo_qty_threshold: f.promo_qty_threshold ?? null,
              promo_qty_discount: f.promo_qty_discount ?? null,
              promo_qty_mode: f.promo_qty_mode ?? null,
            },
            source: "create",
          }).catch((err) => console.warn("[telegram.notifyPromoChange]", err?.message));
        }
      }
    } catch (e) {
      console.warn("[telegram] error preparando notificación de promo (create):", e?.message);
    }

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

    // Snapshot ANTES del update — para detectar cambios de promo y notificar Telegram
    const promoBefore = {
      is_promo: p.is_promo ? 1 : 0,
      promo_price: p.promo_price ?? null,
      promo_starts_at: p.promo_starts_at ?? null,
      promo_ends_at: p.promo_ends_at ?? null,
      promo_qty_threshold: p.promo_qty_threshold ?? null,
      promo_qty_discount: p.promo_qty_discount ?? null,
      promo_qty_mode: p.promo_qty_mode ?? null,
    };

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

    asyncSync(id);

    // Notificación a Telegram si cambió la promoción (fire-and-forget)
    try {
      const promoAfter = {
        is_promo: x.is_promo ? 1 : 0,
        promo_price: x.promo_price ?? null,
        promo_starts_at: x.promo_starts_at ?? null,
        promo_ends_at: x.promo_ends_at ?? null,
        promo_qty_threshold: x.promo_qty_threshold ?? null,
        promo_qty_discount: x.promo_qty_discount ?? null,
        promo_qty_mode: x.promo_qty_mode ?? null,
      };
      const telegramNotifier = require("../services/telegramNotifier.service");
      if (telegramNotifier?.notifyPromoChange) {
        // Sin await: que no bloquee la respuesta al cliente
        telegramNotifier.notifyPromoChange({
          product_id: id,
          before: promoBefore,
          after: promoAfter,
          source: "edit",
        }).catch((err) => console.warn("[telegram.notifyPromoChange]", err?.message));
      }
    } catch (e) {
      console.warn("[telegram] error preparando notificación de promo:", e?.message);
    }

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

      asyncDelete(id);
      return res.json({ ok: true, message: "Producto eliminado" });
    } catch (err) {
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

        asyncDelete(id);
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

// =====================
// GET /api/v1/products/stats
// Devuelve métricas agregadas respetando los mismos filtros base del listado
// (q, category, subcategory, branch scope, is_active/include_inactive).
// IGNORA filtros de dimensión (stock/precio/imágenes) para que las cuentas
// "Con stock / Sin stock", "Con precio / Sin precio", etc. tengan sentido.
// =====================
async function getStats(req, res, next) {
  try {
    const superAdmin  = access.isSuperAdmin(req);
    const branchAdmin = access.isBranchAdmin(req);
    const admin       = branchAdmin;

    const q = String(req.query.q || "").trim();

    const ctxBranchId = getBranchId(req);
    if (!superAdmin && !ctxBranchId) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario (branch_id).",
      });
    }

    const branchIdQuery = toInt(req.query.branch_id || req.query.branchId || req.headers["x-branch-id"], 0);
    const branchIdScope = superAdmin ? (branchIdQuery > 0 ? branchIdQuery : 0) : ctxBranchId;
    const ownerBranchId = superAdmin ? toInt(req.query.owner_branch_id || req.query.ownerBranchId || 0, 0) : 0;
    const stockBranchId = superAdmin ? (branchIdQuery > 0 ? branchIdQuery : 0) : ctxBranchId;

    const categoryId = toInt(req.query.category_id || req.query.categoryId, 0) || 0;
    const subcategoryId = toInt(req.query.subcategory_id || req.query.subcategoryId, 0) || 0;

    const includeInactive =
      admin &&
      (toInt(req.query.include_inactive, 0) === 1 || String(req.query.include_inactive || "").toLowerCase() === "true");

    const isActiveFilterRaw = req.query.is_active;
    const hasExplicitIsActive = Object.prototype.hasOwnProperty.call(req.query || {}, "is_active");

    const whereSql = [];
    const repl = {};

    if (!includeInactive && !hasExplicitIsActive) {
      whereSql.push("p.is_active = 1");
    } else if (hasExplicitIsActive) {
      const v = String(isActiveFilterRaw ?? "").toLowerCase().trim();
      if (v === "1" || v === "true") whereSql.push("p.is_active = 1");
      else if (v === "0" || v === "false") whereSql.push("p.is_active = 0");
    }

    if (q) {
      repl.q = `%${q}%`;
      const qNum = toFloat(q, NaN);
      whereSql.push(
        `(p.name LIKE :q OR p.sku LIKE :q OR p.barcode LIKE :q OR p.code LIKE :q OR p.brand LIKE :q OR p.model LIKE :q${
          Number.isFinite(qNum) ? " OR p.id = :qid" : ""
        })`
      );
      if (Number.isFinite(qNum)) repl.qid = toInt(qNum, 0);
    }

    if (superAdmin && ownerBranchId > 0) {
      repl.ownerBranchId = ownerBranchId;
      whereSql.push("p.branch_id = :ownerBranchId");
    }

    if (categoryId > 0) {
      repl.categoryId = categoryId;
      whereSql.push("p.category_id = :categoryId");
    }
    if (subcategoryId > 0) {
      repl.subcategoryId = subcategoryId;
      whereSql.push("p.subcategory_id = :subcategoryId");
    }

    let joinPb = "";
    if (!superAdmin || branchIdQuery > 0) {
      const bid = toInt(branchIdScope, 0);
      repl.scopeBranchId = bid;
      joinPb = `JOIN product_branches pb ON pb.product_id = p.id AND pb.branch_id = :scopeBranchId AND pb.is_active = 1`;
    }

    const whereClause = whereSql.length ? `WHERE ${whereSql.join(" AND ")}` : "";

    // Sub-queries para cada dimensión
    const stockExists = (() => {
      if (!superAdmin || branchIdQuery > 0) {
        repl.stockBranchId = toInt(stockBranchId, 0);
        return `EXISTS (
          SELECT 1
          FROM stock_balances sb
          JOIN warehouses w ON w.id = sb.warehouse_id
          WHERE sb.product_id = p.id
            AND w.branch_id = :stockBranchId
            AND sb.qty > 0
        )`;
      }
      return `EXISTS (SELECT 1 FROM stock_balances sb WHERE sb.product_id = p.id AND sb.qty > 0)`;
    })();

    const imagesExists = `EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id LIMIT 1)`;

    const [[row]] = await sequelize.query(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN p.is_active = 1 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN p.is_active = 0 THEN 1 ELSE 0 END) AS inactive,
        SUM(CASE WHEN ${stockExists} THEN 1 ELSE 0 END) AS with_stock,
        SUM(CASE WHEN NOT ${stockExists} THEN 1 ELSE 0 END) AS without_stock,
        SUM(CASE WHEN COALESCE(p.price_list,0) > 0 THEN 1 ELSE 0 END) AS with_price,
        SUM(CASE WHEN COALESCE(p.price_list,0) <= 0 THEN 1 ELSE 0 END) AS without_price,
        SUM(CASE WHEN ${imagesExists} THEN 1 ELSE 0 END) AS with_images,
        SUM(CASE WHEN NOT ${imagesExists} THEN 1 ELSE 0 END) AS without_images
      FROM products p
      ${joinPb}
      ${whereClause}
      `,
      { replacements: repl }
    );

    return res.json({
      ok: true,
      data: {
        total: toInt(row?.total, 0),
        active: toInt(row?.active, 0),
        inactive: toInt(row?.inactive, 0),
        with_stock: toInt(row?.with_stock, 0),
        without_stock: toInt(row?.without_stock, 0),
        with_price: toInt(row?.with_price, 0),
        without_price: toInt(row?.without_price, 0),
        with_images: toInt(row?.with_images, 0),
        without_images: toInt(row?.without_images, 0),
      },
    });
  } catch (e) {
    next(e);
  }
}

// =====================
// Bulk promo toggle (admin)
// POST /api/v1/products/promos/pause-all   → is_promo=0 a todos los activos
// POST /api/v1/products/promos/resume-all  → is_promo=1 a los que tienen
//   configuración (promo_price>0, o promo_qty_threshold/discount, o ventana).
// =====================
async function pauseAllPromos(req, res, next) {
  try {
    const [rowsBefore] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM products WHERE is_promo = 1`
    );
    const before = toInt(rowsBefore?.[0]?.n, 0);

    const [, meta] = await sequelize.query(
      `UPDATE products SET is_promo = 0 WHERE is_promo = 1`
    );
    const affected = toInt(meta?.affectedRows ?? meta?.rowCount ?? before, 0);

    return res.json({
      ok: true,
      message: `Se apagaron ${affected} promociones`,
      data: { paused: affected },
    });
  } catch (e) {
    next(e);
  }
}

async function resumeAllPromos(req, res, next) {
  try {
    // Sólo prendemos productos que tengan ALGUNA configuración de promo.
    // Si no la tienen, prender el flag no tendría sentido.
    const [, meta] = await sequelize.query(
      `UPDATE products
       SET is_promo = 1
       WHERE is_promo = 0
         AND is_active = 1
         AND (
           COALESCE(promo_price, 0) > 0
           OR promo_starts_at IS NOT NULL
           OR promo_ends_at IS NOT NULL
           OR (COALESCE(promo_qty_threshold, 0) > 1 AND COALESCE(promo_qty_discount, 0) > 0)
         )
         AND (promo_ends_at IS NULL OR promo_ends_at >= NOW())`
    );
    const affected = toInt(meta?.affectedRows ?? meta?.rowCount ?? 0, 0);

    return res.json({
      ok: true,
      message: `Se reactivaron ${affected} promociones configuradas`,
      data: { resumed: affected },
    });
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
  getStats,
  pauseAllPromos,
  resumeAllPromos,
};