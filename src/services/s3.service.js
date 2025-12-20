// src/services/s3.service.js
const { S3Client, HeadBucketCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

function getBool(v, def = false) {
  if (v === undefined || v === null) return def;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function must(name, v) {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function buildS3Client() {
  const endpoint = must("S3_ENDPOINT", process.env.S3_ENDPOINT);
  const region = process.env.S3_REGION || "us-east-1";
  const accessKeyId = must("S3_ACCESS_KEY", process.env.S3_ACCESS_KEY);
  const secretAccessKey = must("S3_SECRET_KEY", process.env.S3_SECRET_KEY);

  // MinIO casi siempre necesita path-style
  const forcePathStyle = getBool(process.env.S3_FORCE_PATH_STYLE, true);

  // Si endpoint ya es https, usá SSL. Si es http, no.
  const ssl =
    process.env.S3_SSL !== undefined
      ? getBool(process.env.S3_SSL, true)
      : String(endpoint).startsWith("https://");

  return new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
    tls: ssl,
  });
}

function publicObjectUrl({ bucket, key }) {
  // URL pública para consumir desde frontend.
  // Si usás minio-coc.cingulado.org como endpoint público, esto te queda joya.
  const endpoint = must("S3_PUBLIC_BASE_URL", process.env.S3_PUBLIC_BASE_URL || process.env.S3_ENDPOINT);

  const base = String(endpoint).replace(/\/+$/, "");
  const pathStyle = getBool(process.env.S3_FORCE_PATH_STYLE, true);

  if (pathStyle) {
    // https://host/bucket/key
    return `${base}/${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
  }

  // virtual-host style: https://bucket.host/key
  // ojo: requiere DNS/ingress compatible
  const u = new URL(base);
  return `${u.protocol}//${bucket}.${u.host}/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
}

async function checkBucketAccess() {
  const bucket = must("S3_BUCKET", process.env.S3_BUCKET);
  const s3 = buildS3Client();
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  return true;
}

async function putObject({ key, body, contentType }) {
  const bucket = must("S3_BUCKET", process.env.S3_BUCKET);
  const s3 = buildS3Client();

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
    })
  );

  return {
    bucket,
    key,
    url: publicObjectUrl({ bucket, key }),
  };
}

module.exports = {
  checkBucketAccess,
  putObject,
  publicObjectUrl,
};
