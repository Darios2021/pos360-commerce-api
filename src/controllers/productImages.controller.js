const AWS = require("aws-sdk");
const crypto = require("crypto");
const path = require("path");
const { ProductImage } = require("../models");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

// Configuración S3 (AWS SDK v2 según tus logs)
function s3Client() {
  return new AWS.S3({
    endpoint: mustEnv("S3_ENDPOINT"),
    accessKeyId: mustEnv("S3_ACCESS_KEY"),
    secretAccessKey: mustEnv("S3_SECRET_KEY"),
    s3ForcePathStyle: String(process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    signatureVersion: "v4",
    sslEnabled: String(process.env.S3_SSL ?? "true") === "true",
    region: process.env.S3_REGION || "us-east-1",
  });
}

function publicUrlFor(key) {
  const base = process.env.S3_PUBLIC_BASE_URL || process.env.S3_ENDPOINT;
  const bucket = mustEnv("S3_BUCKET");
  const forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE ?? "true") === "true";
  if (forcePathStyle) return `${String(base).replace(/\/$/, "")}/${bucket}/${key}`;
  const host = String(base).replace(/^https?:\/\//, "");
  return `https://${bucket}.${host.replace(/\/.*$/, "")}/${key}`;
}

exports.listByProduct = async (req, res, next) => {
  try {
    const items = await ProductImage.findAll({
      where: { product_id: req.params.id },
      order: [["sort_order", "ASC"]],
    });
    res.json({ ok: true, items });
  } catch (e) { next(e); }
};

// POST Upload
exports.upload = async (req, res, next) => {
  try {
    // El ID viene inyectado desde la ruta
    const productId = toInt(req.body.productId, 0);
    
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "No se recibió archivo (req.file es null)" });
    }

    console.log(`[UPLOAD] Iniciando subida para Producto ${productId}, Archivo: ${req.file.originalname}`);

    const bucket = mustEnv("S3_BUCKET");
    const s3 = s3Client();
    
    // Generar nombre único
    const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
    const key = `products/${productId}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;

    // Subir a MinIO
    await s3.putObject({
      Bucket: bucket,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: "public-read" // Comenta si falla por permisos
    }).promise();

    // Guardar en DB
    const img = await ProductImage.create({
      product_id: productId,
      url: publicUrlFor(key),
      sort_order: 0
    });

    console.log(`[UPLOAD SUCCESS] Imagen guardada ID: ${img.id}`);
    res.status(201).json({ ok: true, item: img });

  } catch (e) {
    console.error("[CONTROLLER ERROR]", e);
    next(e);
  }
};