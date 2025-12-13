const { PORT } = require('./config/env');
const { initSequelize } = require('./loaders/sequelize.loader');
const { createApp } = require('./app');

(async () => {
  try {
    // DB: no debe tumbar la API en arranque
    try {
      await initSequelize();
      console.log('✅ Database connected');
    } catch (err) {
      console.warn('⚠️ DB connection failed. Starting API anyway.');
      console.warn(err?.message || err);
    }

    const app = createApp();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 API listening on :${PORT}`);
    });
  } catch (err) {
    console.error('❌ Startup error:', err);
    process.exit(1);
  }
})();
