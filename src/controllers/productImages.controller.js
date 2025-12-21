// src/controllers/productImages.controller.js
const multer = require("multer");
const { Product, ProductImage } = require("../models");
const { uploadProductImage } = require("../services/s3.service");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

exports.mwUpload = upload.array("files", 3);

exports.listImages = async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    if (!productId) return res.status(400).json({ ok: false, code: "BAD_ID" });

    const items = await ProductImage.findAll({
      where: { product_id: productId },
      order: [["sort_order", "ASC"], ["id", "ASC"]],
    });

    res.json({ ok: true, items });
  } catch (e) {
    next(e);
  }
};

exports.uploadImages = async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    if (!productId) return res.status(400).json({ ok: false, code: "BAD_ID" });

    const prod = await Product.findByPk(productId);
    if (!prod) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, code: "NO_FILES" });

    const created = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];

      const { url } = await uploadProductImage({
        productId,
        buffer: f.buffer,
        mimeType: f.mimetype,
        originalName: f.originalname,
      });

      const row = await ProductImage.create({
        product_id: productId,
        url,
        sort_order: i,
      });

      created.push(row);
    }

    const all = await ProductImage.findAll({
      where: { product_id: productId },
      order: [["sort_order", "ASC"], ["id", "ASC"]],
    });

    res.status(201).json({ ok: true, uploaded: created.length, items: all });
  } catch (e) {
    next(e);
  }
};
