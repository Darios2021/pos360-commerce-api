// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/pos.controller.js

const { literal, Op } = require("sequelize");
const {
  sequelize,
  Sale,
  SaleItem,
  Payment,
  PaymentMethod,
  Product,
  StockBalance,
  StockMovement,
  StockMovementItem,
  Warehouse,
} = require("../models");
const { getCurrentOpenCashRegister } = require("../services/cashRegister.service");
const { resolveFiscalSnapshot } = require("../services/fiscalSnapshot.service");
const { maybeCreateFiscalDocument } = require("../services/fiscalDocument.service");

let searchService = null;
try {
  // Búsqueda inteligente (Meilisearch) — se usa solo si está configurado.
  searchService = require("../services/search.service");
} catch (_e) {
  searchService = null;
}

/* =========================
   Utils
========================= */
function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toInt(v, def = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : def;
}

function parseBool(v, def = false) {
  if (v === undefined || v === null) return def;

  const s = String(v).trim().toLowerCase();
  if (s === "") return def;

  if (["1", "true", "t", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "f", "no", "n", "off"].includes(s)) return false;

  return def;
}

function normalizeRoles(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((r) => String(r || "").toLowerCase()).filter(Boolean);
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeBranchIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => toInt(x, 0)).filter(Boolean);
  return String(raw || "")
    .split(",")
    .map((s) => toInt(s.trim(), 0))
    .filter(Boolean);
}

function isAdminReq(req) {
  const u = req?.user || {};
  const roles = normalizeRoles(u.roles);

  if (roles.includes("admin") || roles.includes("superadmin") || roles.includes("super_admin")) return true;

  const role = String(u.role || u.user_role || "").toLowerCase();
  if (role === "admin" || role === "superadmin" || role === "super_admin") return true;

  if (u.is_admin === true) return true;

  return false;
}

