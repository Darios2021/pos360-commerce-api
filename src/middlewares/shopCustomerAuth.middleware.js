// ✅ COPY-PASTE FINAL COMPLETO
// src/middlewares/shopCustomerAuth.middleware.js
//
// Objetivo:
// - Exigir customer logueado para endpoints /public/account/*
// - Reusar exactamente el mismo resolver que ya usás en /public/auth/me
//
// Resultado:
// - Si hay cookie válida -> req.customer seteado y next()
// - Si no -> 401 { message: "No autenticado" }

const { getShopCustomerFromRequest } = require("../services/shopSession.service");

module.exports.requireShopCustomer = async (req, res, next) => {
  try {
    // Si ya viene seteado por otro middleware, ok
    if (req.customer && req.customer.id) return next();

    // ✅ Reuso directo del resolver real
    const customer = await getShopCustomerFromRequest(req);

    if (customer && customer.id) {
      req.customer = customer;
      return next();
    }

    return res.status(401).json({ message: "No autenticado" });
  } catch (e) {
    return res.status(500).json({ message: e?.message || "Error auth" });
  }
};
