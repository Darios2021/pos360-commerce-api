// src/controllers/public.shopConfig.controller.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// GET /api/v1/public/shop/payment-config
//
// MP habilitado solo si:
// - payments.mp_enabled === true (DB)
// - y existe token REAL en ENV según modo:
//    test -> MERCADOPAGO_ACCESS_TOKEN_TEST
//    prod -> MERCADOPAGO_ACCESS_TOKEN_PROD
//
// Modo:
// - payments.mp_mode (DB) si existe
// - sino MP_MODE (ENV)

const { sequelize } = require("../models");
const { resolveMode, isConfigured } = require("../services/mercadopago.service");

function safeStr(v) {
  return String(v ?? "").trim();
}

async function getPaymentsConfig(req, res) {
  const out = {
    transfer: { enabled: true, bank: "", alias: "", cbu: "", holder: "", instructions: "" },
    mercadopago: { enabled: false, mode: "prod", configured: false },
    cash: { enabled: true, note: "" },
  };

  try {
    const [rows] = await sequelize.query(
      `SELECT value_json FROM shop_settings WHERE \`key\`='payments' LIMIT 1`
    );

    const val = rows?.[0]?.value_json || null;
    const p = val && typeof val === "object" ? val : {};

    out.transfer.enabled = !!p.transfer_enabled;
    out.transfer.bank = safeStr(p.transfer_bank);
    out.transfer.alias = safeStr(p.transfer_alias);
    out.transfer.cbu = safeStr(p.transfer_cbu);
    out.transfer.holder = safeStr(p.transfer_holder);
    out.transfer.instructions = safeStr(p.transfer_instructions);

    const mode = resolveMode(p);          // "test" | "prod"
    const configured = isConfigured(mode); // token existe para ese modo

    out.mercadopago.mode = mode;
    out.mercadopago.configured = configured;
    out.mercadopago.enabled = !!p.mp_enabled && configured;

    out.cash.enabled = !!p.cash_enabled;
    out.cash.note = safeStr(p.cash_note);

    return res.json({ ok: true, ...out });
  } catch (e) {
    return res.json({ ok: true, ...out });
  }
}

module.exports = { getPaymentsConfig };
