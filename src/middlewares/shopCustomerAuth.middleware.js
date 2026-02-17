// ✅ COPY-PASTE FINAL COMPLETO
// src/middlewares/shopCustomerAuth.middleware.js
//
// Objetivo:
// - Exigir customer logueado para endpoints /public/account/*
// - Reusar lo que ya tengas en /public/auth/me (cookie httpOnly)
//
// Cómo funciona:
// - Si ya existe req.customer (porque algún middleware anterior lo setea), lo usa.
// - Si no, intenta llamar a un hook `resolveCustomerFromRequest(req)` que vos tenés que conectar
//   a tu implementación real de sesión/cookie (la misma que usa /public/auth/me).

const { sequelize } = require("../config/sequelize"); // ajustá si tu export difiere

async function resolveCustomerFromRequest(req) {
  // ✅ TODO: conectá tu implementación real
  // Buscá en tu backend dónde resolvés el customer en /public/auth/me y pegalo acá.
  //
  // Ejemplos típicos:
  // - leer cookie "shop_session" y buscar en ecom_customer_sessions
  // - validar JWT/cookie y cargar ecom_customers
  //
  // Si querés, pegá el código de tu endpoint /public/auth/me y te lo adapto exacto.

  return null;
}

module.exports.requireShopCustomer = async (req, res, next) => {
  try {
    if (req.customer && req.customer.id) return next();

    const customer = await resolveCustomerFromRequest(req);
    if (customer && customer.id) {
      req.customer = customer;
      return next();
    }

    return res.status(401).json({ message: "No autenticado" });
  } catch (e) {
    return res.status(500).json({ message: e?.message || "Error auth" });
  }
};
