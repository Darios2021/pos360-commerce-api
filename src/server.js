// ✅ COPY-PASTE FINAL COMPLETO
// src/server.js

require("dotenv").config();

const { createApp } = require("./app");
const searchService = require("./services/search.service");

const app = createApp();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.listen(PORT, () => {
  console.log(`✅ pos360-commerce-api listening on :${PORT}`);

  // Inicializa el índice Meilisearch en background (no bloquea el arranque)
  if (searchService.isConfigured()) {
    searchService.initIndex().catch((e) =>
      console.warn("⚠️  [Meilisearch] initIndex error:", e.message)
    );
  } else {
    console.log("ℹ️  [Meilisearch] No configurado — búsqueda usa MySQL. Configurar MEILISEARCH_HOST para activar.");
  }
});
