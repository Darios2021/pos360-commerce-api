// FIX #5 — CORS seguro con credentials (2026-04-22):
// origin: true + credentials: true permite cualquier origen enviar cookies → riesgo XSS/CSRF.
// Si CORS_ORIGINS no está configurado, en producción NO se acepta ningún origen (origen bloqueado).
// En desarrollo local (NODE_ENV=development) se permite localhost como fallback.
const cors = require('cors');

function parseOrigins(value) {
  if (!value) return null; // sin configurar → usar lógica de fallback
  if (value === '*') return '*';

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

// Si no hay CORS_ORIGINS configurado:
// - development → permite localhost (facilita dev local)
// - producción  → bloquea todo (seguro por defecto)
function resolveOrigin() {
  if (origins === '*') {
    // Wildcard explícito: permitir todo, pero SIN credentials (cors rechaza la combinación)
    console.warn('[CORS] ⚠️ CORS_ORIGINS=* con credentials deshabilitado. Configurá orígenes específicos.');
    return true; // credentials quedará false en este caso
  }
  if (Array.isArray(origins) && origins.length) return origins;

  // sin configurar
  if (process.env.NODE_ENV === 'development') {
    return [
      'http://localhost:5173',
      'http://localhost:4173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
    ];
  }

  // producción sin CORS_ORIGINS → bloquear todo
  console.warn('[CORS] ⚠️ CORS_ORIGINS no configurado en producción. Todos los orígenes bloqueados.');
  return false;
}

const resolvedOrigin = resolveOrigin();

const corsMiddleware = cors({
  origin: resolvedOrigin,
  credentials: origins !== '*', // credentials: false si se usa wildcard
});

module.exports = corsMiddleware;
