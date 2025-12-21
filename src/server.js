// src/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();

// =====================
// CORS (VERSIÓN CORREGIDA)
// =====================
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // 1. Permitir si no hay origin (Postman, curl, etc)
    if (!origin) return callback(null, true);
    
    // 2. Si estamos en desarrollo, permitir localhost siempre por seguridad
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }

    // 3. Permitir si está en la lista de CapRover
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    
    return callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // Preflight

// =====================
// Body parsers y Rutas
// =====================
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const routes = require("./routes");
app.use("/api/v1", routes);

app.use((err, req, res, next) => {
  console.error("❌ ERROR:", err?.message || err);
  res.status(500).json({ ok: false, message: err?.message || "Server error" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ API listening on :${port}`));