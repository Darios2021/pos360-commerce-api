// src/controllers/admin.shopBranding.controller.js
// ✅ COPY-PASTE FINAL
const AdminShopBrandingService = require("../services/admin.shopBranding.service");

function toStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}

module.exports = {
  async get(req, res) {
    try {
      const item = await AdminShopBrandingService.get();
      return res.json({ ok: true, item });
    } catch (err) {
      console.error("ADMIN_SHOP_BRANDING_GET_ERROR", err);
      return res.status(500).json({
        ok: false,
        code: "ADMIN_SHOP_BRANDING_GET_ERROR",
        message: err?.message || "Error trayendo branding",
      });
    }
  },

  async update(req, res) {
    try {
      const item = await AdminShopBrandingService.update({
        name: toStr(req.body?.name),
        logo_url: req.body?.logo_url ?? "",
        favicon_url: req.body?.favicon_url ?? "",
      });

      return res.json({ ok: true, item });
    } catch (err) {
      console.error("ADMIN_SHOP_BRANDING_UPDATE_ERROR", err);
      return res.status(500).json({
        ok: false,
        code: "ADMIN_SHOP_BRANDING_UPDATE_ERROR",
        message: err?.message || "Error actualizando branding",
      });
    }
  },
};
