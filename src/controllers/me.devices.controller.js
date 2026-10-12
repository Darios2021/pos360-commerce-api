// src/controllers/me.devices.controller.js
//
// Telefonos con la APK que reciben avisos push (services/avisosPush.service.js).
//   POST   /me/devices         { token, platform?, branch_id?, app_version? } -> { ok, data: { id } }
//   DELETE /me/devices/:id      id numerico o el token mismo                  -> { ok, data: { borrados } }
// Cada usuario solo da de alta o baja sus propios telefonos.

const avisos = require("../services/avisosPush.service");

function userId(req) {
  const p = req.user || {};
  return Number(p.sub || p.id || 0) || null;
}

async function registrar(req, res) {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ ok: false, message: "Sin sesión" });
    const { token, platform, branch_id, app_version } = req.body || {};
    const data = await avisos.registrarDispositivo({ user_id: uid, token, platform, branch_id, app_version });
    return res.json({ ok: true, data });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, message: e.status ? e.message : "No se pudo registrar el teléfono" });
  }
}

async function quitar(req, res) {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ ok: false, message: "Sin sesión" });
    const data = await avisos.quitarDispositivo({ user_id: uid, id_o_token: req.params.id });
    return res.json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "No se pudo quitar el teléfono" });
  }
}

module.exports = { registrar, quitar };
