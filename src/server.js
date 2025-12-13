const { PORT } = require('./config/env');
const { initSequelize } = require('./loaders/sequelize.loader');
const { createApp } = require('./app');

(async () => {
  try {
    await initSequelize();
    console.log('‚úÖ Database connected');

    const app = createApp();

    app.listen(PORT, () => {
      console.log(`Ì∫Ä Core Suite API listening on :${PORT}`);
    });
  } catch (err) {
    console.error('‚ùå Startup error:', err);
    process.exit(1);
  }
})();
