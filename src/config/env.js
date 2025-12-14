// src/config/env.js
function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name, def = undefined) {
  return process.env[name] ?? def;
}

const env = {
  NODE_ENV: optional("NODE_ENV", "production"),
  PORT: Number(optional("PORT", "3000")),

  DB_HOST: required("DB_HOST"),
  DB_PORT: Number(optional("DB_PORT", "3306")),
  DB_NAME: required("DB_NAME"),
  DB_USER: required("DB_USER"),
  DB_PASSWORD: required("DB_PASSWORD"),

  CORS_ORIGINS: optional("CORS_ORIGINS", "*"),

  JWT_SECRET: required("JWT_SECRET"),
  JWT_REFRESH_SECRET: required("JWT_REFRESH_SECRET"),
  JWT_ACCESS_EXPIRES: optional("JWT_ACCESS_EXPIRES", "1d"),
  JWT_REFRESH_EXPIRES: optional("JWT_REFRESH_EXPIRES", "30d"),
};

env.CORS_ORIGINS_ARRAY = env.CORS_ORIGINS === "*"
  ? ["*"]
  : env.CORS_ORIGINS.split(",").map(s => s.trim()).filter(Boolean);

module.exports = env;
