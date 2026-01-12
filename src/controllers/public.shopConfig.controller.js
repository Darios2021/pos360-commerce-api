// src/controllers/public.shopConfig.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (SELLADO)
// Public config para checkout (SIN AUTH)
//
// GET /api/v1/public/shop/payment-config
//
// Lee shop_settings('payments') y devuelve:
// {
//   transfer: { enabled, bank, alias, cbu, holder, instructions },
//   mercadopago: { enabled },
//   cash: { enabled, note }
// }
//
// ✅ REAL/SELLADO:
// MP solo si:
// - payments.mp_enabled === true (DB)
// - y existe token REAL en ENV: MERCADOPAGO_ACCESS_TOKEN
// ❌ NO usa tokens desde DB
// ❌ NO usa fallback legacy

const { sequelize } = require("../models");

async function getPaymentsConfig(req, res) {
  const out = {
    transfer: { enabled: true, bank: "", alias: "", cbu: "", holder: "", instructions: "" },
    mercadopago: { enabled: false },
    cash: { enabled: true, note: "" },
  };

  try {
    const [rows] = await sequelize.query(
      `SELECT value_json FROM shop_settings WHERE \`key\`='payments' LIMIT 1`
    );

    const val = rows?.[0]?.value_json || null;
    const p = val && typeof val === "object" ? val : {};

    out.transfer.enabled = !!p.transfer_enabled;
    out.transfer.bank = String(p.transfer_bank || "");
    out.transfer.alias = String(p.transfer_alias || "");
    out.transfer.cbu = String(p.transfer_cbu || "");
    out.transfer.holder = String(p.transfer_holder || "");
    out.transfer.instructions = String(p.transfer_instructions || "");

    // ✅ Token REAL (ENV) - SELLADO
    const envMp = !!String(process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim();
    out.mercadopago.enabled = !!p.mp_enabled && envMp;

    out.cash.enabled = !!p.cash_enabled;
    out.cash.note = String(p.cash_note || "");

    return res.json({ ok: true, ...out });
  } catch {
    return res.json({ ok: true, ...out });
  }
}

module.exports = { getPaymentsConfig };
