const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const env = (key, def = undefined) => {
  const v = process.env[key];
  return (v === undefined || v === '') ? def : v;
};

module.exports = {
  NODE_ENV: env('NODE_ENV', 'development'),
  PORT: Number(env('PORT', 3000)),
  DB: {
    HOST: env('DB_HOST', 'localhost'),
    PORT: Number(env('DB_PORT', 3306)),
    NAME: env('DB_NAME', 'core_suite'),
    USER: env('DB_USER', 'root'),
    PASSWORD: env('DB_PASSWORD', '')
  },
  CORS_ORIGINS: env('CORS_ORIGINS', '*')
};
