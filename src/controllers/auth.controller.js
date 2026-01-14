// src/controllers/auth.controller.js
const authService = require("../services/auth.service");

exports.login = async (req, res) => {
  try {
    const body = req.body || {};
    const identifier = (body.identifier || "").trim();
    const password = (body.password || "").trim();

    if (!identifier || !password) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        message: "identifier/email/username and password are required",
      });
    }

    const data = await authService.login({ identifier, password });

    return res.json({
      ok: true,
      ...data,
    });
  } catch (err) {
    const status = Number(err?.status) || 500;

    if (status === 401) {
      return res.status(401).json({
        ok: false,
        code: "INVALID_CREDENTIALS",
        message: "Credenciales inválidas.",
      });
    }

    if (status === 403 && String(err?.message || "").toUpperCase() === "USER_DISABLED") {
      return res.status(403).json({
        ok: false,
        code: "USER_DISABLED",
        message: "Usuario deshabilitado.",
      });
    }

    console.error("auth.login ERROR:", err);
    return res.status(status).json({
      ok: false,
      code: "INTERNAL_ERROR",
      message: err?.message || "Internal error during login",
    });
  }
};
