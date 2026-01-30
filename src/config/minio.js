// src/config/minio.js
// ✅ COPY-PASTE FINAL (WRAPPER SOBRE s3.js)
// - NO usa lib "minio"
// - Reusa AWS SDK v3 (@aws-sdk/client-s3)
// - Compatible con MinIO y S3
// - Mismos helpers que espera el controller

const { s3, s3Config } = require("./s3");
const {
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

function toStr(v, d = "") {
  const s = String(v ?? "").trim();
  return s ? s : d;
}

const MINIO_BUCKET = s3Config.bucket;
const MINIO_PUBLIC_BASE_URL = toStr(process.env.S3_PUBLIC_BASE_URL, "");

/**
 * Simula ensureBucket() del client minio
 */
async function ensureBucket(bucket = MINIO_BUCKET) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return bucket;
  } catch (e) {
    // En MinIO suele permitir crear bucket
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`[S3] ✅ Bucket creado: ${bucket}`);
    return bucket;
  }
}

/**
 * Subida simple (buffer)
 */
async function putObject({
  bucket = MINIO_BUCKET,
  key,
  body,
  contentType,
}) {
  if (!key) throw new Error("putObject: key requerido");

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  return {
    bucket,
    key,
    url: buildPublicUrl(key),
  };
}

function buildPublicUrl(key) {
  if (!key) return "";
  if (!MINIO_PUBLIC_BASE_URL) return "";
  return `${MINIO_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${encodeURI(key)}`;
}

module.exports = {
  // alias esperados
  minioClient: {
    putObject,
  },
  ensureBucket,
  buildPublicUrl,

  // info
  MINIO_BUCKET,
  bucket: MINIO_BUCKET,
  MINIO_PUBLIC_BASE_URL,
};
