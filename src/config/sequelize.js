// src/config/sequelize.js
// ✅ COPY-PASTE FINAL COMPLETO
// - Mantiene tu env.js
// - ✅ logging activable por env: SEQUELIZE_LOG=1
// - define snake_case + timestamps mapeados

const { Sequelize } = require("sequelize");
const env = require("./env");

const shouldLog =
  String(process.env.SEQUELIZE_LOG || "").trim() === "1" ||
  String(process.env.SEQUELIZE_LOG || "").trim().toLowerCase() === "true";

const sequelize = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
  host: env.DB_HOST,
  port: env.DB_PORT,
  dialect: "mysql",

  // ✅ loguea SQL solo si lo habilitás por env
  logging: shouldLog ? (msg) => console.log("🧾 SQL:", msg) : false,

  // ✅ Esto alinea tus tablas snake_case:
  define: {
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
});

module.exports = sequelize;
