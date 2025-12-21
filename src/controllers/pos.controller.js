// src/modules/pos/pos.controller.js
const posService = require("./pos.service");

async function createSale(req, res, next) {
  try {
    // Tomamos el usuario del token (req.user) o del body como fallback
    const ctxUser = req.user || { id: req.body.user_id };
    
    const result = await posService.createPosSale(req.body, ctxUser);
    
    res.status(201).json({
      ok: true,
      message: "Venta procesada con éxito",
      data: result
    });
  } catch (error) {
    // Si es un error de stock (409) o validación (400), mantenemos el status
    const status = error.status || 500;
    res.status(status).json({
      ok: false,
      message: error.message || "Error al procesar la venta"
    });
  }
}

module.exports = {
  createSale
};