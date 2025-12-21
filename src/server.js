// src/server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

// =====================
// CORS (FIX REAL)
// =====================
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    // requests sin origin (curl/postman) -> permitir
    if (!origin) return cb(null, true);

    // si CORS_ORIGINS vacío => permitir todo (no recomendado)
    if (!allowedOrigins.length) return cb(null, true);

    // permitir si está en whitelist
    if (allowedOrigins.includes(origin)) return cb(null, true);

    return cb(new Error(`CORS blocked: ${origin}`), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["Authorization"],
};

// 👇 MUY IMPORTANTE: CORS primero
app.use(cors(corsOptions));

// 👇 MUY IMPORTANTE: preflight
app.options("*", cors(corsOptions));

// =====================
// Body parsers
// =====================
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// =====================
// Routes
// =====================
const routes = require("./routes");
app.use("/api/v1", routes);

// =====================
// Error handler (para que CORS muestre algo útil)
// =====================
app.use((err, req, res, next) => {
  console.error("❌ ERROR:", err?.message || err);
  res.status(500).json({ ok: false, message: err?.message || "Server error" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ API listening on :${port}`));
