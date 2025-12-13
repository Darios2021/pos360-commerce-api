const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 3000,

  DB_HOST: process.env.DB_HOST,
  DB_PORT: process.env.DB_PORT || 3306,
  DB_NAME: process.env.DB_NAME,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,

  CORS_ORIGINS: process.env.CORS_ORIGINS || '*',

  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES || '15m',
  JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES || '7d',
};

// Validación mínima (para que falle con mensaje claro)
['DB_HOST','DB_NAME','DB_USER','DB_PASSWORD','JWT_SECRET','JWT_REFRESH_SECRET'].forEach((k) => {
  if (!env[k]) {
    console.warn(`⚠️ Missing env var: ${k}`);
  }
});

module.exports = env;
