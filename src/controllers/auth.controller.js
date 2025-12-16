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

    // Esperado: { accessToken, user? }
    return res.json({
      ok: true,
      ...data,
    });
  } catch (err) {
    console.error("auth.login ERROR:", err);
    return res.status(500).json({
      ok: false,
      code: "INTERNAL_ERROR",
      message: err?.message || "Internal error during login",
    });
  }
};
