// src/routes/import.routes.js
const router = require("express").Router();

const upload = require("../middlewares/upload.middleware");
const ImportController = require("../controllers/import.controller");

// POST /api/v1/import/products  (form-data: file=@archivo.csv)
router.post("/products", upload.single("file"), ImportController.importProductsCsv);

module.exports = router;