function rid(req) {
  return (
    req?.headers?.["x-request-id"] ||
    req?.headers?.["x-correlation-id"] ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function logPos(req, level, msg, extra = {}) {
  const base = {
    rid: req._rid,
    path: req.originalUrl,
    method: req.method,
    user_id: req?.user?.id ?? null,
    user_email: req?.user?.email ?? null,
    user_branch_id: req?.user?.branch_id ?? null,
    user_role: req?.user?.role ?? req?.user?.user_role ?? null,
    user_roles: req?.user?.roles ?? null,
    user_branches: req?.user?.branches ?? null,
    ctx_branchId: req?.ctx?.branchId ?? null,
    ctx_warehouseId: req?.ctx?.warehouseId ?? null,
    q_branch_id: req?.query?.branch_id ?? req?.query?.branchId ?? null,
    q_warehouse_id: req?.query?.warehouse_id ?? req?.query?.warehouseId ?? null,
  };
  console[level](`[POS] ${msg}`, { ...base, ...extra });
}

function resolveExplicitPosContext(req) {
  const branchId =
    toInt(req?.body?.branch_id, 0) || toInt(req?.query?.branch_id, 0) || toInt(req?.query?.branchId, 0);

  const warehouseId =
    toInt(req?.body?.warehouse_id, 0) || toInt(req?.query?.warehouse_id, 0) || toInt(req?.query?.warehouseId, 0);

  return { branchId, warehouseId };
}

function resolvePosContext(req) {
  const branchId =
    toInt(req?.body?.branch_id, 0) ||
    toInt(req?.query?.branch_id, 0) ||
    toInt(req?.query?.branchId, 0) ||
    toInt(req?.ctx?.branchId, 0);

  const warehouseId =
    toInt(req?.body?.warehouse_id, 0) ||
    toInt(req?.query?.warehouse_id, 0) ||
    toInt(req?.query?.warehouseId, 0) ||
    toInt(req?.ctx?.warehouseId, 0);

  return { branchId, warehouseId };
}

async function resolveWarehouseForBranch(branchId) {
  const bid = toInt(branchId, 0);
  if (!bid) return 0;

  const w = await Warehouse.findOne({
    where: { branch_id: bid },
    order: [["id", "ASC"]],
    attributes: ["id"],
  });

  return toInt(w?.id, 0);
}

async function assertWarehouseBelongsToBranch(warehouseId, branchId) {
  const wid = toInt(warehouseId, 0);
  const bid = toInt(branchId, 0);
  if (!wid || !bid) return true;

  const w = await Warehouse.findByPk(wid, { attributes: ["id", "branch_id"] });
  if (!w) return false;
  return toInt(w.branch_id, 0) === bid;
}

/* =========================
   POS Smart Search (Meilisearch) helpers
========================= */

// Códigos (barcode / SKU / code) → se buscan con LIKE exacto en MySQL, nunca por Meilisearch.
// Evita que typo tolerance y sinónimos interfieran con el lector de barras.
function looksLikeCodeQuery(q) {
  const s = String(q || "").trim();
  if (!s) return false;
  // Solo dígitos, 6+ chars → barcode (EAN/UPC)
  if (/^\d{6,}$/.test(s)) return true;
  // Alfanumérico con guiones/puntos, al menos un dígito, longitud 4+ → SKU/code
  if (/^[A-Z0-9][A-Z0-9\-._]{3,}$/i.test(s) && /\d/.test(s)) return true;
  return false;
}

async function resolveBranchIdsForSmartSearch(req, explicit) {
  const admin = isAdminReq(req);
  const allowedBranchIds = normalizeBranchIds(req?.user?.branches);
  const requestedBranchId = toInt(explicit?.branchId, 0) || 0;
  const requestedWarehouseId = toInt(explicit?.warehouseId, 0) || 0;

  if (requestedWarehouseId) {
    // Resolver branch del warehouse para filtrar el índice Meilisearch
    const w = await Warehouse.findByPk(requestedWarehouseId, { attributes: ["id", "branch_id"] });
    const bid = toInt(w?.branch_id, 0);
    return bid ? [bid] : [];
  }

  if (requestedBranchId) return [requestedBranchId];
  if (!admin && allowedBranchIds.length) return allowedBranchIds;
  return []; // admin sin scope → Meilisearch sin filter de branch no es seguro, caerá a LIKE
}

// Pregunta a Meilisearch por IDs relevantes para `q`. Scope: branches del user.
// Devuelve array de ids ordenado por relevancia, o null si Meilisearch no aplica (fallback a LIKE).
async function smartSearchPosIds({ q, branchIds, limit = 500 }) {
  if (!searchService || typeof searchService.isConfigured !== "function") return null;
  if (!searchService.isConfigured()) return null;
  if (!q || !branchIds || !branchIds.length) return null;

  try {
    if (branchIds.length === 1) {
      const result = await searchService.searchCatalog({
        branch_id: branchIds[0],
        q,
        page: 1,
        limit,
      });
      const ids = (result?.items || [])
        .map((it) => toInt(it.product_id, 0))
        .filter(Boolean);
      return ids;
    }

    // Multi-branch: paralelo + merge preservando posiciones relativas (round-robin)
    const settled = await Promise.all(
      branchIds.map((bid) =>
        searchService
          .searchCatalog({ branch_id: bid, q, page: 1, limit })
          .catch(() => ({ items: [] }))
      )
    );

    const seen = new Set();
    const ids = [];
    const maxLen = settled.reduce((m, r) => Math.max(m, (r?.items || []).length), 0);

    for (let i = 0; i < maxLen && ids.length < limit; i++) {
      for (const r of settled) {
        const it = (r?.items || [])[i];
        const pid = toInt(it?.product_id, 0);
        if (!pid || seen.has(pid)) continue;
        seen.add(pid);
        ids.push(pid);
        if (ids.length >= limit) break;
      }
    }
    return ids;
  } catch (e) {
    console.warn("[POS] smartSearchPosIds fallback", e?.message || e);
    return null;
  }
}

// Sanitiza IDs a CSV numérico seguro para usar en ORDER BY FIELD(...)
function sanitizeIdsCsv(ids) {
  return (ids || [])
    .map((x) => toInt(x, 0))
    .filter(Boolean)
    .join(",");
}

// Stopwords mínimos para evitar que palabras triviales forzen 0 resultados.
const POS_STOPWORDS = new Set([
  "de", "del", "la", "las", "el", "los", "un", "una", "y", "o", "e",
  "en", "al", "con", "para", "por", "sin", "su", "sus", "a", "ante",
]);

function splitQueryTerms(q) {
  return String(q || "")
    .toLowerCase()
    .split(/[\s \-_/.,;:|]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !POS_STOPWORDS.has(w));
}

// Genera cláusulas para búsqueda multi-palabra con scoring.
// - whereClause: al menos UNA palabra debe matchear en algún campo (OR entre palabras) → alto recall.
// - scoreExpr: cuenta cuántas palabras matchearon → ordena productos con más matches primero.
// - aliases: campos SQL ya prefijados (ej: "p.name", "c.name").
function buildPosSearchClauses(q, aliases) {
  const words = splitQueryTerms(q);
  if (!words.length || !aliases.length) {
    return { whereClause: "", scoreExpr: "0", replacements: {}, wordCount: 0, words: [] };
  }

  const replacements = {};
  const perWord = words.map((word, idx) => {
    const key = `lw${idx}`;
    replacements[key] = `%${word}%`;
    const ors = aliases.map((a) => `${a} LIKE :${key}`).join(" OR ");
    return `(${ors})`;
  });

  return {
    whereClause: `AND (${perWord.join(" OR ")})`,
    scoreExpr: perWord.map((c) => `(CASE WHEN ${c} THEN 1 ELSE 0 END)`).join(" + "),
    replacements,
    wordCount: words.length,
    words,
  };
}

function clampInstallments(v, def = 1) {
  const n = toInt(v, def);
  if (!Number.isFinite(n)) return def;
  if (n < 1) return 1;
  if (n > 12) return 12;
  return n;
}

function safeJsonParse(s) {
  try {
    const x = JSON.parse(String(s || ""));
    return x && typeof x === "object" ? x : null;
  } catch {
    return null;
  }
}

function safeJsonStringify(v, def = "{}") {
  try {
    return JSON.stringify(v ?? {});
  } catch {
    return def;
  }
}

function mergePaymentNote(existingNote, metaObj) {
  const prev = safeJsonParse(existingNote) || {};
  const merged = { ...prev, ...metaObj };
  let out = "";
  try {
    out = JSON.stringify(merged);
  } catch {
    out = JSON.stringify(metaObj);
  }
  if (out.length > 800) out = out.slice(0, 800);
  return out;
}

function mapPayMethodDetailed(rawMethod, rawReference) {
  const ref = String(rawReference || "").trim().toUpperCase();
  const rawStr = String(rawMethod || "").trim();
  const m = rawStr.toUpperCase();

  if (ref === "SJCREDIT" || ref === "SJ_CREDIT" || ref === "SANJUANCREDITO") {
    return { dbMethod: "CREDIT_SJT", providerCode: "credit_sjt" };
  }

  if (
    rawStr === "credit_sjt" ||
    m === "CREDIT_SJT" ||
    m === "CREDITO_SJT" ||
    m === "CREDITO SAN JUAN" ||
    m === "CRÉDITO SAN JUAN" ||
    m === "SJCREDIT"
  ) {
    return { dbMethod: "CREDIT_SJT", providerCode: "credit_sjt" };
  }

  if (m === "MERCADOPAGO" || m === "MERCADO_PAGO" || m === "MERCADO PAGO" || m === "MP") {
    return { dbMethod: "MERCADOPAGO", providerCode: "mercadopago" };
  }

  if (m === "EFECTIVO") return { dbMethod: "CASH", providerCode: "cash" };
  if (m === "TRANSFERENCIA") return { dbMethod: "TRANSFER", providerCode: "transfer" };
  if (m === "TARJETA" || m === "CREDITO" || m === "CRÉDITO") return { dbMethod: "CARD", providerCode: "card" };
  if (m === "DEBITO" || m === "DÉBITO") return { dbMethod: "CARD", providerCode: "debit" };
  if (m === "QR") return { dbMethod: "QR", providerCode: "qr" };

  if (m === "CASH") return { dbMethod: "CASH", providerCode: "cash" };
  if (m === "TRANSFER") return { dbMethod: "TRANSFER", providerCode: "transfer" };
  if (m === "CARD") return { dbMethod: "CARD", providerCode: "card" };
  if (m === "QR") return { dbMethod: "QR", providerCode: "qr" };
  if (m === "MERCADOPAGO") return { dbMethod: "MERCADOPAGO", providerCode: "mercadopago" };
  if (m === "CREDIT_SJT") return { dbMethod: "CREDIT_SJT", providerCode: "credit_sjt" };
  if (m === "OTHER") return { dbMethod: "OTHER", providerCode: "other" };

  return { dbMethod: "OTHER", providerCode: rawStr ? rawStr : "other" };
}

function mapPayMethod(raw) {
  return mapPayMethodDetailed(raw, null).dbMethod;
}

function mapConfiguredMethodToDbMethod(pm) {
  const kind = String(pm?.kind || "").toUpperCase();
  const provider = String(pm?.provider_code || "").trim().toLowerCase();
  const cardKind = String(pm?.card_kind || "").trim().toUpperCase();

  if (kind === "CASH") return { dbMethod: "CASH", providerCode: provider || "cash" };
  if (kind === "TRANSFER") return { dbMethod: "TRANSFER", providerCode: provider || "transfer" };
  if (kind === "QR") return { dbMethod: "QR", providerCode: provider || "qr" };
  if (kind === "MERCADOPAGO") return { dbMethod: "MERCADOPAGO", providerCode: provider || "mercadopago" };
  if (kind === "CREDIT_SJT") return { dbMethod: "CREDIT_SJT", providerCode: provider || "credit_sjt" };

  if (kind === "CARD") {
    if (cardKind === "DEBIT") return { dbMethod: "CARD", providerCode: "debit" };
    if (cardKind === "CREDIT") return { dbMethod: "CARD", providerCode: "card" };
    return { dbMethod: "CARD", providerCode: provider || "card" };
  }

  return { dbMethod: "OTHER", providerCode: provider || "other" };
}

function normalizePriceBasisFromPaymentMethod(pm) {
  const pricingMode = String(pm?.pricing_mode || "").toUpperCase();

  if (pricingMode === "LIST_PRICE") return "LIST";
  if (pricingMode === "SALE_PRICE") return "SALE";
  if (pricingMode === "SURCHARGE_PERCENT") return "SURCHARGE_PERCENT";
  if (pricingMode === "FIXED_PRICE") return "FIXED_PRICE";
  return null;
}

function resolveConfiguredInstallments(pm, pay) {
  const requested = clampInstallments(
    pay.installments ?? pay.cuotas ?? pay.installment_count ?? pm?.default_installments ?? 1,
    pm?.default_installments ?? 1
  );

  if (!pm?.supports_installments) return 1;

  const minI = Math.max(1, toInt(pm.min_installments, 1));
  const maxI = Math.max(minI, toInt(pm.max_installments, minI));

  if (requested < minI) return minI;
  if (requested > maxI) return maxI;

  return requested;
}

async function resolvePaymentMethodForBranch(paymentMethodId, branchId, transaction) {
  const id = toInt(paymentMethodId, 0);
  if (!id) return null;

  const pm = await PaymentMethod.findByPk(id, { transaction });
  if (!pm) {
    const e = new Error(`Medio de pago no encontrado: id=${id}`);
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_NOT_FOUND";
    throw e;
  }

  const pmBranchId = toInt(pm.branch_id, 0) || null;
  const bid = toInt(branchId, 0) || null;

  if (pmBranchId !== null && bid !== null && pmBranchId !== bid) {
    const e = new Error(`El medio de pago ${id} no pertenece a la sucursal ${bid}`);
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_BRANCH_MISMATCH";
    throw e;
  }

  if (!pm.is_active) {
    const e = new Error(`El medio de pago ${id} está inactivo`);
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_INACTIVE";
    throw e;
  }

  if (pm.only_ecom) {
    const e = new Error(`El medio de pago ${id} es solo para ecommerce`);
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_CHANNEL_INVALID";
    throw e;
  }

  return pm;
}

async function resolveSalePaymentInput({ pay, branchId, paymentsCount, transaction }) {
  const paymentMethodId = toInt(pay.payment_method_id || pay.paymentMethodId, 0);
  const amount = toNum(pay.amount);
  const referenceIncoming = pay.reference || pay.proof || pay.payment_reference || null;

  if (!Number.isFinite(amount) || amount <= 0) {
    const e = new Error(`Pago inválido: amount=${pay.amount}`);
    e.httpStatus = 400;
    e.code = "INVALID_PAYMENT";
    throw e;
  }

  if (paymentMethodId) {
    const pm = await resolvePaymentMethodForBranch(paymentMethodId, branchId, transaction);

    if (paymentsCount > 1 && pm.allow_mixed === false) {
      const e = new Error(`El medio de pago "${pm.name}" no permite pagos mixtos`);
      e.httpStatus = 400;
      e.code = "PAYMENT_METHOD_NOT_MIXABLE";
      throw e;
    }

    if (pm.requires_reference && !String(referenceIncoming || "").trim()) {
      const e = new Error(`El medio de pago "${pm.name}" requiere referencia/comprobante`);
      e.httpStatus = 400;
      e.code = "PAYMENT_METHOD_REFERENCE_REQUIRED";
      throw e;
    }

    const { dbMethod, providerCode } = mapConfiguredMethodToDbMethod(pm);
    const installments = resolveConfiguredInstallments(pm, pay);

    const incomingCardKind = String(pay.card_kind || pay.cardKind || pay.card_type || pay.cardType || "")
      .trim()
      .toUpperCase();

    const cardKindSnapshot =
      pm.kind === "CARD"
        ? String(pm.card_kind || "").trim().toUpperCase() === "DEBIT"
          ? "DEBIT"
          : String(pm.card_kind || "").trim().toUpperCase() === "CREDIT"
            ? "CREDIT"
            : incomingCardKind || (providerCode === "debit" ? "DEBIT" : "CREDIT")
        : String(pm.card_kind || "").trim().toUpperCase() || null;

    const priceBasis = normalizePriceBasisFromPaymentMethod(pm);
    const listTotal = toNum(pay.total_list ?? pay.totalList ?? pay.list_total ?? 0, 0) || null;
    const perInstallmentList =
      toNum(pay.per_installment_list ?? pay.perInstallmentList ?? pay.cuota_valor ?? 0, 0) || null;

    const meta = {
      provider_code: providerCode || null,
      payment_method_id: pm.id,
      payment_method_code: pm.code,
      payment_method_name: pm.name,
      installments,
      price_basis: priceBasis,
      list_total: listTotal,
      per_installment_list: perInstallmentList,
      pricing_mode: pm.pricing_mode || null,
      surcharge_percent: toNum(pm.surcharge_percent, 0),
      surcharge_fixed_amount: toNum(pm.surcharge_fixed_amount, 0),
      register_group: pm.register_group || null,
      card_brand: pm.card_brand || null,
      card_kind: cardKindSnapshot || null,
      requires_reference: !!pm.requires_reference,
      counts_as_cash_in_register: !!pm.counts_as_cash_in_register,
      impacts_cash_register: !!pm.impacts_cash_register,
    };

    let ref = referenceIncoming || null;
    if (!ref && dbMethod === "CREDIT_SJT") ref = "SJCREDIT";
    if (!ref && dbMethod === "MERCADOPAGO") ref = "MERCADOPAGO";

    let notePay = pay.note || null;
    notePay = mergePaymentNote(notePay, meta);

    return {
      paymentMethod: pm,
      payment_method_id: pm.id,
      dbMethod,
      providerCode,
      amount,
      installments,
      reference: ref,
      note: notePay,
      snapshot: {
        payment_method_code_snapshot: pm.code || null,
        payment_method_name_snapshot: pm.display_name || pm.name || null,
        provider_code_snapshot: providerCode || null,
        card_brand_snapshot: pm.card_brand || null,
        card_kind_snapshot: cardKindSnapshot || null,
        pricing_mode_snapshot: pm.pricing_mode || null,
        base_amount_snapshot: toNum(pay.base_amount ?? pay.baseAmount ?? amount, amount),
        charged_amount_snapshot: amount,
        surcharge_percent_snapshot: toNum(pm.surcharge_percent, 0),
        surcharge_fixed_amount_snapshot: toNum(pm.surcharge_fixed_amount, 0),
        installments_snapshot: installments,
        per_installment_amount_snapshot: installments > 0 ? Number((amount / installments).toFixed(2)) : amount,
        reference_required_snapshot: !!pm.requires_reference,
        payment_meta_snapshot: safeJsonStringify({
          input_schema_json: pm.input_schema_json || null,
          installment_plan_json: pm.installment_plan_json || null,
          meta: pm.meta || null,
          card_brand: pm.card_brand || null,
          card_kind: cardKindSnapshot || null,
          register_group: pm.register_group || null,
        }),
      },
    };
  }

  const { dbMethod, providerCode } = mapPayMethodDetailed(pay.method, referenceIncoming);

  if (!["CASH", "TRANSFER", "CARD", "QR", "MERCADOPAGO", "CREDIT_SJT", "OTHER"].includes(dbMethod)) {
    const e = new Error(`Pago inválido: method=${dbMethod}`);
    e.httpStatus = 400;
    e.code = "INVALID_PAYMENT_METHOD";
    throw e;
  }

  const cardKind = String(pay.card_kind || pay.cardKind || pay.card_type || pay.cardType || "")
    .trim()
    .toUpperCase();

  const isDebit =
    providerCode === "debit" ||
    cardKind === "DEBIT" ||
    cardKind === "DEBITO" ||
    cardKind === "DÉBITO" ||
    pay.is_debit === true ||
    pay.isDebit === true;

  let installments = 1;

  if (dbMethod === "CREDIT_SJT" || providerCode === "credit_sjt") {
    installments = clampInstallments(pay.installments ?? pay.cuotas ?? pay.installment_count ?? 1, 1);
  } else if (dbMethod === "CARD") {
    installments = !isDebit
      ? clampInstallments(pay.installments ?? pay.cuotas ?? pay.installment_count ?? 1, 1)
      : 1;
  } else {
    installments = 1;
  }

  const priceBasis = String(pay.price_basis || pay.priceBasis || "").trim().toUpperCase() || null;
  const effectiveBasis =
    (dbMethod === "CARD" && installments > 1 && !isDebit) || dbMethod === "CREDIT_SJT"
      ? "LIST"
      : priceBasis || null;

  const listTotal = toNum(pay.total_list ?? pay.totalList ?? pay.list_total ?? 0, 0) || null;
  const perInstallmentList =
    toNum(pay.per_installment_list ?? pay.perInstallmentList ?? pay.cuota_valor ?? 0, 0) || null;

  const meta =
    installments > 1 || providerCode
      ? {
          provider_code: providerCode || null,
          installments,
          price_basis: effectiveBasis,
          list_total: listTotal,
          per_installment_list: perInstallmentList,
          card_kind: dbMethod === "CARD" ? (isDebit ? "DEBIT" : "CREDIT") : "CREDIT",
        }
      : null;

  let ref = referenceIncoming || null;
  if (!ref && dbMethod === "CREDIT_SJT") ref = "SJCREDIT";
  if (!ref && dbMethod === "MERCADOPAGO") ref = "MERCADOPAGO";

  let notePay = pay.note || null;
  if (meta) notePay = mergePaymentNote(notePay, meta);

  return {
    paymentMethod: null,
    payment_method_id: null,
    dbMethod,
    providerCode,
    amount,
    installments,
    reference: ref,
    note: notePay,
    snapshot: {
      payment_method_code_snapshot: String(pay.method || dbMethod || "").trim().toLowerCase() || null,
      payment_method_name_snapshot: String(pay.label || pay.name || pay.method || dbMethod || "").trim() || null,
      provider_code_snapshot: providerCode || null,
      card_brand_snapshot: null,
      card_kind_snapshot: dbMethod === "CARD" ? (isDebit ? "DEBIT" : "CREDIT") : null,
      pricing_mode_snapshot: effectiveBasis === "LIST" ? "LIST_PRICE" : null,
      base_amount_snapshot: toNum(pay.base_amount ?? pay.baseAmount ?? amount, amount),
      charged_amount_snapshot: amount,
      surcharge_percent_snapshot: null,
      surcharge_fixed_amount_snapshot: null,
      installments_snapshot: installments,
      per_installment_amount_snapshot: installments > 0 ? Number((amount / installments).toFixed(2)) : amount,
      reference_required_snapshot: false,
      payment_meta_snapshot: safeJsonStringify(meta || {}),
    },
  };
}

function cleanPaymentNote(value, maxLen = 255) {
  if (value == null) return null;

  if (typeof value === "object") {
    return null;
  }

  let s = String(value).trim();
  if (!s) return null;

  if (
    s.startsWith("{") ||
    s.startsWith("[") ||
    s.includes('"provider_code"') ||
    s.includes('"payment_method_id"') ||
    s.includes('"payment_method_code"') ||
    s.includes('"pricing_mode"') ||
    s.includes('"register_group"')
  ) {
    return null;
  }

  if (s.length > maxLen) {
    s = s.slice(0, maxLen);
  }

  return s || null;
}

async function insertPaymentRow({ saleId, paymentResolved, transaction }) {
  const safeNote = cleanPaymentNote(paymentResolved?.note);

  await sequelize.query(
    `
    INSERT INTO payments (
      sale_id,
      payment_method_id,
      payment_method_code_snapshot,
      payment_method_name_snapshot,
      provider_code_snapshot,
      card_brand_snapshot,
      card_kind_snapshot,
      pricing_mode_snapshot,
      base_amount_snapshot,
      charged_amount_snapshot,
      surcharge_percent_snapshot,
      surcharge_fixed_amount_snapshot,
      installments_snapshot,
      per_installment_amount_snapshot,
      reference_required_snapshot,
      payment_meta_snapshot,
      method,
      amount,
      installments,
      reference,
      note,
      paid_at
    )
    VALUES (
      :sale_id,
      :payment_method_id,
      :payment_method_code_snapshot,
      :payment_method_name_snapshot,
      :provider_code_snapshot,
      :card_brand_snapshot,
      :card_kind_snapshot,
      :pricing_mode_snapshot,
      :base_amount_snapshot,
      :charged_amount_snapshot,
      :surcharge_percent_snapshot,
      :surcharge_fixed_amount_snapshot,
      :installments_snapshot,
      :per_installment_amount_snapshot,
      :reference_required_snapshot,
      :payment_meta_snapshot,
      :method,
      :amount,
      :installments,
      :reference,
      :note,
      NOW()
    )
    `,
    {
      transaction,
      replacements: {
        sale_id: saleId,
        payment_method_id: paymentResolved.payment_method_id || null,
        payment_method_code_snapshot: paymentResolved.snapshot.payment_method_code_snapshot,
        payment_method_name_snapshot: paymentResolved.snapshot.payment_method_name_snapshot,
        provider_code_snapshot: paymentResolved.snapshot.provider_code_snapshot,
        card_brand_snapshot: paymentResolved.snapshot.card_brand_snapshot,
        card_kind_snapshot: paymentResolved.snapshot.card_kind_snapshot,
        pricing_mode_snapshot: paymentResolved.snapshot.pricing_mode_snapshot,
        base_amount_snapshot: paymentResolved.snapshot.base_amount_snapshot,
        charged_amount_snapshot: paymentResolved.snapshot.charged_amount_snapshot,
        surcharge_percent_snapshot: paymentResolved.snapshot.surcharge_percent_snapshot,
        surcharge_fixed_amount_snapshot: paymentResolved.snapshot.surcharge_fixed_amount_snapshot,
        installments_snapshot: paymentResolved.snapshot.installments_snapshot,
        per_installment_amount_snapshot: paymentResolved.snapshot.per_installment_amount_snapshot,
        reference_required_snapshot: paymentResolved.snapshot.reference_required_snapshot ? 1 : 0,
        payment_meta_snapshot: paymentResolved.snapshot.payment_meta_snapshot,
        method: paymentResolved.dbMethod,
        amount: paymentResolved.amount,
        installments: paymentResolved.installments,
        reference: paymentResolved.reference,
        note: safeNote,
      },
    }
  );
}

async function insertSaleReturnPaymentRow({ returnId, paymentResolved, transaction }) {
  await sequelize.query(
    `
    INSERT INTO sale_return_payments (
      return_id,
      payment_method_id,
      payment_method_code_snapshot,
      payment_method_name_snapshot,
      provider_code_snapshot,
      pricing_mode_snapshot,
      base_amount_snapshot,
      charged_amount_snapshot,
      surcharge_percent_snapshot,
      installments_snapshot,
      payment_meta_snapshot,
      method,
      amount,
      reference,
      note,
      created_at
    )
    VALUES (
      :return_id,
      :payment_method_id,
      :payment_method_code_snapshot,
      :payment_method_name_snapshot,
      :provider_code_snapshot,
      :pricing_mode_snapshot,
      :base_amount_snapshot,
      :charged_amount_snapshot,
      :surcharge_percent_snapshot,
      :installments_snapshot,
      :payment_meta_snapshot,
      :method,
      :amount,
      :reference,
      :note,
      NOW()
    )
    `,
    {
      transaction,
      replacements: {
        return_id: returnId,
        payment_method_id: paymentResolved.payment_method_id || null,
        payment_method_code_snapshot: paymentResolved.snapshot.payment_method_code_snapshot,
        payment_method_name_snapshot: paymentResolved.snapshot.payment_method_name_snapshot,
        provider_code_snapshot: paymentResolved.snapshot.provider_code_snapshot,
        pricing_mode_snapshot: paymentResolved.snapshot.pricing_mode_snapshot,
        base_amount_snapshot: paymentResolved.snapshot.base_amount_snapshot,
        charged_amount_snapshot: paymentResolved.snapshot.charged_amount_snapshot,
        surcharge_percent_snapshot: paymentResolved.snapshot.surcharge_percent_snapshot,
        installments_snapshot: paymentResolved.snapshot.installments_snapshot,
        payment_meta_snapshot: paymentResolved.snapshot.payment_meta_snapshot,
        method: paymentResolved.dbMethod,
        amount: paymentResolved.amount,
        reference: paymentResolved.reference,
        note: paymentResolved.note,
      },
    }
  );
}

/* =========================
   GET /pos/context
========================= */
async function getContext(req, res) {
  req._rid = req._rid || rid(req);

  try {
    const admin = isAdminReq(req);
    const userBranchId = toInt(req?.user?.branch_id, 0);

    const explicit = resolveExplicitPosContext(req);
    const fallback = resolvePosContext(req);

    const resolvedBranchId = admin
      ? toInt(explicit.branchId, 0) || userBranchId || toInt(fallback.branchId, 0) || 0
      : userBranchId;

    let resolvedWarehouseId = admin ? toInt(explicit.warehouseId, 0) : toInt(fallback.warehouseId, 0);

    if (!admin && !resolvedWarehouseId && resolvedBranchId) {
      resolvedWarehouseId = await resolveWarehouseForBranch(resolvedBranchId);
    }
    if (admin && !resolvedWarehouseId && resolvedBranchId) {
      resolvedWarehouseId = await resolveWarehouseForBranch(resolvedBranchId);
    }

    logPos(req, "info", "getContext resolved", {
      admin,
      resolvedBranchId,
      resolvedWarehouseId,
      explicit,
      fallback,
    });

    let warehouseObj = null;
    if (resolvedWarehouseId) {
      const w = await Warehouse.findByPk(resolvedWarehouseId, {
        attributes: ["id", "branch_id", "name"],
      });
      if (w) warehouseObj = w.toJSON();
    }

    return res.json({
      ok: true,
      data: {
        user: req.user
          ? {
              id: req.user.id,
              email: req.user.email,
              username: req.user.username,
              branch_id: req.user.branch_id,
              roles: req.user.roles,
              role: req.user.role || req.user.user_role || null,
              is_admin: req.user.is_admin || false,
              branches: req.user.branches || null,
            }
          : null,
        branch: resolvedBranchId ? { id: resolvedBranchId } : null,
        warehouse: warehouseObj || (resolvedWarehouseId ? { id: resolvedWarehouseId } : null),
        branchId: resolvedBranchId || null,
        warehouseId: resolvedWarehouseId || null,
      },
    });
  } catch (e) {
    logPos(req, "error", "getContext error", { err: e.message });
    return res.status(500).json({ ok: false, code: "POS_CONTEXT_ERROR", message: e.message });
  }
}

/* =========================
   GET /pos/products
========================= */
async function listProductsForPos(req, res) {
  req._rid = req._rid || rid(req);

  try {
    const admin = isAdminReq(req);
    const explicit = resolveExplicitPosContext(req);
    const requestedBranchId = toInt(explicit.branchId, 0) || 0;
    const requestedWarehouseId = toInt(explicit.warehouseId, 0) || 0;
    const allowedBranchIds = normalizeBranchIds(req?.user?.branches);

    if (!admin && !allowedBranchIds.length) {
      return res.status(403).json({
        ok: false,
        code: "NO_BRANCH_SCOPE",
        message: "El usuario no tiene branches asignadas para ver stock.",
      });
    }

    const q = String(req.query.q || "").trim();
    const like = `%${q}%`;

    const categoryId = toInt(req.query.category_id || req.query.categoryId, 0) || null;
    const subcategoryId = toInt(req.query.subcategory_id || req.query.subcategoryId, 0) || null;

    const limit = Math.min(Math.max(parseInt(req.query.limit || "48", 10), 1), 5000);
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const offset = (page - 1) * limit;

    const inStock = parseBool(req.query.in_stock, true);
    const sellable = parseBool(req.query.sellable, true);

    const priceExpr = `
      COALESCE(
        NULLIF(p.price_discount,0),
        NULLIF(p.price_list,0),
        NULLIF(p.price_reseller,0),
        p.price,
        0
      )
    `;

    const whereSellable = sellable ? `AND (${priceExpr}) > 0` : "";

    // ── Smart search ──────────────────────────────────────────────────────
    // 1) q parece código (barcode/SKU) → LIKE exacto en códigos (rápido, protege el lector).
    // 2) q es texto natural → Meilisearch con scope de branches del user.
    // 3) Fallback → multi-word LIKE con scoring (busca cada palabra en nombre/marca/modelo/
    //    SKU/barcode/code/categoría/subcategoría y ordena por cantidad de matches).
    const isCodeQuery = !!q && looksLikeCodeQuery(q);

    let meiliIds = null;
    if (q && !isCodeQuery) {
      const smartBranchIds = await resolveBranchIdsForSmartSearch(req, explicit);
      if (smartBranchIds.length) {
        meiliIds = await smartSearchPosIds({ q, branchIds: smartBranchIds, limit: 500 });
      }
    }
    const useMeili = Array.isArray(meiliIds) && meiliIds.length > 0;
    const meiliIdsCsv = useMeili ? sanitizeIdsCsv(meiliIds) : "";

    const posSearchAliases = [
      "p.name", "p.sku", "p.barcode", "p.code", "p.brand", "p.model",
      "c.name", "s.name",
    ];
    const likeClauses = q && !useMeili && !isCodeQuery
      ? buildPosSearchClauses(q, posSearchAliases)
      : { whereClause: "", scoreExpr: "0", replacements: {}, wordCount: 0, words: [] };
    const useMultiWordLike = likeClauses.wordCount > 0;

    const whereCode = isCodeQuery
      ? `AND (p.sku LIKE :like OR p.barcode LIKE :like OR p.code LIKE :like)`
      : "";

    const whereQ = q
      ? (useMeili
          ? `AND p.id IN (:meiliIds)`
          : (isCodeQuery ? whereCode : likeClauses.whereClause))
      : "";

    // Orden: Meilisearch > scoring multi-palabra > alfabético
    const orderBy = useMeili && meiliIdsCsv
      ? `FIELD(p.id, ${meiliIdsCsv})`
      : (useMultiWordLike ? `(${likeClauses.scoreExpr}) DESC, p.name ASC` : `p.name ASC`);

    // JOIN con categorías para buscar por category_name/subcategory_name (solo si hay q).
    const searchJoins = q && !useMeili
      ? `LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN subcategories s ON s.id = p.subcategory_id`
      : "";

    const whereCategory = categoryId ? `AND p.category_id = :categoryId` : "";
    const whereSubcategory = subcategoryId ? `AND p.subcategory_id = :subcategoryId` : "";

    if (requestedWarehouseId) {
      const whereStock = inStock ? `AND COALESCE(sb.qty, 0) > 0` : "";

      const [rows] = await sequelize.query(
        `
        SELECT
          p.id, p.branch_id, p.code, p.sku, p.barcode, p.name, p.brand, p.model,
          p.category_id, p.subcategory_id, p.is_new, p.is_promo, p.is_active,
          p.price, p.price_list, p.price_discount, p.price_reseller,
          (${priceExpr}) AS effective_price,
          COALESCE(sb.qty, 0) AS qty
        FROM products p
        LEFT JOIN stock_balances sb
          ON sb.product_id = p.id AND sb.warehouse_id = :warehouseId
        ${searchJoins}
        WHERE p.is_active = 1
        ${whereQ}
        ${whereCategory}
        ${whereSubcategory}
        ${whereStock}
        ${whereSellable}
        ORDER BY ${orderBy}
        LIMIT :limit OFFSET :offset
        `,
        {
          replacements: {
            warehouseId: requestedWarehouseId,
            like,
            ...likeClauses.replacements,
            meiliIds: useMeili ? meiliIds : [0],
            limit,
            offset,
            categoryId: categoryId || undefined,
            subcategoryId: subcategoryId || undefined,
          },
        }
      );

      const [[countRow]] = await sequelize.query(
        `
        SELECT COUNT(*) AS total
        FROM products p
        LEFT JOIN stock_balances sb
          ON sb.product_id = p.id AND sb.warehouse_id = :warehouseId
        ${searchJoins}
        WHERE p.is_active = 1
        ${whereQ}
        ${whereCategory}
        ${whereSubcategory}
        ${inStock ? `AND COALESCE(sb.qty,0) > 0` : ""}
        ${whereSellable}
        `,
        {
          replacements: {
            warehouseId: requestedWarehouseId,
            like,
            ...likeClauses.replacements,
            meiliIds: useMeili ? meiliIds : [0],
            categoryId: categoryId || undefined,
            subcategoryId: subcategoryId || undefined,
          },
        }
      );

      return res.json({
        ok: true,
        data: rows,
        meta: {
          scope: "WAREHOUSE",
          page,
          limit,
          total: Number(countRow?.total || 0),
          warehouse_id: requestedWarehouseId,
        },
      });
    }

    if (admin) {
      const scopeBranchId = requestedBranchId || 0;

      const qtyExpr = scopeBranchId
        ? `COALESCE(SUM(CASE WHEN w.branch_id = :branchId THEN sb.qty ELSE 0 END), 0)`
        : `COALESCE(SUM(sb.qty), 0)`;

      const havingStock = inStock ? `HAVING ${qtyExpr} > 0` : "";

      const [rows] = await sequelize.query(
        `
        SELECT
          p.id, p.branch_id, p.code, p.sku, p.barcode, p.name, p.brand, p.model,
          p.category_id, p.subcategory_id, p.is_new, p.is_promo, p.is_active,
          p.price, p.price_list, p.price_discount, p.price_reseller,
          (${priceExpr}) AS effective_price,
          ${qtyExpr} AS qty
        FROM products p
        LEFT JOIN stock_balances sb ON sb.product_id = p.id
        LEFT JOIN warehouses w ON w.id = sb.warehouse_id
        ${searchJoins}
        WHERE p.is_active = 1
        ${whereQ}
        ${whereCategory}
        ${whereSubcategory}
        ${whereSellable}
        GROUP BY p.id
        ${havingStock}
        ORDER BY ${orderBy}
        LIMIT :limit OFFSET :offset
        `,
        {
          replacements: {
            like,
            ...likeClauses.replacements,
            meiliIds: useMeili ? meiliIds : [0],
            limit,
            offset,
            branchId: scopeBranchId || undefined,
            categoryId: categoryId || undefined,
            subcategoryId: subcategoryId || undefined,
          },
        }
      );

      const [[countRow]] = await sequelize.query(
        `
        SELECT COUNT(*) AS total
        FROM (
          SELECT p.id
          FROM products p
          LEFT JOIN stock_balances sb ON sb.product_id = p.id
          LEFT JOIN warehouses w ON w.id = sb.warehouse_id
          ${searchJoins}
          WHERE p.is_active = 1
          ${whereQ}
          ${whereCategory}
          ${whereSubcategory}
          ${whereSellable}
          GROUP BY p.id
          ${havingStock}
        ) x
        `,
        {
          replacements: {
            like,
            ...likeClauses.replacements,
            meiliIds: useMeili ? meiliIds : [0],
            branchId: scopeBranchId || undefined,
            categoryId: categoryId || undefined,
            subcategoryId: subcategoryId || undefined,
          },
        }
      );

      return res.json({
        ok: true,
        data: rows,
        meta: {
          scope: "ADMIN_ALL",
          page,
          limit,
          total: Number(countRow?.total || 0),
          branch_id: scopeBranchId || null,
        },
      });
    }

    if (requestedBranchId && !allowedBranchIds.includes(requestedBranchId)) {
      return res.status(403).json({
        ok: false,
        code: "BRANCH_NOT_ALLOWED",
        message: `No tenés permisos para operar/ver la sucursal ${requestedBranchId}.`,
      });
    }

    const scopeBranchIds = requestedBranchId ? [requestedBranchId] : allowedBranchIds;
    const qtyExpr = `COALESCE(SUM(CASE WHEN w.branch_id IN (:branchIds) THEN sb.qty ELSE 0 END), 0)`;
    const havingStock = inStock ? `HAVING ${qtyExpr} > 0` : "";

    logPos(req, "info", "listProductsForPos scope", {
      admin,
      requestedBranchId,
      requestedWarehouseId,
      allowedBranchIds,
      scopeBranchIds,
      inStock,
      sellable,
      useMeili,
      meiliHits: useMeili ? meiliIds.length : 0,
      categoryId,
      subcategoryId,
    });

    const [rows] = await sequelize.query(
      `
      SELECT
        p.id, p.branch_id, p.code, p.sku, p.barcode, p.name, p.brand, p.model,
        p.category_id, p.subcategory_id, p.is_new, p.is_promo, p.is_active,
        p.price, p.price_list, p.price_discount, p.price_reseller,
        (${priceExpr}) AS effective_price,
        ${qtyExpr} AS qty
      FROM products p
      LEFT JOIN stock_balances sb ON sb.product_id = p.id
      LEFT JOIN warehouses w ON w.id = sb.warehouse_id
      ${searchJoins}
      WHERE p.is_active = 1
      ${whereQ}
      ${whereCategory}
      ${whereSubcategory}
      ${whereSellable}
      GROUP BY p.id
      ${havingStock}
      ORDER BY ${orderBy}
      LIMIT :limit OFFSET :offset
      `,
      {
        replacements: {
          like,
          ...likeClauses.replacements,
          meiliIds: useMeili ? meiliIds : [0],
          limit,
          offset,
          branchIds: scopeBranchIds,
          categoryId: categoryId || undefined,
          subcategoryId: subcategoryId || undefined,
        },
      }
    );

    const [[countRow]] = await sequelize.query(
      `
      SELECT COUNT(*) AS total
      FROM (
        SELECT p.id
        FROM products p
        LEFT JOIN stock_balances sb ON sb.product_id = p.id
        LEFT JOIN warehouses w ON w.id = sb.warehouse_id
        ${searchJoins}
        WHERE p.is_active = 1
        ${whereQ}
        ${whereCategory}
        ${whereSubcategory}
        ${whereSellable}
        GROUP BY p.id
        ${havingStock}
      ) x
      `,
      {
        replacements: {
          like,
          ...likeClauses.replacements,
          meiliIds: useMeili ? meiliIds : [0],
          branchIds: scopeBranchIds,
          categoryId: categoryId || undefined,
          subcategoryId: subcategoryId || undefined,
        },
      }
    );

    return res.json({
      ok: true,
      data: rows,
      meta: {
        scope: "USER_SCOPE_ALL",
        page,
        limit,
        total: Number(countRow?.total || 0),
        branch_ids: scopeBranchIds,
      },
    });
  } catch (e) {
    logPos(req, "error", "listProductsForPos error", { err: e.message });
    return res.status(500).json({ ok: false, code: "POS_PRODUCTS_ERROR", message: e.message });
  }
}

/* =========================
   GET /pos/suggestions
   Autocomplete inteligente (Meilisearch + sinónimos + typo tolerance)
   Scope de branches = branches del user logueado.
   Barcode/SKU → no sugiere (usa lector directo por /products).
========================= */
async function listSuggestionsForPos(req, res) {
  req._rid = req._rid || rid(req);

  try {
    const admin = isAdminReq(req);
    const explicit = resolveExplicitPosContext(req);
    const allowedBranchIds = normalizeBranchIds(req?.user?.branches);

    if (!admin && !allowedBranchIds.length) {
      return res.status(403).json({
        ok: false,
        code: "NO_BRANCH_SCOPE",
        message: "El usuario no tiene branches asignadas.",
      });
    }

    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || "8", 10), 1), 15);

    if (!q || q.length < 2) return res.json({ ok: true, items: [] });
    // Códigos → sin autocomplete (el scanner/Enter ya ejecuta búsqueda exacta)
    if (looksLikeCodeQuery(q)) return res.json({ ok: true, items: [] });

    const smartBranchIds = await resolveBranchIdsForSmartSearch(req, explicit);

    // Vía Meilisearch (preferida)
    if (searchService?.isConfigured?.() && smartBranchIds.length) {
      try {
        const arrs = await Promise.all(
          smartBranchIds.map((bid) =>
            searchService
              .searchSuggestions({ branch_id: bid, q, limit: Math.max(limit, 10) })
              .catch(() => [])
          )
        );

        const seenNames = new Set();
        const seenIds = new Set();
        const items = [];
        const maxLen = arrs.reduce((m, a) => Math.max(m, (a || []).length), 0);

        for (let i = 0; i < maxLen && items.length < limit; i++) {
          for (const a of arrs) {
            const s = (a || [])[i];
            if (!s) continue;
            const name = String(s.name || "").trim();
            const pid = toInt(s.product_id, 0);
            const key = name.toLowerCase();
            if (!name || !pid || seenNames.has(key) || seenIds.has(pid)) continue;
            seenNames.add(key);
            seenIds.add(pid);
            items.push({
              product_id: pid,
              name,
              brand: s.brand || null,
              model: s.model || null,
              category_id: toInt(s.category_id, 0) || null,
              category_name: s.category_name || null,
              subcategory_id: toInt(s.subcategory_id, 0) || null,
              subcategory_name: s.subcategory_name || null,
            });
            if (items.length >= limit) break;
          }
        }

        return res.json({ ok: true, items, _source: "meilisearch" });
      } catch (e) {
        logPos(req, "warn", "suggestions meili error → fallback SQL", { err: e?.message });
      }
    }

    // ── Fallback SQL: multi-word + scoring + JOIN con categorías ──
    const exact = q;
    const startsWith = `${q}%`;

    const sugAliases = [
      "p.name", "p.brand", "p.model", "p.sku", "p.code",
      "c.name", "s.name",
    ];
    const sugClauses = buildPosSearchClauses(q, sugAliases);

    // Si la query (después de filtrar stopwords) no deja palabras usables, devolvemos vacío.
    if (!sugClauses.wordCount) {
      return res.json({ ok: true, items: [], _source: "sql" });
    }

    const sugScoreBoost = `
      + (CASE WHEN p.name = :exact THEN 10 ELSE 0 END)
      + (CASE WHEN p.name LIKE :startsWith THEN 5 ELSE 0 END)
    `;

    let sql;
    let params;

    if (smartBranchIds.length) {
      sql = `
        SELECT
          p.id AS product_id,
          p.name, p.brand, p.model,
          p.category_id, p.subcategory_id,
          c.name AS category_name,
          s.name AS subcategory_name,
          (${sugClauses.scoreExpr}${sugScoreBoost}) AS match_score
        FROM products p
        INNER JOIN stock_balances sb ON sb.product_id = p.id
        INNER JOIN warehouses w ON w.id = sb.warehouse_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN subcategories s ON s.id = p.subcategory_id
        WHERE p.is_active = 1
          ${sugClauses.whereClause}
          AND w.branch_id IN (:branchIds)
        GROUP BY p.id
        ORDER BY match_score DESC, p.name ASC
        LIMIT :limit
      `;
      params = {
        ...sugClauses.replacements,
        exact, startsWith,
        branchIds: smartBranchIds,
        limit,
      };
    } else {
      sql = `
        SELECT
          p.id AS product_id,
          p.name, p.brand, p.model,
          p.category_id, p.subcategory_id,
          c.name AS category_name,
          s.name AS subcategory_name,
          (${sugClauses.scoreExpr}${sugScoreBoost}) AS match_score
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN subcategories s ON s.id = p.subcategory_id
        WHERE p.is_active = 1
          ${sugClauses.whereClause}
        ORDER BY match_score DESC, p.name ASC
        LIMIT :limit
      `;
      params = {
        ...sugClauses.replacements,
        exact, startsWith,
        limit,
      };
    }

    const [rows] = await sequelize.query(sql, { replacements: params });

    const seen = new Set();
    const items = [];
    for (const r of rows || []) {
      const name = String(r.name || "").trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      items.push({
        product_id: toInt(r.product_id, 0) || null,
        name,
        brand: r.brand || null,
        model: r.model || null,
        category_id: toInt(r.category_id, 0) || null,
        category_name: r.category_name || null,
        subcategory_id: toInt(r.subcategory_id, 0) || null,
        subcategory_name: r.subcategory_name || null,
      });
      if (items.length >= limit) break;
    }

    return res.json({ ok: true, items, _source: "sql" });
  } catch (e) {
    logPos(req, "error", "listSuggestionsForPos error", { err: e.message });
    return res.status(500).json({ ok: false, code: "POS_SUGGESTIONS_ERROR", message: e.message });
  }
}

