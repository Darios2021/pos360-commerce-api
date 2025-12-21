require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { sequelize } = require("./models"); // Importa la instancia blindada de Sequelize
const routes = require("./routes/v1.routes"); // Ajusta según tu archivo de rutas
const { errorMiddleware } = require("./middlewares/error.middleware");

const app = express();

// ==========================================
// 1. CONFIGURACIÓN DE CORS (Blindaje Total)
// ==========================================
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) return callback(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked by POS360: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // Habilita preflight para todo

// ==========================================
// 2. MIDDLEWARES DE DATOS
// ==========================================
app.use(express.json({ limit: "10mb" })); // Límite alto para procesos pesados
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 3. RUTAS Y SALUD
// ==========================================
app.get("/", (req, res) => res.json({ name: "pos360-api", status: "online", db: "connected" }));
app.use("/api/v1", routes);

// ==========================================
// 4. GESTIÓN DE ERRORES (Capa de Seguridad)
// ==========================================
app.use(errorMiddleware);

// ==========================================
// 5. ARRANQUE CONTROLADO (Evita reinicios en CapRover)
// ==========================================
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    // Verificamos DB antes de abrir el puerto
    await sequelize.authenticate();
    console.log("✅ Conexión a Base de Datos: EXITOSA");

    // Sincronización segura (No borra datos)
    // await sequelize.sync({ alter: false }); 

    app.listen(PORT, () => {
      console.log(`🚀 Servidor POS360 escuchando en: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ ERROR CRÍTICO AL INICIAR EL SERVIDOR:", error.message);
    // No cerramos el proceso inmediatamente para que CapRover nos deje ver el log
    setTimeout(() => process.exit(1), 5000); 
  }
}

start();