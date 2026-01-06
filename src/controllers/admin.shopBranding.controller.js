// src/controllers/admin.shopBranding.controller.js
// ✅ COPY-PASTE FINAL COMPLETO

const shopBrandingService = require("../services/admin.shopBranding.service");

module.exports = {
  async getBranding(req, res, next) {
    try {
      const item = await shopBrandingService.getShopBranding();
      return res.json({ ok: true, item });
    } catch (e) {
      next(e);
    }
  },

  async updateBranding(req, res, next) {
    try {
      const item = await shopBrandingService.updateShopBranding(req.body || {});
      return res.json({ ok: true, item });
    } catch (e) {
      next(e);
    }
  },

  async uploadLogo(req, res, next) {
    try {
      const item = await shopBrandingService.uploadShopLogo(req);
      return res.json({ ok: true, item });
    } catch (e) {
      next(e);
    }
  },

  async uploadFavicon(req, res, next) {
    try {
      const item = await shopBrandingService.uploadShopFavicon(req);
      return res.json({ ok: true, item });
    } catch (e) {
      next(e);
    }
  },
};