/* =========================
   POST /pos/sales
========================= */
async function createSale(req, res) {
  req._rid = req._rid || rid(req);

  let t;
  let fiscalSnapshot = null;
  let currentCashRegister = null;
  let sale = null;

  try {
    const admin = isAdminReq(req);
    if (admin) logPos(req, "info", "createSale admin allowed");

    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const payments = Array.isArray(body.payments) ? body.payments : [];

    console.log("[POS][createSale][body]", JSON.stringify(body, null, 2));

    const extra = body.extra && typeof body.extra === "object" ? body.extra : {};
    const c =
      extra.customer && typeof extra.customer === "object"
        ? extra.customer
        : body.customer && typeof body.customer === "object"
          ? body.customer
          : {};

    const p0 = payments[0] && typeof payments[0] === "object" ? payments[0] : {};

    function pickFirst(...vals) {
      for (const v of vals) {
        const s = String(v ?? "").trim();
        if (s) return s;
      }
      return "";
    }

    function normalizePhone(v) {
      const s = String(v ?? "").trim();
      if (!s) return "";
      return s.replace(/[^\d+]/g, "");
    }

    const first = pickFirst(c.first_name, c.firstname, c.firstName, c.nombre);
    const last = pickFirst(c.last_name, c.lastname, c.lastName, c.apellido);
    const fullName = `${first} ${last}`.trim();

    const customer_name =
      pickFirst(
        body.customer_name,
        c.customer_name,
        c.name,
        c.full_name,
        c.fullName,
        c.razon_social,
        c.razonSocial,
        fullName,
        p0.customer_name
      ) || "Consumidor Final";

    const customer_doc =
      pickFirst(
        body.customer_doc,
        c.customer_doc,
        c.doc,
        c.dni,
        c.cuit,
        c.cuil,
        c.document,
        c.documento,
        p0.customer_doc,
        p0.doc,
        p0.dni,
        p0.cuit,
        p0.cuil
      ) || null;

    const customer_phone =
      normalizePhone(
        pickFirst(
          body.customer_phone,
          c.customer_phone,
          c.phone,
          c.tel,
          c.telefono,
          c.celular,
          c.mobile,
          c.whatsapp,
          c.wa,
          p0.customer_phone,
          p0.phone,
          p0.tel,
          p0.telefono,
          p0.whatsapp,
          p0.wa
        )
      ) || null;

    const note = body.note || null;

    console.log("[POS][createSale][customer resolved]", {
      customer_name,
      customer_doc,
      customer_phone,
    });

    if (!req.user?.id) {
      logPos(req, "warn", "createSale blocked: unauthorized");
      return res.status(401).json({
        ok: false,
        code: "UNAUTHORIZED",
        message: "No autenticado",
      });
    }

    const userId = toInt(req.user.id, 0);
    const userBranchId = toInt(req.user.branch_id, 0);

    const explicit = resolveExplicitPosContext(req);
    const ctx = resolvePosContext(req);

    const resolvedBranchId = admin
      ? toInt(explicit.branchId, 0) || userBranchId || toInt(ctx.branchId, 0) || 0
      : userBranchId;

    if (!resolvedBranchId) {
      logPos(req, "warn", "createSale blocked: missing branch", {
        admin,
        userBranchId,
        explicit,
        ctx,
      });
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: admin
          ? "Admin: falta branch_id explícito (query/body) o branch_id en el usuario."
          : "Falta branch_id (sucursal). El usuario no tiene sucursal asignada.",
      });
    }

    let resolvedWarehouseId = admin
      ? toInt(explicit.warehouseId, 0) || toInt(ctx.warehouseId, 0) || 0
      : toInt(ctx.warehouseId, 0) || 0;

    if (!admin && !resolvedWarehouseId && resolvedBranchId) {
      resolvedWarehouseId = await resolveWarehouseForBranch(resolvedBranchId);
    }
    if (admin && !resolvedWarehouseId && resolvedBranchId) {
      resolvedWarehouseId = await resolveWarehouseForBranch(resolvedBranchId);
    }

    if (!resolvedWarehouseId) {
      logPos(req, "warn", "createSale blocked: missing warehouse", {
        resolvedBranchId,
        admin,
        explicit,
        ctx,
      });
      return res.status(400).json({
        ok: false,
        code: "WAREHOUSE_REQUIRED",
        message:
          "Falta warehouse_id (depósito). Enviá warehouse_id o asegurate de tener al menos 1 depósito creado para la sucursal.",
      });
    }

    if (admin) {
      const ok = await assertWarehouseBelongsToBranch(resolvedWarehouseId, resolvedBranchId);
      if (!ok) {
        return res.status(400).json({
          ok: false,
          code: "WAREHOUSE_BRANCH_MISMATCH",
          message: "El warehouse_id no pertenece al branch_id indicado.",
        });
      }
    }

    if (items.length === 0) {
      logPos(req, "warn", "createSale blocked: empty items");
      return res.status(400).json({
        ok: false,
        code: "EMPTY_ITEMS",
        message: "Venta sin items",
      });
    }

    const normalizedItems = items.map((i) => ({
      product_id: toNum(i.product_id),
      quantity: toNum(i.quantity),
      unit_price: toNum(i.unit_price),
    }));

    console.log("[POS][createSale][normalizedItems]", normalizedItems);
    console.log("[POS][createSale][payments raw]", payments);

    for (const it of normalizedItems) {
      if (!it.product_id) {
        throw Object.assign(new Error("Item inválido: falta product_id"), {
          httpStatus: 400,
          code: "INVALID_ITEM",
        });
      }
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
        throw Object.assign(new Error(`Item inválido: quantity=${it.quantity}`), {
          httpStatus: 400,
          code: "INVALID_ITEM",
        });
      }
      if (!Number.isFinite(it.unit_price) || it.unit_price <= 0) {
        throw Object.assign(new Error(`Item inválido: unit_price=${it.unit_price}`), {
          httpStatus: 400,
          code: "INVALID_ITEM",
        });
      }
    }

    let subtotal = 0;
    for (const it of normalizedItems) subtotal += it.quantity * it.unit_price;

    logPos(req, "info", "createSale start", {
      admin,
      resolvedBranchId,
      resolvedWarehouseId,
      items: normalizedItems.length,
      payments: payments.length,
      subtotal,
      customer_name,
      customer_phone,
      customer_doc,
    });

    t = await sequelize.transaction();

    currentCashRegister = await getCurrentOpenCashRegister({
      branch_id: resolvedBranchId,
      transaction: t,
    });

    console.log("[POS][createSale][cashRegister]", currentCashRegister);

    fiscalSnapshot = resolveFiscalSnapshot({
      body,
      cashRegister: currentCashRegister,
    });

    console.log("[POS][createSale][fiscalSnapshot]", JSON.stringify(fiscalSnapshot, null, 2));

    sale = await Sale.create(
      {
        branch_id: resolvedBranchId,
        cash_register_id: currentCashRegister?.id || null,
        user_id: userId,
        status: "PAID",
        sale_number: null,

        customer_name,
        customer_phone,
        customer_doc,

        customer_email: fiscalSnapshot?.customer_email || null,
        customer_address: fiscalSnapshot?.customer_address || null,
        customer_doc_type: fiscalSnapshot?.customer_doc_type || null,
        customer_tax_condition: fiscalSnapshot?.customer_tax_condition || null,
        invoice_mode: fiscalSnapshot?.invoice_mode || null,
        invoice_type: fiscalSnapshot?.invoice_type || null,
        customer_type: fiscalSnapshot?.customer_type || null,
        fiscal_status:
          fiscalSnapshot?.invoice_mode && fiscalSnapshot.invoice_mode !== "NO_FISCAL"
            ? "PENDING"
            : "NOT_REQUESTED",

        subtotal,
        discount_total: 0,
        tax_total: 0,
        total: subtotal,
        paid_total: 0,
        change_total: 0,
        note,
        sold_at: new Date(),
      },
      { transaction: t }
    );

    console.log("[POS][createSale][sale created]", sale?.toJSON?.() || sale);

    const movement = await StockMovement.create(
      {
        type: "out",
        warehouse_id: resolvedWarehouseId,
        ref_type: "sale",
        ref_id: String(sale.id),
        note: `Venta POS #${sale.id}`,
        created_by: userId,
      },
      { transaction: t }
    );

    console.log("[POS][createSale][movement created]", movement?.toJSON?.() || movement);

    for (const it of normalizedItems) {
      console.log("[POS][createSale][item loop start]", it);

      const p = await Product.findByPk(it.product_id, { transaction: t });
      if (!p) {
        throw Object.assign(new Error(`Producto no existe: id=${it.product_id}`), {
          httpStatus: 400,
          code: "PRODUCT_NOT_FOUND",
        });
      }

      const sb = await StockBalance.findOne({
        where: {
          warehouse_id: resolvedWarehouseId,
          product_id: it.product_id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      console.log("[POS][createSale][stockBalance before]", sb?.toJSON?.() || sb);

      if (!sb) {
        throw Object.assign(
          new Error(`No existe stock_balance para producto ${p.sku || p.id} en depósito ${resolvedWarehouseId}`),
          {
            httpStatus: 409,
            code: "STOCK_BALANCE_MISSING",
          }
        );
      }

      if (Number(sb.qty) < it.quantity) {
        throw Object.assign(
          new Error(`Stock insuficiente (depósito ${resolvedWarehouseId}) para producto ${p.sku || p.id}`),
          {
            httpStatus: 409,
            code: "STOCK_INSUFFICIENT",
          }
        );
      }

      await sb.update({ qty: literal(`qty - ${it.quantity}`) }, { transaction: t });

      const lineTotal = it.quantity * it.unit_price;

      await SaleItem.create(
        {
          sale_id: sale.id,
          product_id: it.product_id,
          warehouse_id: resolvedWarehouseId,
          quantity: it.quantity,
          unit_price: it.unit_price,
          discount_amount: 0,
          tax_amount: 0,
          line_total: lineTotal,
          product_name_snapshot: p.name,
          product_sku_snapshot: p.sku,
          product_barcode_snapshot: p.barcode,
        },
        { transaction: t }
      );

      await StockMovementItem.create(
        {
          movement_id: movement.id,
          product_id: it.product_id,
          qty: it.quantity,
          unit_cost: p.cost || null,
        },
        { transaction: t }
      );

      console.log("[POS][createSale][item loop done]", {
        product_id: it.product_id,
        quantity: it.quantity,
        unit_price: it.unit_price,
        lineTotal,
      });
    }

    let totalPaid = 0;
    const resolvedPayments = [];

    for (const pay of payments) {
      console.log("[POS][createSale][payment input]", pay);

      const resolvedPay = await resolveSalePaymentInput({
        pay,
        branchId: resolvedBranchId,
        paymentsCount: payments.length,
        transaction: t,
      });

      console.log("[POS][createSale][payment resolved]", resolvedPay);

      resolvedPayments.push(resolvedPay);
      totalPaid += resolvedPay.amount;

      await insertPaymentRow({
        saleId: sale.id,
        paymentResolved: resolvedPay,
        transaction: t,
      });
    }

    if (payments.length === 0) totalPaid = subtotal;

    // Detectar divergencia entre lo cobrado y lo que suman los items.
    // Con el frontend corregido esto nunca debería ocurrir; si ocurre
    // es señal de un bug de precios en el cliente.
    const priceDivergence = Math.abs(totalPaid - subtotal);
    if (priceDivergence > 1) {
      logPos(req, "warn", "createSale PRICE_MISMATCH: items_total != paid_total", {
        sale_id: sale.id,
        subtotal,
        totalPaid,
        divergence: priceDivergence,
        items: normalizedItems.map((i) => ({
          product_id: i.product_id,
          qty: i.quantity,
          unit_price: i.unit_price,
        })),
        payments: resolvedPayments.map((p) => ({
          method_id: p.payment_method_id,
          amount: p.amount,
        })),
      });
    }

    sale.paid_total = totalPaid;
    sale.change_total = totalPaid - subtotal;
    await sale.save({ transaction: t });

    console.log("[POS][createSale][sale totals updated]", {
      sale_id: sale.id,
      subtotal,
      totalPaid,
      change_total: sale.change_total,
    });

    const fiscalDocument = await maybeCreateFiscalDocument({
      sale,
      snapshot: fiscalSnapshot,
      transaction: t,
    });

    console.log("[POS][createSale][fiscalDocument]", fiscalDocument?.toJSON?.() || fiscalDocument || null);

    await t.commit();

    logPos(req, "info", "createSale done", {
      sale_id: sale.id,
      cash_register_id: sale.cash_register_id || null,
      fiscal_document_id: fiscalDocument?.id || sale.fiscal_document_id || null,
      resolvedBranchId,
      resolvedWarehouseId,
      totalPaid,
      change: sale.change_total,
    });

    return res.json({
      ok: true,
      data: {
        sale_id: sale.id,
        branch_id: sale.branch_id,
        cash_register_id: sale.cash_register_id || null,
        fiscal_document_id: fiscalDocument?.id || sale.fiscal_document_id || null,
        fiscal_status: sale.fiscal_status || (fiscalDocument ? "PENDING" : "NOT_REQUESTED"),
        user_id: sale.user_id,
        warehouse_id: resolvedWarehouseId,

        customer_name: sale.customer_name,
        customer_phone: sale.customer_phone,
        customer_doc: sale.customer_doc,

        subtotal: sale.subtotal,
        total: sale.total,
        paid_total: sale.paid_total,
        change_total: sale.change_total,
        status: sale.status,
        sold_at: sale.sold_at,
      },
    });
  } catch (e) {
    try {
      if (t) await t.rollback();
    } catch (rbErr) {
      console.error("[POS][createSale][rollback error]", {
        message: rbErr?.message || null,
        stack: rbErr?.stack || null,
      });
    }

    const status = Number(e?.httpStatus) || Number(e?.status) || Number(e?.response?.status) || 500;
    const code = e?.code || "POS_CREATE_SALE_ERROR";

    const errorPayload = {
      ok: false,
      code,
      message: e?.message || "Error al registrar la venta",
      detail: {
        name: e?.name || null,
        stack: e?.stack || null,

        parent_message: e?.parent?.message || null,
        parent_code: e?.parent?.code || null,
        parent_errno: e?.parent?.errno || null,
        parent_sql_state: e?.parent?.sqlState || null,
        sql_message: e?.parent?.sqlMessage || null,
        sql: e?.parent?.sql || e?.sql || null,

        original_message: e?.original?.message || null,
        original_code: e?.original?.code || null,
        original_errno: e?.original?.errno || null,
        original_sql_state: e?.original?.sqlState || null,

        errors: Array.isArray(e?.errors)
          ? e.errors.map((x) => ({
              message: x?.message || null,
              path: x?.path || null,
              value: x?.value ?? null,
              type: x?.type || null,
              validatorKey: x?.validatorKey || null,
            }))
          : [],

        context: {
          sale_id: sale?.id || null,
          cash_register_id: currentCashRegister?.id || null,
          fiscalSnapshot,
          body: req?.body || null,
        },
      },
    };

    console.error("[POS][createSale][ERROR]", {
      rid: req._rid,
      status,
      code,
      message: errorPayload.message,
      detail: errorPayload.detail,
    });

    logPos(req, "error", "createSale error", {
      code,
      err: e?.message || null,
      status,
      sale_id: sale?.id || null,
      cash_register_id: currentCashRegister?.id || null,
      parent_message: e?.parent?.message || null,
      sql_message: e?.parent?.sqlMessage || null,
      original_message: e?.original?.message || null,
    });

    return res.status(status).json(errorPayload);
  }
}

/* ======================================================================
   DEVOLUCIONES + CAMBIOS
   ====================================================================== */

async function assertReturnsTablesExist() {
  const [[r1]] = await sequelize.query(`SHOW TABLES LIKE 'sale_returns'`);
  const [[r2]] = await sequelize.query(`SHOW TABLES LIKE 'sale_return_items'`);
  const [[r3]] = await sequelize.query(`SHOW TABLES LIKE 'sale_return_payments'`);
  if (!r1 || !r2 || !r3) {
    const err = new Error(
      "Faltan tablas de devoluciones (sale_returns / sale_return_items / sale_return_payments). Ejecutá el SQL primero."
    );
    err.httpStatus = 400;
    err.code = "RETURNS_TABLES_MISSING";
    throw err;
  }
}

async function assertExchangesTableExist() {
  const [[r]] = await sequelize.query(`SHOW TABLES LIKE 'sale_exchanges'`);
  if (!r) {
    const err = new Error("Falta tabla de cambios (sale_exchanges). Ejecutá el SQL primero.");
    err.httpStatus = 400;
    err.code = "EXCHANGES_TABLE_MISSING";
    throw err;
  }
}

function calcReturnTotal(items) {
  let total = 0;
  for (const it of items || []) {
    total += toNum(it.qty) * toNum(it.unit_price);
  }
  return Number(total || 0);
}

async function createSaleReturn(req, res) {
  req._rid = req._rid || rid(req);

  let t;
  try {
    await assertReturnsTablesExist();

    if (!req.user?.id) {
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "No autenticado" });
    }

    const admin = isAdminReq(req);
    const userId = toInt(req.user.id, 0);
    const userBranchId = toInt(req.user.branch_id, 0);

    const body = req.body || {};
    const saleId = toInt(body.sale_id || body.id || req.params?.id, 0);
    const restock = parseBool(body.restock, true);
    const reason = body.reason ? String(body.reason).slice(0, 255) : null;
    const note = body.note ? String(body.note).slice(0, 255) : null;

    const items = Array.isArray(body.items) ? body.items : [];
    const payments = Array.isArray(body.payments) ? body.payments : [];

    if (!saleId) return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "sale_id requerido" });
    if (!items.length) {
      return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "items requerido (array no vacío)" });
    }
    if (!payments.length) {
      return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "payments requerido (array no vacío)" });
    }

    t = await sequelize.transaction();

    const sale = await Sale.findByPk(saleId, {
      include: [{ model: SaleItem }, { model: Payment }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "SALE_NOT_FOUND", message: "Venta no encontrada" });
    }

    if (!admin) {
      if (!userBranchId) {
        await t.rollback();
        return res
          .status(400)
          .json({ ok: false, code: "BRANCH_REQUIRED", message: "El usuario no tiene sucursal asignada" });
      }
      if (toInt(sale.branch_id, 0) !== userBranchId) {
        await t.rollback();
        return res.status(403).json({
          ok: false,
          code: "CROSS_BRANCH_SALE",
          message: "No podés operar una venta de otra sucursal",
        });
      }
    }

    const normalizedItems = items.map((it) => ({
      product_id: toInt(it.product_id, 0),
      warehouse_id: toInt(it.warehouse_id, 0),
      qty: toNum(it.qty),
      unit_price: toNum(it.unit_price),
    }));

    for (const it of normalizedItems) {
      if (!it.product_id || !it.warehouse_id) {
        const e = new Error("Item devolución inválido: product_id y warehouse_id requeridos");
        e.httpStatus = 400;
        e.code = "INVALID_RETURN_ITEM";
        throw e;
      }
      if (!Number.isFinite(it.qty) || it.qty <= 0) {
        const e = new Error(`Item devolución inválido: qty=${it.qty}`);
        e.httpStatus = 400;
        e.code = "INVALID_RETURN_ITEM";
        throw e;
      }
      if (!Number.isFinite(it.unit_price) || it.unit_price < 0) {
        const e = new Error(`Item devolución inválido: unit_price=${it.unit_price}`);
        e.httpStatus = 400;
        e.code = "INVALID_RETURN_ITEM";
        throw e;
      }
    }

    const totalReturn = calcReturnTotal(normalizedItems);

    const paidTotal = Number(sale.paid_total || 0);
    if (!(totalReturn > 0) || totalReturn - paidTotal > 0.00001) {
      const e = new Error("Monto de devolución inválido (supera lo pagado o es 0)");
      e.httpStatus = 400;
      e.code = "INVALID_RETURN_AMOUNT";
      throw e;
    }

    const paySum = payments.reduce((a, p) => a + toNum(p.amount), 0);
    if (Math.abs(paySum - totalReturn) > 0.01) {
      const e = new Error("Los pagos de devolución no coinciden con el monto a devolver");
      e.httpStatus = 400;
      e.code = "RETURN_PAYMENTS_MISMATCH";
      throw e;
    }

    const [insRet] = await sequelize.query(
      `
      INSERT INTO sale_returns
        (sale_id, amount, restock, reason, note, created_by, created_at)
      VALUES
        (:sale_id, :amount, :restock, :reason, :note, :created_by, NOW())
      `,
      {
        transaction: t,
        replacements: {
          sale_id: saleId,
          amount: totalReturn,
          restock: restock ? 1 : 0,
          reason,
          note,
          created_by: userId || null,
        },
      }
    );

    const returnId = toInt(insRet?.insertId, 0);
    if (!returnId) {
      const e = new Error("No se pudo crear sale_returns (insertId vacío)");
      e.httpStatus = 500;
      e.code = "RETURN_INSERT_FAILED";
      throw e;
    }

    for (const it of normalizedItems) {
      await sequelize.query(
        `
        INSERT INTO sale_return_items
          (return_id, product_id, warehouse_id, qty, unit_price, line_total, created_at)
        VALUES
          (:return_id, :product_id, :warehouse_id, :qty, :unit_price, :line_total, NOW())
        `,
        {
          transaction: t,
          replacements: {
            return_id: returnId,
            product_id: it.product_id,
            warehouse_id: it.warehouse_id,
            qty: it.qty,
            unit_price: it.unit_price,
            line_total: it.qty * it.unit_price,
          },
        }
      );

      if (restock) {
        const mv = await StockMovement.create(
          {
            type: "in",
            warehouse_id: it.warehouse_id,
            ref_type: "sale_return",
            ref_id: String(returnId),
            note: `Devolución de venta #${saleId}`,
            created_by: userId,
          },
          { transaction: t }
        );

        const p = await Product.findByPk(it.product_id, { transaction: t });
        await StockMovementItem.create(
          {
            movement_id: mv.id,
            product_id: it.product_id,
            qty: it.qty,
            unit_cost: p?.cost ?? null,
          },
          { transaction: t }
        );

        const sb = await StockBalance.findOne({
          where: { warehouse_id: it.warehouse_id, product_id: it.product_id },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (sb) {
          await sb.update({ qty: literal(`qty + ${it.qty}`) }, { transaction: t });
        } else {
          await StockBalance.create(
            { warehouse_id: it.warehouse_id, product_id: it.product_id, qty: it.qty },
            { transaction: t }
          );
        }
      }
    }

    for (const p of payments) {
      const resolvedPay = await resolveSalePaymentInput({
        pay: p,
        branchId: toInt(sale.branch_id, 0),
        paymentsCount: payments.length,
        transaction: t,
      });

      await insertSaleReturnPaymentRow({
        returnId,
        paymentResolved: resolvedPay,
        transaction: t,
      });
    }

    if (Math.abs(totalReturn - paidTotal) <= 0.01) {
      await sale.update({ status: "REFUNDED" }, { transaction: t });
    }

    await t.commit();

    return res.json({
      ok: true,
      data: {
        return_id: returnId,
        sale_id: saleId,
        amount: totalReturn,
        restock: restock ? 1 : 0,
        status_after: Math.abs(totalReturn - paidTotal) <= 0.01 ? "REFUNDED" : sale.status,
      },
      message: "Devolución registrada",
    });
  } catch (e) {
    if (t) await t.rollback();
    const status = e.httpStatus || 500;
    const code = e.code || "POS_RETURN_ERROR";
    logPos(req, "error", "createSaleReturn error", { code, err: e.message });
    return res.status(status).json({ ok: false, code, message: e.message });
  }
}

