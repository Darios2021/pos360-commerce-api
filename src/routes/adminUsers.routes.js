// src/routes/adminUsers.routes.js
const router = require("express").Router();
const {
  getMeta,
  listUsers,
  createUser,
  updateUser,
} = require("../controllers/adminUsers.controller");

router.get("/meta", getMeta);
router.get("/", listUsers);
router.post("/", createUser);

// soporta frontend viejo y nuevo
router.patch("/:id", updateUser);
router.put("/:id", updateUser);

module.exports = router;
