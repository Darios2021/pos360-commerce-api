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
  return `${String(base).replace(/\/$/, "")}/${bucket}/${key}`;
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

exports.upload = async (req, res, next) => {
  try {
    const productId = req.params.id;
    
    // ✅ BUSCAMOS EL ARCHIVO EN EL ARRAY (porque usamos .any() en la ruta)
    const file = (req.files && req.files.length > 0) ? req.files[0] : null;

    if (!file) {
      console.error("❌ No llegó ningún archivo. req.files:", req.files);
      return res.status(400).json({ ok: false, message: "No se recibió archivo" });
    }

    console.log(`[UPLOAD] Subiendo ${file.originalname} para producto ${productId}`);

    const s3 = s3Client();
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

    console.log("✅ Imagen creada en DB:", img.id);
    res.status(201).json({ ok: true, item: img });

  } catch (e) {
    console.error("❌ ERROR EN CONTROLADOR UPLOAD:", e);
    res.status(500).json({ ok: false, message: e.message });
  }
};