const cors = require('cors');

function parseOrigins(value) {
  if (!value || value === '*') return '*';

  // admite "a,b,c" o JSON ["a","b"]
  try {
    const maybeJson = JSON.parse(value);
    if (Array.isArray(maybeJson)) return maybeJson.map((s) => String(s).trim()).filter(Boolean);
  } catch (_) {}

  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const origins = parseOrigins(process.env.CORS_ORIGINS);

const corsMiddleware = cors({
  origin: origins === '*' ? true : origins,
  credentials: true,
});

module.exports = corsMiddleware;
