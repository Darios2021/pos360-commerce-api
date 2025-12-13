const express = require('express');
const cors = require('cors');

const { CORS_ORIGINS } = require('./config/env');

function createApp() {
  const app = express();

  // middlewares
  app.use(express.json({ limit: '2mb' }));
  app.use(cors({ origin: CORS_ORIGINS === '*' ? true : CORS_ORIGINS.split(',') }));

  // health
  app.get('/api/v1/health', (req, res) => {
    res.json({ status: 'ok', service: 'pos360-commerce-api', ts: new Date().toISOString() });
  });

  // root (para que "/" no tire 502/unknown)
  app.get('/', (req, res) => {
    res.json({ name: 'pos360-commerce-api', ok: true });
  });

  return app;
}

module.exports = { createApp };
