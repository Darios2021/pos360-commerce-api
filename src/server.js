// src/server.js
require("dotenv").config();

const { createApp } = require("./app");
const { sequelize } = require("./models");

const PORT = process.env.PORT || 3000;
const app = createApp();

async function bootstrap() {
  try {
    console.log("🔌 intentando conectar a la base de datos...");
    await sequelize.authenticate();
    console.log("✅ DB Conectada");

    app.listen(PORT, () => {
      console.log(`🚀 API funcionando en puerto ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Error al conectar DB:", err.message);

    // ⛑️ Modo emergencia: levantamos igual para que CapRover no mate el contenedor
    app.listen(PORT, () => {
      console.log(`🚨 API en modo emergencia (sin DB) en puerto ${PORT}`);
    });
  }
}

bootstrap();
