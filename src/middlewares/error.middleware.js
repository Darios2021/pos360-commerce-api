const { NODE_ENV } = require('../config/env');

module.exports = (err, req, res, next) => {
  const status = err.statusCode || 500;

  const payload = {
    ok: false,
    error: {
      message: err.message || 'Internal Server Error'
    }
  };

  if (err.details) payload.error.details = err.details;
  if (NODE_ENV !== 'production') payload.error.stack = err.stack;

  res.status(status).json(payload);
};
