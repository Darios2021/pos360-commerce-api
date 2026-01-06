// src/controllers/admin.shopBranding.controller.js
// ✅ COPY-PASTE FINAL COMPLETO (CommonJS)
// Depende de: src/services/admin.shopBranding.service.js

const svc = require("../services/admin.shopBranding.service");

function ok(res, item) {
  return res.json({ ok: true, item });
}

function fail(res, err, status = 500) {
  const msg = err?.friendlyMessage || err?.message || "Error";
  return res.status(status).json({ ok: false, code: err?.code || "ERROR", message: msg });
}

module.exports = {
  // GET /api/v1/admin/shop/branding
  async get(req, res) {
    try {
      const item = await svc.get();
      return ok(res, item);
    } catch (e) {
      return fail(res, e);
    }
  },

  // PUT /api/v1/admin/shop/branding  { name }
  async update(req, res) {
    try {
      const name = req?.body?.name;
      const item = await svc.updateName({ name });
      return ok(res, item);
    } catch (e) {
      return fail(res, e);
    }
  },

  // POST /api/v1/admin/shop/branding/logo (multipart: file)
  async uploadLogo(req, res) {
    try {
      const file = req?.file || null;
      if (!file) return fail(res, new Error("FILE_REQUIRED"), 400);

      const item = await svc.uploadLogo({ file });
      return ok(res, item);
    } catch (e) {
      return fail(res, e);
    }
  },

  // POST /api/v1/admin/shop/branding/favicon (multipart: file)
  async uploadFavicon(req, res) {
    try {
      const file = req?.file || null;
      if (!file) return fail(res, new Error("FILE_REQUIRED"), 400);

      const item = await svc.uploadFavicon({ file });
      return ok(res, item);
    } catch (e) {
      return fail(res, e);
    }
  },
};
