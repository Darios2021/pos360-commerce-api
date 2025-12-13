const express = require('express');
const loadExpress = require('./loaders/express.loader');
const routes = require('./routes');
const errorMiddleware = require('./middlewares/error.middleware');

const createApp = () => {
  const app = express();

  loadExpress(app);

  app.get('/', (req, res) => {
    res.json({ ok: true, service: 'core-suite-api', api: '/api/v1' });
  });

  app.use('/api', routes);

  app.use(errorMiddleware);

  return app;
};

module.exports = { createApp };
