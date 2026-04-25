// src/server.js
require("dotenv").config();

const http          = require("http");
const { createApp } = require("./app");
const searchService = require("./services/search.service");
const socketService = require("./services/socket.service");
const { runStartupMigrations } = require("./migrations/runner");
const sequelize     = require("./config/sequelize");

const app        = createApp();
const httpServer = http.createServer(app);   // ← Socket.io necesita el httpServer raw
const PORT       = parseInt(process.env.PORT || "3000", 10);

socketService.init(httpServer);

// Correr migraciones antes de escuchar
runStartupMigrations(sequelize).catch((e) =>
  console.warn("⚠️ [startup migrations] error:", e.message)
);

httpServer.listen(PORT, () => {
  console.log(`✅ pos360-commerce-api listening on :${PORT}`);

  if (searchService.isConfigured()) {
    searchService.initIndex().catch((e) =>
      console.warn("⚠️  [Meilisearch] initIndex error:", e.message)
    );
  } else {
    console.log("ℹ️  [Meilisearch] No configurado — búsqueda usa MySQL.");
  }

  // Cron de alertas de Telegram (escanea cajas abiertas +8h cada 10 min).
  try {
    const tg = require("./services/telegramNotifier.service");
    if (tg && typeof tg.startCronJobs === "function") {
      tg.startCronJobs(10);
    }
  } catch (e) {
    console.warn("⚠️  [Telegram] no se pudo iniciar el cron:", e?.message);
  }
});