async function createSaleExchange(req, res) {
  req._rid = req._rid || rid(req);

  let t;
  try {
    await assertReturnsTablesExist();
    await assertExchangesTableExist();

    if (!req.user?.id) {
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "No autenticado" });
    }

    const admin = isAdminReq(req);
    if (admin) logPos(req, "info", "createSaleExchange admin allowed");

    const userId = toInt(req.user.id, 0);
    const userBranchId = toInt(req.user.branch_id, 0);

    const body = req.body || {};
    const saleId = toInt(body.sale_id || body.id || req.params?.id, 0);
    if (!saleId) return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "sale_id requerido" });

    const returnPayload = body.return || body.returnData || {};
    const newSalePayload = body.new_sale || body.newSale || body.newSaleData || {};
    const exchangeNote = body.note ? String(body.note).slice(0, 255) : null;

    if (!Array.isArray(returnPayload.items) || !returnPayload.items.length) {
      return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "return.items requerido" });
    }
    if (!Array.isArray(returnPayload.payments) || !returnPayload.payments.length) {
      return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "return.payments requerido" });
    }
    if (!Array.isArray(newSalePayload.items) || !newSalePayload.items.length) {
      return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "new_sale.items requerido" });
    }

    t = await sequelize.transaction();

    const sale = await Sale.findByPk(saleId, {
      include: [{ model: SaleItem }, { model: Payment }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "SALE_NOT_FOUND", message: "Venta no encontrada" });
    }

    if (!admin) {
      if (!userBranchId) {
        await t.rollback();
        return res
          .status(400)
          .json({ ok: false, code: "BRANCH_REQUIRED", message: "El usuario no tiene sucursal asignada" });
      }
      if (toInt(sale.branch_id, 0) !== userBranchId) {
        await t.rollback();
        return res.status(403).json({
          ok: false,
          code: "CROSS_BRANCH_SALE",
          message: "No podés operar una venta de otra sucursal",
        });
      }
    }

    const restock = parseBool(returnPayload.restock, true);
    const reason = returnPayload.reason ? String(returnPayload.reason).slice(0, 255) : null;
    const note = returnPayload.note ? String(returnPayload.note).slice(0, 255) : null;

    const normalizedItems = returnPayload.items.map((it) => ({
      product_id: toInt(it.product_id, 0),
      warehouse_id: toInt(it.warehouse_id, 0),
      qty: toNum(it.qty),
      unit_price: toNum(it.unit_price),
    }));

    for (const it of normalizedItems) {
      if (!it.product_id || !it.warehouse_id) {
        const e = new Error("Item devolución inválido: product_id y warehouse_id requeridos");
        e.httpStatus = 400;
        e.code = "INVALID_RETURN_ITEM";
        throw e;
      }
      if (!Number.isFinite(it.qty) || it.qty <= 0) {
        const e = new Error(`Item devolución inválido: qty=${it.qty}`);
        e.httpStatus = 400;
        e.code = "INVALID_RETURN_ITEM";
        throw e;
      }
      if (!Number.isFinite(it.unit_price) || it.unit_price < 0) {
        const e = new Error(`Item devolución inválido: unit_price=${it.unit_price}`);
        e.httpStatus = 400;
        e.code = "INVALID_RETURN_ITEM";
        throw e;
      }
    }

    const totalReturn = calcReturnTotal(normalizedItems);
    const paidTotal = Number(sale.paid_total || 0);

    if (!(totalReturn > 0) || totalReturn - paidTotal > 0.00001) {
      const e = new Error("Monto de devolución inválido (supera lo pagado o es 0)");
      e.httpStatus = 400;
      e.code = "INVALID_RETURN_AMOUNT";
      throw e;
    }

    const paySum = (returnPayload.payments || []).reduce((a, p) => a + toNum(p.amount), 0);
    if (Math.abs(paySum - totalReturn) > 0.01) {
      const e = new Error("Los pagos de devolución no coinciden con el monto a devolver");
      e.httpStatus = 400;
      e.code = "RETURN_PAYMENTS_MISMATCH";
      throw e;
    }

    const [insRet] = await sequelize.query(
      `
      INSERT INTO sale_returns
        (sale_id, amount, restock, reason, note, created_by, created_at)
      VALUES
        (:sale_id, :amount, :restock, :reason, :note, :created_by, NOW())
      `,
      {
        transaction: t,
        replacements: {
          sale_id: saleId,
          amount: totalReturn,
          restock: restock ? 1 : 0,
          reason,
          note,
          created_by: userId || null,
        },
      }
    );

    const returnId = toInt(insRet?.insertId, 0);
    if (!returnId) {
      const e = new Error("No se pudo crear sale_returns (insertId vacío)");
      e.httpStatus = 500;
      e.code = "RETURN_INSERT_FAILED";
      throw e;
    }

    for (const it of normalizedItems) {
      await sequelize.query(
        `
        INSERT INTO sale_return_items
          (return_id, product_id, warehouse_id, qty, unit_price, line_total, created_at)
        VALUES
          (:return_id, :product_id, :warehouse_id, :qty, :unit_price, :line_total, NOW())
        `,
        {
          transaction: t,
          replacements: {
            return_id: returnId,
            product_id: it.product_id,
            warehouse_id: it.warehouse_id,
            qty: it.qty,
            unit_price: it.unit_price,
            line_total: it.qty * it.unit_price,
          },
        }
      );

      if (restock) {
        const mv = await StockMovement.create(
          {
            type: "in",
            warehouse_id: it.warehouse_id,
            ref_type: "sale_return",
            ref_id: String(returnId),
            note: `Devolución (cambio) de venta #${saleId}`,
            created_by: userId,
          },
          { transaction: t }
        );

        const p = await Product.findByPk(it.product_id, { transaction: t });
        await StockMovementItem.create(
          {
            movement_id: mv.id,
            product_id: it.product_id,
            qty: it.qty,
            unit_cost: p?.cost ?? null,
          },
          { transaction: t }
        );

        const sb = await StockBalance.findOne({
          where: { warehouse_id: it.warehouse_id, product_id: it.product_id },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (sb) {
          await sb.update({ qty: literal(`qty + ${it.qty}`) }, { transaction: t });
        } else {
          await StockBalance.create(
            { warehouse_id: it.warehouse_id, product_id: it.product_id, qty: it.qty },
            { transaction: t }
          );
        }
      }
    }

    for (const p of returnPayload.payments || []) {
      const resolvedPay = await resolveSalePaymentInput({
        pay: p,
        branchId: toInt(sale.branch_id, 0),
        paymentsCount: (returnPayload.payments || []).length,
        transaction: t,
      });

      await insertSaleReturnPaymentRow({
        returnId,
        paymentResolved: resolvedPay,
        transaction: t,
      });
    }

    if (Math.abs(totalReturn - paidTotal) <= 0.01) {
      await sale.update({ status: "REFUNDED" }, { transaction: t });
    }

    const items2 = Array.isArray(newSalePayload.items) ? newSalePayload.items : [];
    const pays2 = Array.isArray(newSalePayload.payments) ? newSalePayload.payments : [];

    const extra2 = newSalePayload.extra && typeof newSalePayload.extra === "object" ? newSalePayload.extra : {};
    const c2 = extra2.customer && typeof extra2.customer === "object" ? extra2.customer : newSalePayload.customer || {};

    const first2 = String(c2.first_name || "").trim();
    const last2 = String(c2.last_name || "").trim();
    const fullName2 = String(`${first2} ${last2}`.trim());

    const customer_name2 =
      String(newSalePayload.customer_name || "").trim() ||
      fullName2 ||
      String(c2.name || "").trim() ||
      "Consumidor Final";

    const customer_phone2 =
      String(newSalePayload.customer_phone || "").trim() ||
      String(c2.phone || "").trim() ||
      String(c2.whatsapp || "").trim() ||
      null;

    const customer_doc2 =
      String(newSalePayload.customer_doc || "").trim() ||
      String(c2.doc || "").trim() ||
      String(c2.dni || "").trim() ||
      String(c2.cuit || "").trim() ||
      null;

    const note2 = newSalePayload.note || null;

    const normalizedItems2 = items2.map((i) => ({
      product_id: toNum(i.product_id),
      quantity: toNum(i.quantity),
      unit_price: toNum(i.unit_price),
    }));

    for (const it of normalizedItems2) {
      if (!it.product_id) {
        const e = new Error("Item inválido (cambio): falta product_id");
        e.httpStatus = 400;
        e.code = "INVALID_ITEM";
        throw e;
      }
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
        const e = new Error(`Item inválido (cambio): quantity=${it.quantity}`);
        e.httpStatus = 400;
        e.code = "INVALID_ITEM";
        throw e;
      }
      if (!Number.isFinite(it.unit_price) || it.unit_price <= 0) {
        const e = new Error(`Item inválido (cambio): unit_price=${it.unit_price}`);
        e.httpStatus = 400;
        e.code = "INVALID_ITEM";
        throw e;
      }
    }

    const { warehouseId: ctxWh2 } = resolvePosContext(req);
    let resolvedWarehouseId2 = toInt(ctxWh2, 0);
    if (!resolvedWarehouseId2) resolvedWarehouseId2 = await resolveWarehouseForBranch(userBranchId);
    if (!resolvedWarehouseId2) {
      const e = new Error("Falta warehouse_id para nueva venta (cambio).");
      e.httpStatus = 400;
      e.code = "WAREHOUSE_REQUIRED";
      throw e;
    }

    let subtotal2 = 0;
    for (const it of normalizedItems2) subtotal2 += it.quantity * it.unit_price;

    const currentCashRegister2 = await getCurrentOpenCashRegister({
      branch_id: userBranchId,
      transaction: t,
    });

    const newSale = await Sale.create(
      {
        branch_id: userBranchId,
        cash_register_id: currentCashRegister2?.id || null,
        user_id: userId,
        status: "PAID",
        sale_number: null,

        customer_name: customer_name2,
        customer_phone: customer_phone2,
        customer_doc: customer_doc2,

        subtotal: subtotal2,
        discount_total: 0,
        tax_total: 0,
        total: subtotal2,
        paid_total: 0,
        change_total: 0,
        note: note2,
        sold_at: new Date(),
      },
      { transaction: t }
    );

    const mvOut = await StockMovement.create(
      {
        type: "out",
        warehouse_id: resolvedWarehouseId2,
        ref_type: "sale_exchange",
        ref_id: String(newSale.id),
        note: `Cambio: venta nueva #${newSale.id} (orig #${saleId})`,
        created_by: userId,
      },
      { transaction: t }
    );

    for (const it of normalizedItems2) {
      const p = await Product.findByPk(it.product_id, { transaction: t });
      if (!p) {
        const e = new Error(`Producto no existe (cambio): id=${it.product_id}`);
        e.httpStatus = 400;
        e.code = "PRODUCT_NOT_FOUND";
        throw e;
      }

      const sb = await StockBalance.findOne({
        where: { warehouse_id: resolvedWarehouseId2, product_id: it.product_id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!sb) {
        const e = new Error(
          `No existe stock_balance (cambio) para producto ${p.sku || p.id} en depósito ${resolvedWarehouseId2}`
        );
        e.httpStatus = 409;
        e.code = "STOCK_BALANCE_MISSING";
        throw e;
      }

      if (Number(sb.qty) < it.quantity) {
        const e = new Error(`Stock insuficiente (cambio) para producto ${p.sku || p.id}`);
        e.httpStatus = 409;
        e.code = "STOCK_INSUFFICIENT";
        throw e;
      }

      await sb.update({ qty: literal(`qty - ${it.quantity}`) }, { transaction: t });

      const lineTotal = it.quantity * it.unit_price;

      await SaleItem.create(
        {
          sale_id: newSale.id,
          product_id: it.product_id,
          warehouse_id: resolvedWarehouseId2,
          quantity: it.quantity,
          unit_price: it.unit_price,
          discount_amount: 0,
          tax_amount: 0,
          line_total: lineTotal,
          product_name_snapshot: p.name,
          product_sku_snapshot: p.sku,
          product_barcode_snapshot: p.barcode,
        },
        { transaction: t }
      );

      await StockMovementItem.create(
        {
          movement_id: mvOut.id,
          product_id: it.product_id,
          qty: it.quantity,
          unit_cost: p.cost || null,
        },
        { transaction: t }
      );
    }

    let totalPaid2 = 0;
    for (const pay of pays2) {
      const resolvedPay = await resolveSalePaymentInput({
        pay,
        branchId: userBranchId,
        paymentsCount: pays2.length,
        transaction: t,
      });

      totalPaid2 += resolvedPay.amount;

      await insertPaymentRow({
        saleId: newSale.id,
        paymentResolved: resolvedPay,
        transaction: t,
      });
    }

    if (!pays2.length) totalPaid2 = subtotal2;

    newSale.paid_total = totalPaid2;
    newSale.change_total = totalPaid2 - subtotal2;
    await newSale.save({ transaction: t });

    const diff = Number(newSale.total || 0) - Number(totalReturn || 0);

    await sequelize.query(
      `
      INSERT INTO sale_exchanges
        (original_sale_id, return_id, new_sale_id, original_total, returned_amount, new_total, diff, note, created_by, created_at)
      VALUES
        (:orig_sale, :return_id, :new_sale, :orig_total, :returned_amount, :new_total, :diff, :note, :created_by, NOW())
      `,
      {
        transaction: t,
        replacements: {
          orig_sale: saleId,
          return_id: returnId,
          new_sale: newSale.id,
          orig_total: Number(sale.total || 0),
          returned_amount: Number(totalReturn || 0),
          new_total: Number(newSale.total || 0),
          diff,
          note: exchangeNote,
          created_by: userId || null,
        },
      }
    );

    await t.commit();

    return res.json({
      ok: true,
      message: "Cambio registrado",
      data: {
        original_sale_id: saleId,
        return_id: returnId,
        new_sale_id: newSale.id,
        returned_amount: totalReturn,
        new_total: Number(newSale.total || 0),
        diff,
      },
    });
  } catch (e) {
    if (t) await t.rollback();
    const status = e.httpStatus || 500;
    const code = e.code || "POS_EXCHANGE_ERROR";
    logPos(req, "error", "createSaleExchange error", { code, err: e.message });
    return res.status(status).json({ ok: false, code, message: e.message });
  }
}

module.exports = {
  getContext,
  listProductsForPos,
  listSuggestionsForPos,
  createSale,
  createSaleReturn,
  createSaleExchange,
};