function errorMiddleware(err, req, res, next) {
  // Log fuerte para CapRover
  console.error('❌ ERROR:', err);

  const status = err.statusCode || err.status || 500;

  // En prod no mostrar stack al cliente (pero sí lo queda en logs)
  return res.status(status).json({
    ok: false,
    error: {
      message: err.message || 'Internal Server Error',
      code: err.code || undefined,
    },
  });
}

module.exports = { errorMiddleware };
