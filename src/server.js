// src/server.js
const express = require("express");
const env = require("./config/env");
const { sequelize } = require("./models");

const app = express();

app.use(express.json());

// 👇 tus rutas
// const routes = require("./routes");
// app.use("/api/v1", routes);

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "pos360-commerce-api" });
});

async function start() {
  try {
    await sequelize.authenticate();
    console.log("✅ DB connected");
  } catch (err) {
    console.error("❌ DB connection failed. Exiting.");
    console.error(err);
    process.exit(1);
  }

  app.listen(env.PORT, () => {
    console.log(`🚀 API listening on :${env.PORT}`);
  });
}

start();
