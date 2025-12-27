// src/middlewares/error.middleware.js
function toStr(v) {
  return String(v ?? "").trim();
}

function isSequelizeValidation(err) {
  return (
    err?.name === "SequelizeValidationError" ||
    err?.name === "SequelizeUniqueConstraintError" ||
    /validation error/i.test(err?.message || "")
  );
}

function isUniqueConstraint(err) {
  return (
    err?.name === "SequelizeUniqueConstraintError" ||
    err?.original?.code === "ER_DUP_ENTRY" ||
    /duplicate/i.test(err?.original?.message || "") ||
    /unique/i.test(err?.message || "")
  );
}

function buildSequelizeErrors(err) {
  const out = {};
  const errs = Array.isArray(err?.errors) ? err.errors : [];

  for (const e of errs) {
    const field = e?.path || e?.instance?.path || "unknown";
    const msg =
      toStr(e?.message) ||
      toStr(e?.validatorName) ||
      toStr(e?.type) ||
      "Dato inválido";
    if (!out[field]) out[field] = msg;
  }

  if (!Object.keys(out).length) {
    out._ = toStr(err?.message) || "Validation error";
  }

  return out;
}

module.exports = function errorMiddleware(err, req, res, next) {
  console.error("❌ [API ERROR]", {
    method: req.method,
    url: req.originalUrl || req.url,
    name: err?.name,
    message: err?.message,
    code: err?.original?.code || err?.code,
  });

  // ✅ Sequelize validation / unique
  if (isSequelizeValidation(err)) {
    const errors = buildSequelizeErrors(err);
    const unique = isUniqueConstraint(err);

    return res.status(unique ? 409 : 400).json({
      ok: false,
      code: unique ? "DUPLICATE" : "VALIDATION",
      message: unique
        ? "Ya existe un registro con alguno de esos valores únicos (SKU / Barcode)."
        : "Revisá los campos, hay datos inválidos o faltantes.",
      errors,
    });
  }

  // ✅ fallback general
  const status = Number(err?.status || err?.statusCode || 500);
  return res.status(status).json({
    ok: false,
    code: err?.code || "INTERNAL",
    message: err?.publicMessage || err?.message || "Internal Server Error",
  });
};
