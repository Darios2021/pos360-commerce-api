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
// ✅ SELLADO:
// MP solo si:
// - payments.mp_enabled === true (DB)
// - y existe token REAL en ENV: MERCADOPAGO_ACCESS_TOKEN (o MP_ACCESS_TOKEN)
// ❌ NO usa tokens desde DB
// ❌ NO usa fallback legacy

const { sequelize } = require("../models");

function asBool(v, def = false) {
  if (v === true || v === false) return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(s)) return true;
    if (["0", "false", "no", "off"].includes(s)) return false;
  }
  return def;
}

function asStr(v) {
  return String(v ?? "").trim();
}

async function getPaymentsConfig(req, res) {
  // defaults “seguros”
  const out = {
    transfer: { enabled: true, bank: "", alias: "", cbu: "", holder: "", instructions: "" },
    mercadopago: { enabled: false },
    cash: { enabled: true, note: "" },
  };

  try {
    // ⚠️ Ajustado a value_json como venías usando.
    // Si tu columna es `value` o similar, cambiá acá y listo.
    const [rows] = await sequelize.query(
      `SELECT value_json FROM shop_settings WHERE \`key\`='payments' LIMIT 1`
    );

    const val = rows?.[0]?.value_json ?? null;

    // value_json puede venir objeto (JSON), o string JSON según driver/config.
    let p = {};
    if (val && typeof val === "object") {
      p = val;
    } else if (typeof val === "string" && val.trim()) {
      try {
        const parsed = JSON.parse(val);
        p = parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        p = {};
      }
    }

    // Transfer
    out.transfer.enabled = asBool(p.transfer_enabled, true);
    out.transfer.bank = asStr(p.transfer_bank);
    out.transfer.alias = asStr(p.transfer_alias);
    out.transfer.cbu = asStr(p.transfer_cbu);
    out.transfer.holder = asStr(p.transfer_holder);
    out.transfer.instructions = asStr(p.transfer_instructions);

    // ✅ Token REAL (ENV) - SELLADO
    const envMp =
      !!asStr(process.env.MERCADOPAGO_ACCESS_TOKEN) ||
      !!asStr(process.env.MP_ACCESS_TOKEN);

    out.mercadopago.enabled = asBool(p.mp_enabled, false) && envMp;

    // Cash
    out.cash.enabled = asBool(p.cash_enabled, true);
    out.cash.note = asStr(p.cash_note);

    return res.json({ ok: true, ...out });
  } catch (e) {
    // no rompemos checkout si falla config
    return res.json({ ok: true, ...out });
  }
}

module.exports = { getPaymentsConfig };
