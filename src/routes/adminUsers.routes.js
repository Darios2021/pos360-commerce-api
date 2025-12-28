// src/routes/adminUsers.routes.js
const router = require("express").Router();

const { getMeta, listUsers } = require("../controllers/adminUsers.controller");

// IMPORTANTE: la ruta base ya es /api/v1/admin/users
router.get("/meta", getMeta);
router.get("/", listUsers);

module.exports = router;
