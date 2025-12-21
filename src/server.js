// src/server.js
require("dotenv").config();
const { createApp } = require("./app"); // Verifica que la ruta sea correcta
const { sequelize } = require("./models"); // Esto puede fallar si la DB no está lista

const app = createApp();
const PORT = process.env.PORT || 3000;

// Versión simplificada para detectar el error:
async function bootstrap() {
  try {
    console.log("intentando conectar a la base de datos...");
    await sequelize.authenticate();
    console.log("✅ DB Conectada");

    app.listen(PORT, () => {
      console.log(`🚀 API funcionando en puerto ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Error al arrancar:", err.message);
    // Si la DB falla, igual levantamos el servidor para que CapRover no lo mate
    // pero las rutas de DB darán error. Esto sirve para debuguear.
    app.listen(PORT, () => {
      console.log(`🚀 API en modo emergencia (Sin DB) en puerto ${PORT}`);
    });
  }
}

bootstrap();