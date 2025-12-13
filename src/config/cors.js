const { CORS_ORIGINS } = require('./env');

const parseOrigins = () => {
  if (!CORS_ORIGINS || CORS_ORIGINS === '*') return '*';
  return CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
};

module.exports = {
  origins: parseOrigins()
};
