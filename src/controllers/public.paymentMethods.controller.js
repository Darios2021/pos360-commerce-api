// src/controllers/public.paymentMethods.controller.js
// ✅ COPY-PASTE FINAL
//
// Public Ecommerce Payment Methods (DB-first)
// GET /api/v1/ecom/payment-methods
//
// Lee de: ecom_payment_methods
// Devuelve SOLO enabled=1 y ordenado por sort_order, id
//
// Response:
// { ok: true, items: [{ code,title,description,provider,badge_text,badge_variant,icon,requires_redirect,allows_proof_upload,is_cash_like,sort_order }] }

const { sequelize } = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

async function listPaymentMethods(req, res) {
  try {
    const includeDisabled = toInt(req.query?.include_disabled, 0) === 1;

    const whereSql = includeDisabled ? "" : "WHERE enabled = 1";

    const [rows] = await sequelize.query(
      `
      SELECT
        id,
        code,
        title,
        description,
        provider,
        enabled,
        sort_order,
        badge_text,
        badge_variant,
        icon,
        requires_redirect,
        allows_proof_upload,
        is_cash_like
      FROM ecom_payment_methods
      ${whereSql}
      ORDER BY sort_order ASC, id ASC
      `
    );

    // ⚠️ Para el público no hace falta exponer "enabled" si no querés
    const items = (rows || []).map((r) => ({
      code: r.code,
      title: r.title,
      description: r.description,
      provider: r.provider,
      badge_text: r.badge_text,
      badge_variant: r.badge_variant,
      icon: r.icon,
      requires_redirect: Boolean(r.requires_redirect),
      allows_proof_upload: Boolean(r.allows_proof_upload),
      is_cash_like: Boolean(r.is_cash_like),
      sort_order: r.sort_order,
    }));

    return res.json({ ok: true, items });
  } catch (e) {
    console.error("❌ listPaymentMethods error:", e);
    return res.status(500).json({
      ok: false,
      message: "Error obteniendo medios de pago.",
      detail: e?.message || String(e),
    });
  }
}

module.exports = {
  listPaymentMethods,
};
