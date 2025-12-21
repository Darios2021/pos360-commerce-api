const express = require('express');
const cors = require('cors');
const v1Routes = require('./routes/v1.routes');
const { errorMiddleware } = require('./middlewares/error.middleware');

function createApp() {
  const app = express();

  // 1. Configuración de CORS (Prioridad Alta)
  const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const corsOptions = {
    origin: (origin, callback) => {
      if (!origin || origin.includes('localhost')) return callback(null, true);
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*') || allowedOrigins.length === 0) return callback(null, true);
      return callback(new Error(`CORS blocked by pos360: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  };
  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));

  // 2. Parsers con límite aumentado para datos pesados
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 3. Rutas
  app.get('/', (req, res) => res.json({ name: 'pos360-api', status: 'online' }));
  app.use('/api/v1', v1Routes);

  // 4. Gestor de Errores (Siempre al final)
  app.use(errorMiddleware);

  return app;
}

module.exports = { createApp };