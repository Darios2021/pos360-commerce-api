// ✅ COPY-PASTE FINAL COMPLETO
// src/middlewares/shopCustomerAuth.middleware.js
//
// - requireShopCustomer: exige customer logueado (401 si no)
// - hydrateShopCustomer: si hay cookie válida, setea req.customer, si no sigue igual (NO 401)
//
// Usa exactamente el mismo resolver real que /public/auth/me

const { getShopCustomerFromRequest } = require("../services/shopSession.service");

async function resolve(req) {
  try {
    if (req.customer && req.customer.id) return req.customer;
    const c = await getShopCustomerFromRequest(req);
    if (c && c.id) {
      req.customer = c;
      return c;
    }
    return null;
  } catch {
    return null;
  }
}

module.exports.requireShopCustomer = async (req, res, next) => {
  try {
    const c = await resolve(req);
    if (c && c.id) return next();
    return res.status(401).json({ message: "No autenticado" });
  } catch (e) {
    return res.status(500).json({ message: e?.message || "Error auth" });
  }
};

module.exports.hydrateShopCustomer = async (req, res, next) => {
  await resolve(req);
  return next();
};
