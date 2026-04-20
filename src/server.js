// src/server.js
require("dotenv").config();

const http          = require("http");
const { createApp } = require("./app");
const searchService = require("./services/search.service");
const socketService = require("./services/socket.service");

const app        = createApp();
const httpServer = http.createServer(app);   // ← Socket.io necesita el httpServer raw
const PORT       = parseInt(process.env.PORT || "3000", 10);

socketService.init(httpServer);

httpServer.listen(PORT, () => {
  console.log(`✅ pos360-commerce-api listening on :${PORT}`);

  if (searchService.isConfigured()) {
    searchService.initIndex().catch((e) =>
      console.warn("⚠️  [Meilisearch] initIndex error:", e.message)
    );
  } else {
    console.log("ℹ️  [Meilisearch] No configurado — búsqueda usa MySQL.");
  }
});
