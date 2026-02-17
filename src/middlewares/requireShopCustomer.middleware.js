// ✅ COPY-PASTE FINAL COMPLETO
// src/middlewares/requireShopCustomer.middleware.js
//
// Requiere customer logueado (cookie httpOnly de SHOP)
//
// ✅ Usa req.customer si ya existe (ideal si ya lo seteás en /public/auth/me)
// ✅ Si no existe, intenta resolverlo con resolveCustomerFromRequest(req) -> TODO conectar
//
// Respuesta 401 si no hay sesión.

async function resolveCustomerFromRequest(req) {
  // ✅ TODO: Conectar a tu sesión real (la misma que usa /api/v1/public/auth/me)
  // Si ya tenés middleware que setea req.customer, NO hace falta tocar esto.
  //
  // 👉 Si me pegás tu controller de /public/auth/me, te lo dejo 100% integrado.
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
