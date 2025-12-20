// src/services/s3.service.js
const crypto = require("crypto");
const { PutObjectCommand, HeadBucketCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { s3, s3Config } = require("../config/s3");

function safeExtFromMime(mime) {
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };
  return map[mime] || null;
}

function buildObjectKey({ prefix = "uploads", mimeType, originalName }) {
  const ext = safeExtFromMime(mimeType) || (originalName?.split(".").pop() || "bin");
  const rand = crypto.randomBytes(12).toString("hex");
  const ts = Date.now();
  return `${prefix}/${ts}-${rand}.${ext}`;
}

async function checkBucketAccess() {
  // Esto valida credenciales y acceso al bucket
  await s3.send(new HeadBucketCommand({ Bucket: s3Config.bucket }));
  return true;
}

async function putObject({ key, body, contentType }) {
  await s3.send(
    new PutObjectCommand({
      Bucket: s3Config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  // URL pública “base” (OJO: solo sirve si el bucket/policy permite lectura pública o usas presigned GET)
  // Para uso privado, te conviene hacer presigned GET cuando necesites mostrar.
  return `${s3Config.endpoint}/${s3Config.bucket}/${key}`;
}

async function presignPut({ key, contentType, expiresIn = 60 }) {
  const cmd = new PutObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(s3, cmd, { expiresIn });
  return url;
}

module.exports = {
  buildObjectKey,
  putObject,
  presignPut,
  checkBucketAccess,
};
