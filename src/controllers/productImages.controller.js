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

// --- S3/MinIO client (aws-sdk v2) ---
// TÚ LÓGICA ORIGINAL INTACTA
function s3Client() {
  const endpoint = mustEnv("S3_ENDPOINT");
  const accessKeyId = mustEnv("S3_ACCESS_KEY");
  const secretAccessKey = mustEnv("S3_SECRET_KEY");

  const forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE ?? "true") === "true";

  return new AWS.S3({
    endpoint,
    accessKeyId,
    secretAccessKey,
    s3ForcePathStyle: forcePathStyle,
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

function safeExt(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  const ok = [".png", ".jpg", ".jpeg", ".webp"];
  return ok.includes(ext) ? ext : ".jpg";
}

// GET /api/v1/products/:id/images
exports.listByProduct = async (req, res, next) => {
  try {
    const productId = toInt(req.params.id, 0);
    if (!productId) return res.status(400).json({ ok: false, message: "productId inválido" });

    const items = await ProductImage.findAll({
      where: { product_id: productId },
      order: [["sort_order", "ASC"], ["id", "ASC"]],
    });

    return res.json({ ok: true, items });
  } catch (e) {
    next(e);
  }
};

// POST /api/v1/products/:id/images
exports.upload = async (req, res, next) => {
  try {
    // MODIFICACIÓN: Buscamos el ID en params O en body para mayor seguridad
    const productId = toInt(req.params.id || req.body?.productId, 0);

    if (!productId) {
      return res.status(400).json({ ok: false, message: "productId es obligatorio" });
    }

    // Multer ya debió haber procesado el archivo en el router
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "file es obligatorio (asegúrate de enviar 'file' en form-data)" });
    }

    const bucket = mustEnv("S3_BUCKET");
    const s3 = s3Client();

    const ext = safeExt(req.file.originalname);
    const stamp = Date.now();
    const rand = crypto.randomBytes(8).toString("hex");
    const key = `products/${productId}/${stamp}-${rand}${ext}`;

    // 1) Subimos a MinIO/S3
    await s3
      .putObject({
        Bucket: bucket,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype || "application/octet-stream",
        ACL: "public-read", // Comentar si tu MinIO no soporta ACLs
      })
      .promise();

    const url = publicUrlFor(key);

    // 2) Insertamos en DB
    const img = await ProductImage.create({
      product_id: productId,
      url,
      sort_order: 0,
    });
    
    console.log(`[UPLOAD] Imagen subida exitosamente: ID ${img.id} para Producto ${productId}`);

    return res.status(201).json({ ok: true, item: img });
  } catch (e) {
    console.error("[UPLOAD ERROR]", e);
    // Si sigue saliendo Unexpected field, es un tema del nombre del campo en el frontend vs router
    if (e.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ ok: false, message: "El archivo es demasiado grande (Máx 25MB)" });
    }
    next(e);
  }
};