// src/routes/asistente.routes.js
// Asistente interno (ver src/services/asistente.service.js).
//
//   asistente        /api/v1/asistente        con la sesión del backoffice: la pantalla pregunta acá
//   asistenteDatos   /api/v1/asistente/datos  con el permiso delegado: lo llama mostrador, nunca el navegador
const express = require("express");
const svc = require("../services/asistente.service");

const envolver = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (e) {
    if (e instanceof svc.ErrorAsistente) return res.status(e.status).json({ ok: false, error: e.message });
    return next(e);
  }
};
// Sin caché ni 304: lo que se ve depende del usuario y del rol.
const sinCache = (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); };
const usuarioDe = (req) => Number(req.user?.id || req.user?.sub);

const asistente = express.Router();
asistente.use(sinCache);

/** Qué puede consultar quien está logueado (y, si es administrador, el gasto del mes). */
asistente.get("/estado", envolver(async (req, res) => {
  const permiso = await svc.firmarPermiso(usuarioDe(req));
  // Corto: de esta respuesta depende si el módulo aparece.
  const r = await svc.pedirAMostrador("/interno/estado", { permiso }, { espera: 8000 });
  res.status(r.status).json(r.cuerpo);
}));

asistente.post("/mensaje", envolver(async (req, res) => {
  const texto = String(req.body?.texto || "").trim().slice(0, 2000);
  if (!texto) return res.status(400).json({ ok: false, error: "Falta el texto" });
  const conversacion = req.body?.conversacion ? String(req.body.conversacion).slice(0, 40) : undefined;
  const permiso = await svc.firmarPermiso(usuarioDe(req));
  const r = await svc.pedirAMostrador("/interno/mensajes", { permiso, texto, conversacion });
  res.status(r.status).json(r.cuerpo);
}));

const asistenteDatos = express.Router();
asistenteDatos.use(sinCache, svc.exigirPermiso);
const dato = (ruta, fn) => asistenteDatos.get(`/${ruta}`, svc.exigirRol(ruta), envolver(async (req, res) => {
  res.json({ ok: true, data: await fn(req.asistente, req.query || {}) });
}));
dato("caja-actual", (u) => svc.cajaActual(u));
dato("ventas", svc.ventas);
dato("cajas", svc.cajas);
dato("arqueo", svc.arqueo);
dato("mas-vendidos", svc.masVendidos);
dato("margenes", svc.margenes);
dato("stock", svc.stock);

module.exports = { asistente, asistenteDatos };
