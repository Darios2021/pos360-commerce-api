// ✅ COPY-PASTE FINAL COMPLETO
// src/services/paymentMethod.service.js

const { Op } = require("sequelize");
const { PaymentMethod } = require("../models");

/* =========================
   Utils
========================= */
function toInt(v, def = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : def;
}

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function parseBool(v, def = false) {
  if (v === undefined || v === null) return def;
  if (typeof v === "boolean") return v;

  const s = String(v).trim().toLowerCase();
  if (!s) return def;

  if (["1", "true", "t", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "f", "no", "n", "off"].includes(s)) return false;

  return def;
}

function cleanStr(v, maxLen = null) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

function cleanCode(v) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return s || null;
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function safeJsonObject(v, def = null) {
  if (v === undefined) return def;
  if (v === null || v === "") return null;

  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return isPlainObject(parsed) ? parsed : def;
    } catch {
      return def;
    }
  }

  return isPlainObject(v) ? v : def;
}

function safeJsonArray(v, def = null) {
  if (v === undefined) return def;
  if (v === null || v === "") return null;

  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : def;
    } catch {
      return def;
    }
  }

  return Array.isArray(v) ? v : def;
}

function normalizeDate(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;

  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function isPositiveOrZero(n) {
  return Number.isFinite(n) && n >= 0;
}

function isPositive(n) {
  return Number.isFinite(n) && n > 0;
}

function normalizeInstallmentPlan(raw) {
  const arr = safeJsonArray(raw, []);
  if (!arr) return null;

  const out = arr
    .map((x) => {
      const item = isPlainObject(x) ? x : {};
      const installments = Math.max(1, toInt(item.installments, 1));
      const pricing_mode = cleanStr(item.pricing_mode, 40)?.toUpperCase() || null;
      const surcharge_percent = toNum(item.surcharge_percent, 0);

      return {
        installments,
        pricing_mode,
        surcharge_percent,
      };
    })
    .filter((x) => x.installments >= 1);

  return out.length ? out : null;
}

function normalizeInputSchema(raw) {
  const obj = safeJsonObject(raw, null);
  if (obj) return obj;

  const arr = safeJsonArray(raw, null);
  if (arr) return { fields: arr };

  return null;
}

function normalizeMeta(raw) {
  return safeJsonObject(raw, null);
}

/* =========================
   Constants
========================= */
const ALLOWED_KIND = ["CASH", "TRANSFER", "CARD", "QR", "MERCADOPAGO", "CREDIT_SJT", "OTHER"];
const ALLOWED_CARD_KIND = ["CREDIT", "DEBIT", "PREPAID", "BOTH"];
const ALLOWED_REGISTER_GROUP = ["CASH", "BANK", "CARD", "DIGITAL", "INTERNAL_CREDIT", "OTHER"];
const ALLOWED_PRICING_MODE = ["SALE_PRICE", "LIST_PRICE", "SURCHARGE_PERCENT", "FIXED_PRICE"];
const ALLOWED_ROUNDING_MODE = ["NONE", "NEAREST", "UP", "DOWN"];
const ALLOWED_INSTALLMENT_PRICING_MODE = [
  "SAME_AS_BASE",
  "SALE_PRICE",
  "LIST_PRICE",
  "SURCHARGE_PERCENT",
  "PLAN",
];

/* =========================
   Payload builder
========================= */
function buildPayload(raw = {}) {
  const payload = {};

  payload.branch_id =
    raw.branch_id === undefined && raw.branchId === undefined
      ? undefined
      : (toInt(raw.branch_id ?? raw.branchId, 0) || null);

  payload.code = cleanCode(raw.code);
  payload.name = cleanStr(raw.name, 140);
  payload.display_name = cleanStr(raw.display_name ?? raw.displayName, 180);
  payload.description = cleanStr(raw.description, 255);

  payload.kind = cleanStr(raw.kind, 40)?.toUpperCase() || "OTHER";
  payload.provider_code = cleanStr(raw.provider_code ?? raw.providerCode, 80)?.toLowerCase() || null;
  payload.card_brand = cleanStr(raw.card_brand ?? raw.cardBrand, 60)?.toUpperCase() || null;
  payload.card_kind = cleanStr(raw.card_kind ?? raw.cardKind, 20)?.toUpperCase() || null;

  payload.is_active = parseBool(raw.is_active ?? raw.isActive, true);
  payload.is_default = parseBool(raw.is_default ?? raw.isDefault, false);
  payload.is_system = parseBool(raw.is_system ?? raw.isSystem, false);
  payload.is_featured = parseBool(raw.is_featured ?? raw.isFeatured, false);
  payload.sort_order = toInt(raw.sort_order ?? raw.sortOrder, 100);

  payload.allow_mixed = parseBool(raw.allow_mixed ?? raw.allowMixed, true);
  payload.only_pos = parseBool(raw.only_pos ?? raw.onlyPos, false);
  payload.only_ecom = parseBool(raw.only_ecom ?? raw.onlyEcom, false);
  payload.only_backoffice = parseBool(raw.only_backoffice ?? raw.onlyBackoffice, false);

  payload.allows_change = parseBool(raw.allows_change ?? raw.allowsChange, false);
  payload.change_limit_amount =
    raw.change_limit_amount === undefined && raw.changeLimitAmount === undefined
      ? undefined
      : (raw.change_limit_amount === null || raw.changeLimitAmount === null || raw.change_limit_amount === ""
          ? null
          : toNum(raw.change_limit_amount ?? raw.changeLimitAmount, 0));

  payload.counts_as_cash_in_register = parseBool(
    raw.counts_as_cash_in_register ?? raw.countsAsCashInRegister,
    false
  );
  payload.impacts_cash_register = parseBool(raw.impacts_cash_register ?? raw.impactsCashRegister, false);
  payload.register_group = cleanStr(raw.register_group ?? raw.registerGroup, 40)?.toUpperCase() || "OTHER";
  payload.settlement_delay_days = toInt(raw.settlement_delay_days ?? raw.settlementDelayDays, 0);
  payload.auto_reconcile = parseBool(raw.auto_reconcile ?? raw.autoReconcile, false);

  payload.pricing_mode = cleanStr(raw.pricing_mode ?? raw.pricingMode, 40)?.toUpperCase() || "SALE_PRICE";
  payload.surcharge_percent = toNum(raw.surcharge_percent ?? raw.surchargePercent, 0);
  payload.surcharge_fixed_amount = toNum(raw.surcharge_fixed_amount ?? raw.surchargeFixedAmount, 0);
  payload.fixed_price_value =
    raw.fixed_price_value === undefined && raw.fixedPriceValue === undefined
      ? undefined
      : (raw.fixed_price_value === null || raw.fixedPriceValue === null || raw.fixed_price_value === ""
          ? null
          : toNum(raw.fixed_price_value ?? raw.fixedPriceValue, 0));

  payload.rounding_mode = cleanStr(raw.rounding_mode ?? raw.roundingMode, 20)?.toUpperCase() || "NONE";
  payload.rounding_value =
    raw.rounding_value === undefined && raw.roundingValue === undefined
      ? undefined
      : (raw.rounding_value === null || raw.roundingValue === null || raw.rounding_value === ""
          ? null
          : toNum(raw.rounding_value ?? raw.roundingValue, 0));

  payload.supports_installments = parseBool(raw.supports_installments ?? raw.supportsInstallments, false);
  payload.min_installments = Math.max(1, toInt(raw.min_installments ?? raw.minInstallments, 1));
  payload.max_installments = Math.max(1, toInt(raw.max_installments ?? raw.maxInstallments, 1));
  payload.default_installments = Math.max(1, toInt(raw.default_installments ?? raw.defaultInstallments, 1));

  payload.installment_pricing_mode =
    cleanStr(raw.installment_pricing_mode ?? raw.installmentPricingMode, 40)?.toUpperCase() || "SAME_AS_BASE";
  payload.installment_surcharge_percent = toNum(
    raw.installment_surcharge_percent ?? raw.installmentSurchargePercent,
    0
  );
  payload.installment_plan_json = normalizeInstallmentPlan(
    raw.installment_plan_json ?? raw.installmentPlanJson
  );

  payload.requires_reference = parseBool(raw.requires_reference ?? raw.requiresReference, false);
  payload.requires_auth_code = parseBool(raw.requires_auth_code ?? raw.requiresAuthCode, false);
  payload.requires_last4 = parseBool(raw.requires_last4 ?? raw.requiresLast4, false);
  payload.requires_card_holder = parseBool(raw.requires_card_holder ?? raw.requiresCardHolder, false);
  payload.requires_bank_name = parseBool(raw.requires_bank_name ?? raw.requiresBankName, false);
  payload.requires_customer_doc = parseBool(raw.requires_customer_doc ?? raw.requiresCustomerDoc, false);
  payload.requires_customer_phone = parseBool(raw.requires_customer_phone ?? raw.requiresCustomerPhone, false);

  payload.min_amount =
    raw.min_amount === undefined && raw.minAmount === undefined
      ? undefined
      : (raw.min_amount === null || raw.minAmount === null || raw.min_amount === ""
          ? null
          : toNum(raw.min_amount ?? raw.minAmount, 0));

  payload.max_amount =
    raw.max_amount === undefined && raw.maxAmount === undefined
      ? undefined
      : (raw.max_amount === null || raw.maxAmount === null || raw.max_amount === ""
          ? null
          : toNum(raw.max_amount ?? raw.maxAmount, 0));

  payload.valid_from = normalizeDate(raw.valid_from ?? raw.validFrom);
  payload.valid_to = normalizeDate(raw.valid_to ?? raw.validTo);

  payload.input_schema_json = normalizeInputSchema(raw.input_schema_json ?? raw.inputSchemaJson);
  payload.meta = normalizeMeta(raw.meta);

  return payload;
}

/* =========================
   Validation
========================= */
function validatePayload(payload, { isCreate = false } = {}) {
  if (isCreate) {
    if (!payload.code) {
      const e = new Error("code es requerido");
      e.httpStatus = 400;
      e.code = "PAYMENT_METHOD_CODE_REQUIRED";
      throw e;
    }

    if (!payload.name) {
      const e = new Error("name es requerido");
      e.httpStatus = 400;
      e.code = "PAYMENT_METHOD_NAME_REQUIRED";
      throw e;
    }
  }

  if (payload.code !== undefined && !payload.code) {
    const e = new Error("code inválido");
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_CODE_INVALID";
    throw e;
  }

  if (payload.name !== undefined && !payload.name) {
    const e = new Error("name inválido");
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_NAME_INVALID";
    throw e;
  }

  if (!ALLOWED_KIND.includes(payload.kind)) {
    const e = new Error(`kind inválido: ${payload.kind}`);
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_KIND_INVALID";
    throw e;
  }

  if (payload.card_kind && !ALLOWED_CARD_KIND.includes(payload.card_kind)) {
    const e = new Error(`card_kind inválido: ${payload.card_kind}`);
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_CARD_KIND_INVALID";
    throw e;
  }

  if (!ALLOWED_REGISTER_GROUP.includes(payload.register_group)) {
    const e = new Error(`register_group inválido: ${payload.register_group}`);
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_REGISTER_GROUP_INVALID";
    throw e;
  }

  if (!ALLOWED_PRICING_MODE.includes(payload.pricing_mode)) {
    const e = new Error(`pricing_mode inválido: ${payload.pricing_mode}`);
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_PRICING_MODE_INVALID";
    throw e;
  }

  if (!ALLOWED_ROUNDING_MODE.includes(payload.rounding_mode)) {
    const e = new Error(`rounding_mode inválido: ${payload.rounding_mode}`);
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_ROUNDING_MODE_INVALID";
    throw e;
  }

  if (!ALLOWED_INSTALLMENT_PRICING_MODE.includes(payload.installment_pricing_mode)) {
    const e = new Error(`installment_pricing_mode inválido: ${payload.installment_pricing_mode}`);
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_INSTALLMENT_PRICING_MODE_INVALID";
    throw e;
  }

  if (payload.kind !== "CARD") {
    payload.card_brand = null;
    payload.card_kind = null;
    payload.requires_auth_code = false;
    payload.requires_last4 = false;
    payload.requires_card_holder = false;
  }

  if (payload.kind === "CASH") {
    payload.allows_change = true;
    payload.counts_as_cash_in_register = true;
    payload.impacts_cash_register = true;
    if (payload.register_group === "OTHER") payload.register_group = "CASH";
  }

  if (payload.kind === "TRANSFER" && payload.register_group === "OTHER") {
    payload.register_group = "BANK";
  }

  if (payload.kind === "CARD" && payload.register_group === "OTHER") {
    payload.register_group = "CARD";
  }

  if (["QR", "MERCADOPAGO"].includes(payload.kind) && payload.register_group === "OTHER") {
    payload.register_group = "DIGITAL";
  }

  if (payload.kind === "CREDIT_SJT" && payload.register_group === "OTHER") {
    payload.register_group = "INTERNAL_CREDIT";
  }

  if (!isPositiveOrZero(payload.surcharge_percent)) {
    const e = new Error("surcharge_percent inválido");
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_SURCHARGE_PERCENT_INVALID";
    throw e;
  }

  if (!isPositiveOrZero(payload.surcharge_fixed_amount)) {
    const e = new Error("surcharge_fixed_amount inválido");
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_SURCHARGE_FIXED_INVALID";
    throw e;
  }

  if (payload.fixed_price_value !== undefined && payload.fixed_price_value !== null && !isPositive(payload.fixed_price_value)) {
    const e = new Error("fixed_price_value inválido");
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_FIXED_PRICE_INVALID";
    throw e;
  }

  if (payload.rounding_value !== undefined && payload.rounding_value !== null && !isPositive(payload.rounding_value)) {
    const e = new Error("rounding_value inválido");
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_ROUNDING_VALUE_INVALID";
    throw e;
  }

  if (payload.pricing_mode === "FIXED_PRICE" && !isPositive(payload.fixed_price_value || 0)) {
    const e = new Error("pricing_mode FIXED_PRICE requiere fixed_price_value > 0");
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_FIXED_PRICE_REQUIRED";
    throw e;
  }

  if (payload.supports_installments) {
    if (payload.min_installments < 1) payload.min_installments = 1;
    if (payload.max_installments < payload.min_installments) payload.max_installments = payload.min_installments;
    if (payload.default_installments < payload.min_installments) payload.default_installments = payload.min_installments;
    if (payload.default_installments > payload.max_installments) payload.default_installments = payload.max_installments;
  } else {
    payload.min_installments = 1;
    payload.max_installments = 1;
    payload.default_installments = 1;
    payload.installment_pricing_mode = "SAME_AS_BASE";
    payload.installment_surcharge_percent = 0;
    payload.installment_plan_json = null;
  }

  if (!isPositiveOrZero(payload.installment_surcharge_percent)) {
    const e = new Error("installment_surcharge_percent inválido");
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_INSTALLMENT_SURCHARGE_INVALID";
    throw e;
  }

  if (payload.installment_pricing_mode === "PLAN" && payload.supports_installments) {
    if (!Array.isArray(payload.installment_plan_json) || !payload.installment_plan_json.length) {
      const e = new Error("installment_pricing_mode=PLAN requiere installment_plan_json");
      e.httpStatus = 400;
      e.code = "PAYMENT_METHOD_INSTALLMENT_PLAN_REQUIRED";
      throw e;
    }

    for (const row of payload.installment_plan_json) {
      const pricingMode = String(row.pricing_mode || "").toUpperCase();
      if (pricingMode && !ALLOWED_PRICING_MODE.includes(pricingMode)) {
        const e = new Error(`installment_plan_json.pricing_mode inválido: ${pricingMode}`);
        e.httpStatus = 400;
        e.code = "PAYMENT_METHOD_INSTALLMENT_PLAN_INVALID";
        throw e;
      }
      if (!isPositiveOrZero(toNum(row.surcharge_percent, 0))) {
        const e = new Error("installment_plan_json.surcharge_percent inválido");
        e.httpStatus = 400;
        e.code = "PAYMENT_METHOD_INSTALLMENT_PLAN_INVALID";
        throw e;
      }
    }
  }

  if (payload.change_limit_amount !== undefined && payload.change_limit_amount !== null && !isPositiveOrZero(payload.change_limit_amount)) {
    const e = new Error("change_limit_amount inválido");
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_CHANGE_LIMIT_INVALID";
    throw e;
  }

  if (payload.min_amount !== undefined && payload.min_amount !== null && !isPositiveOrZero(payload.min_amount)) {
    const e = new Error("min_amount inválido");
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_MIN_AMOUNT_INVALID";
    throw e;
  }

  if (payload.max_amount !== undefined && payload.max_amount !== null && !isPositive(payload.max_amount)) {
    const e = new Error("max_amount inválido");
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_MAX_AMOUNT_INVALID";
    throw e;
  }

  if (
    payload.min_amount !== undefined &&
    payload.min_amount !== null &&
    payload.max_amount !== undefined &&
    payload.max_amount !== null &&
    payload.max_amount < payload.min_amount
  ) {
    const e = new Error("max_amount no puede ser menor que min_amount");
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_AMOUNT_RANGE_INVALID";
    throw e;
  }

  if (payload.valid_from && payload.valid_to && payload.valid_to < payload.valid_from) {
    const e = new Error("valid_to no puede ser menor que valid_from");
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_VALIDITY_INVALID";
    throw e;
  }

  if (payload.kind === "CARD" && !payload.provider_code) {
    payload.provider_code = payload.card_kind === "DEBIT" ? "debit" : "card";
  }

  if (payload.kind === "CASH" && !payload.provider_code) payload.provider_code = "cash";
  if (payload.kind === "TRANSFER" && !payload.provider_code) payload.provider_code = "transfer";
  if (payload.kind === "QR" && !payload.provider_code) payload.provider_code = "qr";
  if (payload.kind === "MERCADOPAGO" && !payload.provider_code) payload.provider_code = "mercadopago";
  if (payload.kind === "CREDIT_SJT" && !payload.provider_code) payload.provider_code = "credit_sjt";
  if (payload.kind === "OTHER" && !payload.provider_code) payload.provider_code = "other";
}

/* =========================
   Uniqueness
========================= */
async function ensureUniqueCode({ branch_id = null, code, excludeId = null }) {
  const normalizedCode = cleanCode(code);
  if (!normalizedCode) return;

  const where = {
    code: normalizedCode,
    branch_id: branch_id || null,
  };

  if (excludeId) {
    where.id = { [Op.ne]: toInt(excludeId, 0) };
  }

  const exists = await PaymentMethod.findOne({
    where,
    attributes: ["id"],
  });

  if (exists) {
    const e = new Error(`Ya existe un medio de pago con code="${normalizedCode}" para ese scope`);
    e.httpStatus = 400;
    e.code = "PAYMENT_METHOD_CODE_DUPLICATE";
    throw e;
  }
}

/* =========================
   DTOs
========================= */
function toPublicDto(row) {
  const x = row?.toJSON ? row.toJSON() : row || {};

  return {
    id: x.id,
    branch_id: x.branch_id ?? null,
    code: x.code ?? null,
    name: x.name ?? null,
    display_name: x.display_name ?? null,
    description: x.description ?? null,

    kind: x.kind ?? null,
    provider_code: x.provider_code ?? null,
    card_brand: x.card_brand ?? null,
    card_kind: x.card_kind ?? null,

    is_active: !!x.is_active,
    is_default: !!x.is_default,
    is_system: !!x.is_system,
    is_featured: !!x.is_featured,
    sort_order: x.sort_order ?? 100,

    allow_mixed: !!x.allow_mixed,
    only_pos: !!x.only_pos,
    only_ecom: !!x.only_ecom,
    only_backoffice: !!x.only_backoffice,

    allows_change: !!x.allows_change,
    change_limit_amount: x.change_limit_amount,
    counts_as_cash_in_register: !!x.counts_as_cash_in_register,
    impacts_cash_register: !!x.impacts_cash_register,
    register_group: x.register_group ?? null,
    settlement_delay_days: x.settlement_delay_days ?? 0,
    auto_reconcile: !!x.auto_reconcile,

    pricing_mode: x.pricing_mode ?? null,
    surcharge_percent: x.surcharge_percent,
    surcharge_fixed_amount: x.surcharge_fixed_amount,
    fixed_price_value: x.fixed_price_value,
    rounding_mode: x.rounding_mode ?? "NONE",
    rounding_value: x.rounding_value,

    supports_installments: !!x.supports_installments,
    min_installments: x.min_installments ?? 1,
    max_installments: x.max_installments ?? 1,
    default_installments: x.default_installments ?? 1,
    installment_pricing_mode: x.installment_pricing_mode ?? "SAME_AS_BASE",
    installment_surcharge_percent: x.installment_surcharge_percent,
    installment_plan_json: x.installment_plan_json ?? null,

    requires_reference: !!x.requires_reference,
    requires_auth_code: !!x.requires_auth_code,
    requires_last4: !!x.requires_last4,
    requires_card_holder: !!x.requires_card_holder,
    requires_bank_name: !!x.requires_bank_name,
    requires_customer_doc: !!x.requires_customer_doc,
    requires_customer_phone: !!x.requires_customer_phone,

    min_amount: x.min_amount,
    max_amount: x.max_amount,
    valid_from: x.valid_from ?? null,
    valid_to: x.valid_to ?? null,

    input_schema_json: x.input_schema_json ?? null,
    meta: x.meta ?? null,

    created_at: x.created_at ?? null,
    updated_at: x.updated_at ?? null,
  };
}

/* =========================
   Get active methods
========================= */
async function getActivePaymentMethods({
  branchId = null,
  includeInactive = false,
  channel = "POS",
  amount = null,
  at = new Date(),
} = {}) {
  const bid = toInt(branchId, 0) || null;
  const now = at instanceof Date ? at : new Date(at);

  const whereBase = {};
  if (!includeInactive) whereBase.is_active = true;

  const whereGlobal = { ...whereBase, branch_id: null };
  const whereBranch = bid ? { ...whereBase, branch_id: bid } : null;

  const [globalRows, branchRows] = await Promise.all([
    PaymentMethod.findAll({
      where: whereGlobal,
      order: [
        ["sort_order", "ASC"],
        ["id", "ASC"],
      ],
    }),
    whereBranch
      ? PaymentMethod.findAll({
          where: whereBranch,
          order: [
            ["sort_order", "ASC"],
            ["id", "ASC"],
          ],
        })
      : Promise.resolve([]),
  ]);

  const branchMap = new Map();
  for (const row of branchRows) {
    branchMap.set(String(row.code || "").toLowerCase(), row);
  }

  const merged = [];

  for (const row of globalRows) {
    const key = String(row.code || "").toLowerCase();
    if (branchMap.has(key)) continue;
    merged.push(row);
  }

  for (const row of branchRows) {
    merged.push(row);
  }

  const filtered = merged.filter((row) => {
    const x = row.toJSON ? row.toJSON() : row;

    if (channel === "POS" && x.only_ecom) return false;
    if (channel === "ECOM" && x.only_pos) return false;
    if (channel === "BACKOFFICE" && !x.only_backoffice && x.only_pos) return false;

    if (x.valid_from && new Date(x.valid_from) > now) return false;
    if (x.valid_to && new Date(x.valid_to) < now) return false;

    if (amount !== null && amount !== undefined) {
      const amt = toNum(amount, 0);
      if (x.min_amount !== null && x.min_amount !== undefined && amt < Number(x.min_amount)) return false;
      if (x.max_amount !== null && x.max_amount !== undefined && amt > Number(x.max_amount)) return false;
    }

    return true;
  });

  filtered.sort((a, b) => {
    const aa = a.toJSON ? a.toJSON() : a;
    const bb = b.toJSON ? b.toJSON() : b;

    const sa = toInt(aa.sort_order, 100);
    const sb = toInt(bb.sort_order, 100);
    if (sa !== sb) return sa - sb;

    return toInt(aa.id, 0) - toInt(bb.id, 0);
  });

  return filtered.map(toPublicDto);
}

module.exports = {
  buildPayload,
  validatePayload,
  ensureUniqueCode,
  toPublicDto,
  getActivePaymentMethods,
};