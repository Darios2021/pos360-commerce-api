const { PORT } = require('./config/env');
const { initSequelize } = require('./loaders/sequelize.loader');
const { createApp } = require('./app');

(async () => {
  try {
    try {
      await initSequelize();
      console.log('✅ Database connected');
    } catch (dbErr) {
      console.warn('⚠️ Database NOT connected yet. API will still start.');
      console.warn(`⚠️ Reason: ${dbErr?.message || dbErr}`);
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
