const AWS = require("aws-sdk");
const crypto = require("crypto");
const path = require("path");
const { ProductImage } = require("../models");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function s3Client() {
  return new AWS.S3({
    endpoint: mustEnv("S3_ENDPOINT"),
    accessKeyId: mustEnv("S3_ACCESS_KEY"),
    secretAccessKey: mustEnv("S3_SECRET_KEY"),
    s3ForcePathStyle: true,
    signatureVersion: "v4",
    sslEnabled: true,
    region: process.env.S3_REGION || "us-east-1",
  });
}

function publicUrlFor(key) {
  const base = process.env.S3_PUBLIC_BASE_URL || process.env.S3_ENDPOINT;
  const bucket = mustEnv("S3_BUCKET");
  const cleanBase = String(base).replace(/\/$/, "");
  return `${cleanBase}/${bucket}/${key}`;
}

async function upload(req, res, next) {
  try {
    const productId = req.params.id;
    
    // CORRECCIÓN: Captura archivos sin importar si vienen en req.files (array) o req.file (single)
    let files = [];
    if (req.files) {
      files = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
    } else if (req.file) {
      files = [req.file];
    }

    if (files.length === 0) {
      return res.status(400).json({ ok: false, message: "No se recibió ningún archivo" });
    }

    const s3 = s3Client();
    const results = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      const key = `products/${productId}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;

      await s3.putObject({
        Bucket: mustEnv("S3_BUCKET"),
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: "public-read"
      }).promise();

      const img = await ProductImage.create({
        product_id: productId,
        url: publicUrlFor(key),
        sort_order: 0
      });
      
      results.push(img);
    }

    res.status(201).json({ 
      ok: true, 
      uploaded: results.length,
      items: results 
    });
  } catch (e) {
    console.error("❌ UPLOAD ERROR:", e);
    res.status(500).json({ ok: false, message: e.message });
  }
}

async function listByProduct(req, res, next) {
  try {
    const items = await ProductImage.findAll({
      where: { product_id: req.params.id },
      order: [["sort_order", "ASC"]],
    });
    res.json({ ok: true, items });
  } catch (e) { next(e); }
}

module.exports = { listByProduct, upload };