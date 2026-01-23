// src/server.js
require("dotenv").config();

const { createApp } = require("./app");

const app = createApp();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.listen(PORT, () => {
  console.log(`✅ pos360-commerce-api listening on :${PORT}`);
});
