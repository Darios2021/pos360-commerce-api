const express = require('express');
const cors = require('./config/cors');
const v1Routes = require('./routes/v1.routes');
const { errorMiddleware } = require('./middlewares/error.middleware');

function createApp() {
  const app = express();

  app.use(express.json({ limit: '2mb' }));
  app.use(cors);

  app.get('/', (req, res) => res.json({ name: 'pos360-commerce-api', ok: true }));

  app.use('/api/v1', v1Routes);

  // ✅ Siempre al final
  app.use(errorMiddleware);

  return app;
}

module.exports = { createApp };
