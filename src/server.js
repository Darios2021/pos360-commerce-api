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
    console.error("❌ Error al conectar DB:", err?.message || err);

    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    const allowNoDb = String(process.env.ALLOW_NO_DB ?? "false") === "true";

    // ✅ En producción conviene CRASHEAR para que CapRover reinicie
    if (isProd && !allowNoDb) {
      console.error("🛑 Producción sin DB: saliendo con code=1 (CapRover reiniciará)");
      process.exit(1);
    }

    // 🧪 Dev / emergencia
    app.listen(PORT, () => {
      console.log(`🚨 API en modo emergencia (sin DB) en puerto ${PORT}`);
    });
  }
}

bootstrap();
